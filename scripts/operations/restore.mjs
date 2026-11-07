import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PassThrough } from "node:stream";
import pg from "pg";
import { chromium } from "@playwright/test";
import { NATIVE_CATALOG_CHECKS } from "../qa/lib/quality-gates.mjs";
import { executeSqlScript } from "../qa/lib/database-harness.mjs";
import { assertLocalDockerEndpoint } from "../qa/lib/local-stack.mjs";
import { command, controlledEnvironment } from "./process.mjs";
import { assertDrillContainer } from "./drill-producer.mjs";
import { publicationRestoreSql, tableFingerprints, schemas, inventorySql } from "./database.mjs";
import { decodeStoragePack, inventoryDigest, writeStream } from "./storage.mjs";
import { readJsonSnapshot, validateBundle } from "./bundle.mjs";
import { registry, validateBackupPolicy, snapshotId } from "./policy.mjs";
import { resticClient } from "./restic.mjs";
import { openRestoreTunnel } from "./restore-tunnel.mjs";
import { verifyTableFingerprints } from "./fingerprints.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

export async function restoreBundle(env, bundleId, sourceSha) {
  const selected = validateBackupPolicy(env);
  assert.equal(selected.dataScope, "synthetic-only"); assert.match(bundleId, snapshotId); assert.match(sourceSha, /^[a-f0-9]{40}$/);
  assert.equal(env.OPS_RESTORE_CONFIRM, `${registry.staging.supabaseProjectRef}:isolated-synthetic-restore`);
  const storage = resticClient(env); await storage.verify(selected.repositoryId);
  const snapshots = await storage.snapshots();
  const manifest = validateBundle(await readJsonSnapshot(storage, bundleId, "bundle"), bundleId, snapshots);
  assert.ok(manifest.storage.objects > 0 && manifest.storage.objects <= selected.maxObjects);
  assert.ok(manifest.storage.bytes <= Math.min(selected.maxStorageBytes, 128 * 1024 * 1024), "Synthetic restoration exceeds its memory-isolation limit.");
  await storage.check(true);
  const inspected = JSON.parse((await command("docker", ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"])).toString());
  assertLocalDockerEndpoint(inspected);
  const pins = JSON.parse(await readFile(path.join(root, "config/operations-tools.json"), "utf8"));
  const id = randomUUID(), name = `ucm-restore-${id}`, network = `ucm-restore-net-${id}`, started = Date.now();
  const containerEnv = Object.fromEntries(Object.entries(controlledEnvironment(env)).filter(([key]) => !/^(OPS_|AWS_|RESTIC_)/.test(key)));
  Object.assign(containerEnv, { OPS_DRILL_ID: id, OPS_DRILL_CONTAINER: name, POSTGRES_PASSWORD: randomBytes(32).toString("base64url") });
  const evidence = { version: 1, environment: "staging", dataScope: "synthetic-only", status: "failed", repositoryId: selected.repositoryId,
    bundleId, runId: manifest.runId, sourceSha, databaseRestored: false, storageRestored: false, tablesMatched: false,
    imageDecoded: false, catalogAssertions: 0, restoredAccessChecks: 0, objectsRestored: 0, cleanup: false, productionTouched: false };
  let attempted = false, networkAttempted = false, client, browser, tunnel, phase = "restore-container";
  let startupFailureCode = "RESTORE_NETWORK_CREATE_FAILED";
  try {
    networkAttempted = true;
    await command("docker", ["network", "create", "--internal", "--label", `ucmarketplace.restore-drill=${id}`, network], { env: containerEnv });
    startupFailureCode = "RESTORE_NETWORK_INSPECT_FAILED";
    const networkInfo = JSON.parse((await command("docker", ["network", "inspect", network], { env: containerEnv })).toString());
    assert.equal(networkInfo.length, 1); assert.equal(networkInfo[0].Internal, true);
    assert.equal(networkInfo[0].Name, network); assert.equal(networkInfo[0].Labels["ucmarketplace.restore-drill"], id);
    attempted = true;
    startupFailureCode = "RESTORE_CONTAINER_CREATE_FAILED";
    await command("docker", ["run", "--detach", "--rm", "--name", name, "--label", `ucmarketplace.restore-drill=${id}`,
      "--network", network,
      "--read-only", "--security-opt", "no-new-privileges:true", "--tmpfs", "/var/lib/postgresql/data:rw,size=768m",
      "--tmpfs", "/var/run/postgresql:rw,size=16m", "--tmpfs", "/tmp:rw,size=32m", "--env", "POSTGRES_PASSWORD", pins.postgresImage],
    { env: containerEnv, timeoutMs: 180000 });
    startupFailureCode = "RESTORE_CONTAINER_INSPECT_FAILED";
    const container = await assertDrillContainer(containerEnv);
    assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [network]);
    assert.ok(Object.values(container.NetworkSettings.Ports).every(bindings => !bindings?.length));
    startupFailureCode = "RESTORE_TUNNEL_FAILED";
    tunnel = await openRestoreTunnel(containerEnv);
    startupFailureCode = "RESTORE_DATABASE_NOT_READY";
    const options = { host: tunnel.host, port: tunnel.port, user: "postgres", password: containerEnv.POSTGRES_PASSWORD,
      ssl: false, database: "postgres", connectionTimeoutMillis: 2000, statement_timeout: 60000 };
    for (let attempt = 0; attempt < 40; attempt++) {
      const pending = new pg.Client(options);
      try { await pending.connect(); client = pending; break; } catch { await pending.end(); await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    assert.ok(client, Object.assign(new Error("Isolated restoration database did not start."), { operationCodes: ["RESTORE_DATABASE_NOT_READY"] }));
    phase = "restore-archive";
    await client.query("set timezone='UTC'");
    for (const role of manifest.database.roles) {
      assert.match(role.name, /^[a-z][a-z0-9_]{0,62}$/); assert.notEqual(role.name, "postgres");
      assert.ok(!role.name.startsWith("pg_") && typeof role.bypassrls === "boolean");
      await client.query(`create role "${role.name}" nologin ${role.bypassrls ? "bypassrls" : "nobypassrls"}`);
    }
    const archiveChunks = []; let archiveBytes = 0;
    await storage.dump(manifest.snapshots.database, "database", chunk => {
      archiveBytes += chunk.length; assert.ok(archiveBytes <= 128 * 1024 * 1024, "Synthetic archive exceeds its isolation limit."); archiveChunks.push(chunk);
    });
    const archive = Buffer.concat(archiveChunks);
    const toc = (await command("docker", ["exec", "--interactive", name, "pg_restore", "--list"], { env: containerEnv, input: archive })).toString();
    const archiveSchemas = [...toc.matchAll(/^\d+; \d+ \d+ SCHEMA - ([a-z_]+) /gm)].map(match => match[1]);
    assert.ok(archiveSchemas.every(schema => schemas.includes(schema)));
    const existing = (await client.query("select count(*)::int as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'")).rows[0].count;
    assert.equal(existing, 0);
    if (archiveSchemas.includes("public")) await client.query("drop schema public");
    // The only target is the exact just-created, labelled container, never a supplied database URL.
    await assertDrillContainer(containerEnv);
    await command("docker", ["exec", "--interactive", name, "pg_restore", "--username=postgres", "--dbname=postgres", "--single-transaction", "--no-owner", "--exit-on-error"],
      { env: containerEnv, input: archive, postgresRestoreDiagnostics: true });
    evidence.databaseRestored = true;
    phase = "restore-fingerprints";
    try { await client.query(publicationRestoreSql(manifest.database.publication)); }
    catch { throw Object.assign(new Error("Restored publication verification failed."), { operationCodes: ["RESTORE_PUBLICATION_FAILED"] }); }
    verifyTableFingerprints(await tableFingerprints(client), manifest.database.fingerprints); evidence.tablesMatched = true;
    assert.ok(inventoryDigest((await client.query(inventorySql)).rows) === manifest.inventorySha256,
      Object.assign(new Error("Restored Storage metadata differs from the captured inventory."), { operationCodes: ["RESTORE_STORAGE_INVENTORY_MISMATCH"] }));
    phase = "restore-security";
    for (const filename of NATIVE_CATALOG_CHECKS) {
      const rows = (await executeSqlScript({ exec: async sql => {
        const result = await client.query(sql);
        return (Array.isArray(result) ? result : [result]).map(item => ({ rows: item.rows ?? [] }));
      } }, await readFile(path.join(root, "supabase/checks", filename), "utf8"))).flatMap(item => item.rows);
      const assertions = rows.filter(row => typeof row.passed === "boolean");
      assert.ok(assertions.length && assertions.every(row => row.passed)); evidence.catalogAssertions += assertions.length;
    }
    const student = (await client.query("select id from public.profiles where role='student' and verification_status='verified' and account_status='active' and exists(select 1 from storage.objects o where o.bucket_id='student-verifications' and o.owner_id=profiles.id::text) limit 1")).rows[0];
    assert.ok(student);
    const own = (await client.query("select count(*)::int as count from storage.objects where bucket_id='student-verifications' and owner_id=$1", [student.id])).rows[0].count;
    await client.query("begin");
    try {
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [student.id]); await client.query("set local role authenticated");
      assert.equal((await client.query("select count(*)::int as count from storage.objects where bucket_id='student-verifications' and owner_id<>auth.uid()::text")).rows[0].count, 0); evidence.restoredAccessChecks++;
      assert.equal((await client.query("select count(*)::int as count from storage.objects where bucket_id='student-verifications' and owner_id=auth.uid()::text")).rows[0].count, own); evidence.restoredAccessChecks++;
      assert.equal((await client.query("select count(*)::int as count from public.profiles where role='admin' and id=auth.uid()")).rows[0].count, 0); evidence.restoredAccessChecks++;
    } finally { await client.query("rollback"); }
    phase = "restore-files";
    const files = new Map();
    for (const component of ["media", "verification"]) {
      const input = new PassThrough();
      try { await Promise.all([
        decodeStoragePack(input, { projectRef: manifest.projectRef, runId: manifest.runId, component, maxObjects: selected.maxObjects, maxStorageBytes: selected.maxStorageBytes }, async (object, bytes) => {
          const expected = manifest.storage.inventory.find(item => item.bucket_id === object.bucket_id && item.name === object.name);
          assert.ok(expected); assert.deepEqual(object, { ...expected, size: Number(expected.metadata.size) });
          const key = `${object.bucket_id}/${object.name}`; assert.ok(!files.has(key)); files.set(key, bytes);
        }),
        storage.dump(manifest.snapshots[component], component, chunk => writeStream(input, chunk)).finally(() => input.end()),
      ]); } finally { input.destroy(); }
    }
    assert.equal(files.size, manifest.storage.objects);
    assert.equal([...files.values()].reduce((sum, bytes) => sum + bytes.length, 0), manifest.storage.bytes);
    evidence.storageRestored = true; evidence.objectsRestored = files.size;
    phase = "restore-image";
    const image = (await client.query("select storage_path from public.listing_images order by id limit 1")).rows[0];
    const bytes = files.get(`listing-images/${image?.storage_path}`); assert.ok(bytes);
    browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    await page.setContent(`<img alt="Restored synthetic listing" src="data:image/png;base64,${bytes.toString("base64")}">`);
    assert.equal(await page.locator("img").evaluate(async image => { await image.decode(); return image.naturalWidth > 0; }), true);
    evidence.imageDecoded = true; evidence.status = "passed";
  } catch (error) {
    error.operationPhase = phase;
    if (!error.operationCodes?.length) error.operationCodes = [phase === "restore-container" ? startupFailureCode : "RESTORE_STEP_FAILED"];
    throw error;
  } finally {
    await browser?.close().catch(() => {}); await client?.end().catch(() => {});
    await tunnel?.close();
    if (attempted) {
      const owned = (await command("docker", ["ps", "--all", "--filter", `label=ucmarketplace.restore-drill=${id}`, "--filter", `name=^/${name}$`, "--format", "{{.ID}}"], { env: containerEnv })).toString().trim();
      if (owned) { await assertDrillContainer(containerEnv, false); await command("docker", ["rm", "--force", name], { env: containerEnv }); }
    }
    if (networkAttempted) {
      const owned = (await command("docker", ["network", "ls", "--filter", `label=ucmarketplace.restore-drill=${id}`, "--format", "{{.Name}}"], { env: containerEnv })).toString().trim();
      if (owned) {
        assert.equal(owned, network);
        const inspected = JSON.parse((await command("docker", ["network", "inspect", network], { env: containerEnv })).toString());
        assert.equal(inspected.length, 1); assert.equal(inspected[0].Labels["ucmarketplace.restore-drill"], id);
        assert.equal(inspected[0].Name, network); assert.equal(inspected[0].Internal, true);
        await command("docker", ["network", "rm", network], { env: containerEnv });
      }
    }
    evidence.cleanup = true; evidence.elapsedSeconds = Math.ceil((Date.now() - started) / 1000); evidence.completedAt = new Date().toISOString();
  }
  assert.equal(evidence.status, "passed");
  return evidence;
}
