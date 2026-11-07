import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PassThrough } from "node:stream";
import pg from "pg";
import { chromium } from "@playwright/test";
import { DATABASE_BOOTSTRAP } from "../qa/lib/database-bootstrap.mjs";
import { loadMigrations } from "../staging/lib.mjs";
import { NATIVE_CATALOG_CHECKS } from "../qa/lib/quality-gates.mjs";
import { executeSqlScript } from "../qa/lib/database-harness.mjs";
import { assertLocalDockerEndpoint } from "../qa/lib/local-stack.mjs";
import { command, controlledEnvironment } from "./process.mjs";
import { resticClient } from "./restic.mjs";
import { inventorySql, schemas, databaseManifest, publicationRestoreSql, tableFingerprints } from "./database.mjs";
import { fingerprintFormat, verifyTableFingerprints } from "./fingerprints.mjs";
import { decodeStoragePack, inventoryDigest, writeStream } from "./storage.mjs";
import { assertDrillContainer } from "./drill-producer.mjs";
import { openRestoreTunnel } from "./restore-tunnel.mjs";
import { syntheticPng, syntheticProjectRef, persistentSyntheticWorkflow } from "./drill-fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const hash = value => createHash("sha256").update(value).digest("hex");

export async function drill(env = process.env) {
  controlledEnvironment(env);
  // No target URL, project adoption, linked stack, restore --clean, volume
  // mounts, hosted credentials, or arbitrary destination is accepted.
  const inspected = JSON.parse((await command("docker", ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"])).toString());
  assertLocalDockerEndpoint(inspected);
  await command("docker", ["version", "--format", "{{.Server.Version}}"]);
  const pins = JSON.parse(await readFile(new URL("../../config/operations-tools.json", import.meta.url), "utf8"));
  const started = Date.now(), id = randomUUID(), name = `ucm-restore-${id}`, network = `ucm-restore-net-${id}`;
  const parent = path.join(root, ".qa", "operations", "drills");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(parent, "run-"));
  const privateEnv = { ...controlledEnvironment(env), RESTIC_REPOSITORY: path.join(directory, "encrypted-repository"), RESTIC_PASSWORD: randomBytes(48).toString("base64url"),
    OPS_DRILL_ID: id, OPS_DRILL_CONTAINER: name, POSTGRES_PASSWORD: randomBytes(32).toString("base64url") };
  // The drill repository is always newly created and local; never inherit a
  // live repository URL/password or an operator database/service key.
  for (const key of Object.keys(privateEnv)) if (key.startsWith("OPS_") && !["OPS_RESTIC_BINARY", "OPS_DRILL_ID", "OPS_DRILL_CONTAINER"].includes(key)) delete privateEnv[key];
  const restic = resticClient(privateEnv), binary = env.OPS_RESTIC_BINARY || "restic";
  let attemptedCreation = false, networkAttempted = false, source, target, browser, tunnel, clean = false;
  const evidence = { version: 1, runId: id, status: "failed", source: "synthetic-local-only", productionTouched: false,
    phase: "repository",
    databaseRestored: false, storageRestored: false, imageDecoded: false, tablesMatched: false, catalogAssertions: 0, cleanup: false };
  try {
    await command(binary, ["--no-cache", "init", "--repository-version", "2"], { env: privateEnv });
    const config = JSON.parse((await command(binary, ["--no-cache", "cat", "config"], { env: privateEnv })).toString());
    await restic.verify(config.id);
    evidence.phase = "container";
    networkAttempted = true;
    await command("docker", ["network", "create", "--internal", "--label", `ucmarketplace.restore-drill=${id}`, network], { env: privateEnv });
    const networkInfo = JSON.parse((await command("docker", ["network", "inspect", network], { env: privateEnv })).toString());
    assert.equal(networkInfo.length, 1); assert.equal(networkInfo[0].Internal, true);
    assert.equal(networkInfo[0].Name, network); assert.equal(networkInfo[0].Labels["ucmarketplace.restore-drill"], id);
    attemptedCreation = true;
    await command("docker", ["run", "--detach", "--rm", "--name", name, "--label", `ucmarketplace.restore-drill=${id}`,
      "--network", network, "--read-only", "--security-opt", "no-new-privileges:true", "--tmpfs", "/var/lib/postgresql/data:rw,size=512m",
      "--tmpfs", "/var/run/postgresql:rw,size=16m", "--tmpfs", "/tmp:rw,size=32m", "--env", "POSTGRES_PASSWORD", pins.postgresImage], { env: privateEnv, timeoutMs: 180000 });
    const container = await assertDrillContainer(privateEnv);
    assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [network]);
    assert.ok(Object.values(container.NetworkSettings.Ports).every(bindings => !bindings?.length));
    tunnel = await openRestoreTunnel(privateEnv);
    const options = { host: tunnel.host, port: tunnel.port, user: "postgres", password: privateEnv.POSTGRES_PASSWORD,
      ssl: false, database: "postgres", connectionTimeoutMillis: 2000, statement_timeout: 60000 };
    for (let attempt = 0; attempt < 40; attempt++) {
      const client = new pg.Client(options);
      try { await client.connect(); source = client; break; } catch { await client.end(); await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    assert.ok(source, "Disposable database startup failed.");
    // Match Supabase's ICU source and the plain PostgreSQL/libc restore target.
    await source.query("create database source_drill template=template0 locale_provider=icu icu_locale='en-US'");
    await source.end();
    source = new pg.Client({ ...options, database: "source_drill" }); await source.connect();
    assert.equal((await source.query("select datlocprovider from pg_database where datname=current_database()")).rows[0].datlocprovider, "i");
    await source.query("set extra_float_digits=0");
    evidence.phase = "bootstrap";
    await source.query(DATABASE_BOOTSTRAP);
    evidence.phase = "migrations";
    for (const migration of await loadMigrations()) await source.query(migration.query);
    const workflow = await readFile(path.join(root, "supabase/checks/end_to_end_workflow.sql"), "utf8");
    evidence.phase = "fixtures";
    const results = await source.query(persistentSyntheticWorkflow(workflow));
    const workflowRows = (Array.isArray(results) ? results : [results]).flatMap(result => result.rows ?? []);
    assert.ok(workflowRows.some(row => row.scenario === "__all_end_to_end_workflow_checks_passed__" && row.all_passed === true));
    await source.query("update storage.objects set metadata=jsonb_build_object('size',$1::int,'mimetype','image/png')", [syntheticPng.length]);
    const seller = (await source.query("select seller_id from public.listings limit 1")).rows[0].seller_id;
    const avatar = `${seller}/${randomUUID()}.png`;
    await source.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('avatars',$1,$2,jsonb_build_object('size',$3::int,'mimetype','image/png'))", [avatar, seller, syntheticPng.length]);
    for (const filename of ["Aa.png", "a-a.png", "aa.png"]) {
      await source.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('avatars',$1,$2,jsonb_build_object('size',$3::int,'mimetype','image/png'))",
        [`${seller}/${filename}`, seller, syntheticPng.length]);
    }
    await source.query("update public.profiles set avatar_path=$1 where id=$2", [avatar, seller]);
    await source.query(`create table extensions.backup_locale_fixture(label text,measurement double precision,happened_at timestamptz,duration interval,bytes bytea);
      insert into extensions.backup_locale_fixture select label,1.2345678901234567::double precision,'2026-11-07T00:00:00Z'::timestamptz,
        interval '1 day 1 hour',decode('00ff','hex') from unnest(array['a-b','ab','Z','z','10','2','A','a']) label`);
    const before = await tableFingerprints(source), objects = (await source.query(inventorySql)).rows;
    assert.ok(objects.length >= 5 && objects.every(object => object.name.includes("/")));
    privateEnv.OPS_DRILL_OBJECTS = JSON.stringify(objects);
    evidence.phase = "capture";
    const producer = component => [process.execPath, fileURLToPath(new URL("./drill-producer.mjs", import.meta.url)), component];
    const snapshots = {};
    for (const component of ["database", "media", "verification"]) snapshots[component] = await resticClient(privateEnv).backup(component, id, producer(component));
    privateEnv.OPS_DRILL_MANIFEST = JSON.stringify({ version: 1, complete: true, projectRef: syntheticProjectRef, runId: id, snapshots,
      inventorySha256: inventoryDigest(objects), database: await databaseManifest(source) });
    snapshots.bundle = await resticClient(privateEnv).backup("bundle", id, producer("bundle"));
    await restic.check(true);
    const archiveChunks = [];
    await restic.dump(snapshots.database, "database", chunk => archiveChunks.push(chunk));
    const archive = Buffer.concat(archiveChunks); // Small synthetic fixture only.
    const toc = (await command("docker", ["exec", "--interactive", name, "pg_restore", "--list"], { input: archive })).toString();
    const archiveSchemas = [...toc.matchAll(/^\d+; \d+ \d+ SCHEMA - ([a-z_]+) /gm)].map(match => match[1]);
    assert.ok(archiveSchemas.every(schema => schemas.includes(schema)));
    evidence.archiveSchemas = archiveSchemas;
    evidence.phase = "database-restore";
    await source.query("create database restored_drill");
    target = new pg.Client({ ...options, database: "restored_drill" }); await target.connect();
    assert.equal((await target.query("select datlocprovider from pg_database where datname=current_database()")).rows[0].datlocprovider, "c");
    evidence.crossLocaleRecovery = true;
    await assertDrillContainer(privateEnv);
    assert.equal((await target.query("select current_database() as name")).rows[0].name, "restored_drill");
    const existing = (await target.query("select nspname from pg_namespace where nspname=any($1) order by nspname", [schemas])).rows;
    assert.deepEqual(existing, [{ nspname: "public" }]);
    assert.equal((await target.query("select count(*)::int as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'")).rows[0].count, 0);
    // pg_dump includes the public schema. Remove only the verified-empty
    // default schema in this just-created run-owned target, never --clean or
    // an application schema/database belonging to an existing project.
    if (archiveSchemas.includes("public")) await target.query("drop schema public");
    await command("docker", ["exec", "--interactive", name, "pg_restore", "--username=postgres", "--dbname=restored_drill", "--single-transaction", "--no-owner", "--exit-on-error"], { input: archive, postgresRestoreDiagnostics: true });
    evidence.databaseRestored = true;
    const manifestChunks = [];
    await restic.dump(snapshots.bundle, "bundle", chunk => manifestChunks.push(chunk));
    const manifest = JSON.parse(Buffer.concat(manifestChunks).toString());
    assert.equal(manifest.projectRef, syntheticProjectRef); assert.equal(manifest.runId, id);
    await target.query(publicationRestoreSql(manifest.database.publication));
    assert.equal(manifest.database.fingerprintFormat, fingerprintFormat);
    verifyTableFingerprints(await tableFingerprints(target), before); evidence.tablesMatched = true;
    assert.equal(inventoryDigest((await target.query(inventorySql)).rows), manifest.inventorySha256);
    evidence.inventoryMatched = true;
    // Reject real corruption as well as proving identical cross-locale rows pass.
    await target.query("begin");
    try {
      await target.query("update extensions.backup_locale_fixture set measurement=measurement+1 where label='a-b'");
      const changed = await tableFingerprints(target);
      assert.throws(() => verifyTableFingerprints(changed, before), error => error.operationCodes?.includes("RESTORE_TABLE_DATA_MISMATCH"));
      evidence.corruptionDetected = true;
    } finally { await target.query("rollback"); }
    evidence.phase = "security";
    for (const filename of NATIVE_CATALOG_CHECKS) {
      const rows = (await executeSqlScript({ exec: async query => {
        const result = await target.query(query);
        return (Array.isArray(result) ? result : [result]).map(item => ({ rows: item.rows ?? [] }));
      } }, await readFile(path.join(root, "supabase/checks", filename), "utf8"))).flatMap(item => item.rows);
      const assertions = rows.filter(row => typeof row.passed === "boolean");
      assert.ok(assertions.length && assertions.every(row => row.passed));
      evidence.catalogAssertions += assertions.filter(row => !String(row.check_name ?? row.scenario ?? "").startsWith("__")).length;
    }
    evidence.phase = "restored-access";
    const buyer = (await target.query("select buyer_id from public.reservations where status='completed' limit 1")).rows[0].buyer_id;
    const ownDocuments = (await target.query("select count(*)::int as count from storage.objects where bucket_id='student-verifications' and owner_id=$1", [buyer])).rows[0].count;
    assert.ok(ownDocuments > 0, "The owner-access positive control needs a submitted verification document.");
    evidence.restoredAccessChecks = 0;
    await target.query("begin");
    try {
      await target.query("select set_config('request.jwt.claim.sub',$1,true)", [buyer]);
      await target.query("set local role authenticated");
      assert.equal((await target.query("select count(*)::int as count from storage.objects where bucket_id='student-verifications' and owner_id<>auth.uid()::text")).rows[0].count, 0);
      evidence.restoredAccessChecks++;
      assert.equal((await target.query("select count(*)::int as count from storage.objects where bucket_id='student-verifications' and owner_id=auth.uid()::text")).rows[0].count, ownDocuments);
      evidence.restoredAccessChecks++;
      assert.equal((await target.query("select count(*)::int as count from public.profiles where role='admin' and id=auth.uid()")).rows[0].count, 0);
      evidence.restoredAccessChecks++;
    } finally { await target.query("rollback"); }
    const files = new Map();
    evidence.phase = "files-restore";
    for (const component of ["media", "verification"]) {
      const input = new PassThrough();
      await Promise.all([
        decodeStoragePack(input, { projectRef: syntheticProjectRef, runId: id, component, maxObjects: 100, maxStorageBytes: 10000000 }, async (object, bytes) => {
          assert.equal(hash(bytes), hash(syntheticPng)); files.set(`${object.bucket_id}/${object.name}`, bytes);
        }),
        restic.dump(snapshots[component], component, chunk => writeStream(input, chunk)).finally(() => input.end()),
      ]);
    }
    assert.equal(files.size, objects.length); evidence.storageRestored = true;
    const image = (await target.query("select storage_path from public.listing_images limit 1")).rows[0];
    const bytes = files.get(`listing-images/${image.storage_path}`); assert.ok(bytes);
    browser = await chromium.launch({ headless: true });
    evidence.phase = "image-decode";
    const page = await browser.newPage();
    await page.setContent(`<img alt="Synthetic restored listing" src="data:image/png;base64,${bytes.toString("base64")}">`);
    assert.equal(await page.locator("img").evaluate(async image => { await image.decode(); return image.naturalWidth > 0; }), true);
    evidence.imageDecoded = true; evidence.objects = files.size;
    evidence.status = "passed";
    evidence.phase = "complete";
  } catch (error) {
    evidence.failureCode = typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : "withheld";
    if (Array.isArray(error?.operationCodes)) evidence.restoreFailureCodes = error.operationCodes;
    throw error;
  } finally {
    await browser?.close().catch(() => {}); await source?.end().catch(() => {}); await target?.end().catch(() => {});
    await tunnel?.close();
    if (attemptedCreation) {
      const owned = (await command("docker", ["ps", "--all", "--filter", `label=ucmarketplace.restore-drill=${id}`, "--filter", `name=^/${name}$`, "--format", "{{.ID}}"])).toString().trim();
      if (owned) {
        await assertDrillContainer(privateEnv, false);
        // Only the exact just-created, ownership-labelled synthetic container;
        // no volumes, development stack, arbitrary IDs or host directories.
        await command("docker", ["rm", "--force", name]);
      }
      clean = true;
    } else clean = true;
    if (networkAttempted) {
      const owned = (await command("docker", ["network", "ls", "--filter", `label=ucmarketplace.restore-drill=${id}`, "--format", "{{.Name}}"], { env: privateEnv })).toString().trim();
      if (owned) {
        assert.equal(owned, network);
        const inspected = JSON.parse((await command("docker", ["network", "inspect", network], { env: privateEnv })).toString());
        assert.equal(inspected.length, 1); assert.equal(inspected[0].Name, network);
        assert.equal(inspected[0].Labels["ucmarketplace.restore-drill"], id); assert.equal(inspected[0].Internal, true);
        await command("docker", ["network", "rm", network], { env: privateEnv });
      }
    }
    evidence.cleanup = clean; evidence.elapsedSeconds = Math.ceil((Date.now() - started) / 1000);
    if (!clean) evidence.status = "failed";
    await writeFile(path.join(directory, "evidence.json"), `${JSON.stringify(evidence)}\n`, { flag: "wx", mode: 0o600 });
  }
  assert.equal(evidence.status, "passed");
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assert.equal(process.argv.length, 2); console.log(JSON.stringify(await drill())); }
  catch { console.error("Isolated restore drill did not pass. Start local Docker and configure the reviewed tools/image; private diagnostics withheld. No hosted restore or existing-container reset was attempted."); process.exitCode = 1; }
}
