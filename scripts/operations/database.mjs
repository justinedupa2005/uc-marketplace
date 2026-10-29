import assert from "node:assert/strict";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { validateStagingCa } from "../staging/tls.mjs";
import { validateTarget } from "./policy.mjs";
import { command, controlledEnvironment } from "./process.mjs";
import path from "node:path";
import { assertLocalDockerEndpoint } from "../qa/lib/local-stack.mjs";

export const schemas = ["public", "private", "auth", "storage", "supabase_migrations", "extensions"];
export const inventorySql = `select bucket_id,name,owner_id,metadata,updated_at::text,
  to_jsonb(o)->>'version' as version from storage.objects o order by bucket_id,name`;

export async function connect(env) {
  const selected = validateTarget(env), url = new URL(env.OPS_DATABASE_URL);
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.pathname, "/postgres");
  assert.equal(url.port || "5432", "5432", "Use the session connection, not transaction pooling.");
  assert.equal(url.search, ""); assert.equal(url.hash, "");
  assert.ok(url.password && ((url.hostname === `db.${selected.supabaseProjectRef}.supabase.co` && url.username === "postgres")
    || (/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) && url.username === `postgres.${selected.supabaseProjectRef}`)));
  const ca = validateStagingCa(await readFile(env.OPS_CA_FILE, "utf8"));
  const options = { host: url.hostname, port: 5432, database: "postgres", user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 15000, statement_timeout: 30000, query_timeout: 35000,
    application_name: "ucmarketplace-read-only-backup-monitor" };
  const client = new pg.Client(options);
  await client.connect();
  try {
    await client.query("set default_transaction_read_only=on");
    return { client, pgEnv: { PGHOST: options.host, PGPORT: "5432", PGDATABASE: options.database, PGUSER: options.user,
      PGPASSWORD: options.password, PGSSLMODE: "verify-full", PGSSLROOTCERT: env.OPS_CA_FILE, PGCONNECT_TIMEOUT: "15", PGOPTIONS: "-c default_transaction_read_only=on" } };
  } catch { await client.end(); throw new Error("Read-only database connection failed."); }
}

export function validateExportedSnapshot(value) {
  assert.match(value, /^[0-9A-F]{8}-[0-9A-F]{8}-[0-9]+$/);
  return value;
}

export async function importSnapshot(client, snapshot) {
  await client.query("begin isolation level repeatable read read only");
  await client.query(`set transaction snapshot '${validateExportedSnapshot(snapshot)}'`);
}

export async function databaseManifest(client) {
  const tables = (await client.query(`select n.nspname as schema,c.relname as name,c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=any($1::text[]) and c.relkind='r' order by 1,2`, [schemas])).rows;
  const quote = value => `"${value.replaceAll('"', '""')}"`;
  const counts = [];
  for (const table of tables) {
    const result = await client.query(`select count(*)::text as count from ${quote(table.schema)}.${quote(table.name)}`);
    counts.push({ ...table, count: result.rows[0].count });
  }
  assert.ok(counts.some(row => row.schema === "auth" && row.name === "users"));
  for (const name of ["profiles", "listings", "listing_images", "favorites", "conversations", "messages", "reservations", "meetups", "verifications", "listing_reports", "student_reports"]) {
    assert.ok(counts.some(row => row.schema === "public" && row.name === name && row.rls), "Missing protected application table.");
  }
  const serverVersion = (await client.query("show server_version_num")).rows[0].server_version_num;
  const publication = (await client.query(`select p.pubname,p.puballtables,p.pubinsert,p.pubupdate,p.pubdelete,p.pubtruncate,
    coalesce((select jsonb_agg(jsonb_build_object('schema',t.schemaname,'table',t.tablename) order by t.schemaname,t.tablename)
    from pg_publication_tables t where t.pubname=p.pubname),'[]'::jsonb) as tables from pg_publication p where p.pubname='supabase_realtime'`)).rows;
  assert.equal(publication.length, 1);
  publicationRestoreSql(publication[0]);
  return { format: "postgres-custom", schemas, serverVersion, tables: counts, publication: publication[0] };
}

export function publicationRestoreSql(value) {
  // Publications are database-global, not schema-local. pg_dump --schema does
  // not capture them; keep their exact security contract inside the encrypted
  // completion manifest and recreate only in a fresh isolated restore target.
  assert.deepEqual(value, { pubname: "supabase_realtime", puballtables: false, pubinsert: true, pubupdate: true, pubdelete: false, pubtruncate: false,
    tables: [{ schema: "public", table: "messages" }] });
  return "create publication supabase_realtime with (publish='insert, update'); alter publication supabase_realtime add table public.messages;";
}

export async function dumpDatabase(env, output) {
  const { client, pgEnv } = await connect(env);
  try {
    const server = Number((await client.query("show server_version_num")).rows[0].server_version_num);
    const base = controlledEnvironment(env);
    for (const key of Object.keys(base)) if (/^(OPS_|AWS_|RESTIC_)/.test(key)) delete base[key];
    let binary = env.OPS_PG_DUMP_BINARY || "docker", prefix = [], childEnv = { ...base, ...pgEnv };
    if (!env.OPS_PG_DUMP_BINARY) {
      const endpoint = JSON.parse((await command("docker", ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"])).toString());
      assertLocalDockerEndpoint(endpoint);
      const pins = JSON.parse(await readFile(new URL("../../config/operations-tools.json", import.meta.url), "utf8"));
      assert.ok(path.isAbsolute(env.OPS_CA_FILE) && !/[\r\n,]/.test(env.OPS_CA_FILE));
      childEnv = { ...childEnv, PGSSLROOTCERT: "/provider-ca.crt" };
      prefix = ["run", "--rm", "--read-only", "--cap-drop=ALL", "--security-opt", "no-new-privileges:true",
        "--mount", `type=bind,source=${env.OPS_CA_FILE},target=/provider-ca.crt,readonly`,
        ...Object.keys(pgEnv).flatMap(key => ["--env", key]), "--entrypoint", "pg_dump", pins.postgresImage];
    }
    const version = (await command(binary, [...prefix, "--version"], { env: childEnv, timeoutMs: 180000 })).toString();
    const match = /pg_dump \(PostgreSQL\) (\d+)\.(\d+)/.exec(version);
    const major = Number(match?.[1]), minor = Number(match?.[2]);
    assert.ok((major === 17 && minor >= 11 || major === 18 && minor >= 5) && major >= Math.floor(server / 10000), "Use reviewed patched PostgreSQL clients matching or newer than the source.");
    // Preserve grants/RLS, custom functions, auth and storage metadata. No data
    // SQL or password hashes are written to local plaintext files.
    const args = ["--format=custom", "--no-password", "--lock-wait-timeout=30s", `--snapshot=${validateExportedSnapshot(env.OPS_EXPORTED_SNAPSHOT)}`,
      ...schemas.map(schema => `--schema=${schema}`)];
    await command(binary, [...prefix, ...args], { env: childEnv, output, timeoutMs: 900000 });
  } finally { await client.end(); }
}
