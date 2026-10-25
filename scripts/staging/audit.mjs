import { readFile } from "node:fs/promises";
import path from "node:path";
import { createManagementApi, loadMigrations, planMigrations, root, verifyStagingProject } from "./lib.mjs";
import { compareSchema, contractSql, expectedSchema } from "./schema.mjs";
import { NATIVE_CATALOG_CHECKS } from "../qa/lib/quality-gates.mjs";
import { executeSqlScript } from "../qa/lib/database-harness.mjs";

let phase = "configuration";
export async function auditStaging(env = process.env) {
  const api = createManagementApi(env);
  await verifyStagingProject(api);
  const read = (query) => api("/database/query/read-only", { method: "POST", body: { query } });
  const migrations = await loadMigrations();
  phase = "migration history";
  const history = await read("select m.version,m.name,c.checksum from supabase_migrations.schema_migrations m left join supabase_migrations.uc_staging_checksums c using(version) order by m.version");
  const pending = planMigrations(migrations, history);
  if (history.some((row) => migrations.find((item) => item.version === row.version)?.name !== row.name)) throw new Error("Migration name drift.");
  const applied = migrations.filter((item) => history.some((row) => row.version === item.version));
  phase = "schema drift";
  const drift = compareSchema(await expectedSchema(applied), await read(contractSql));
  // Counts only: function bodies, policies and database identifiers may contain
  // private Dashboard edits. Never dump the differing definitions or errors.
  console.log(`Staging history: ${history.length} applied, ${pending.length} pending. Schema comparison: ${drift.missing.length} missing, ${drift.unexpected.length} unexpected, ${drift.changed.length} changed objects.`);
  if (Object.values(drift).some((items) => items.length)) throw new Error("Staging schema drift requires review; no repairs or writes attempted.");
  let checks = 0;
  for (const file of NATIVE_CATALOG_CHECKS) {
    if (file === "messaging_security.sql" && pending.some((item) => item.name === "enable_secure_messaging_realtime")) continue;
    phase = `catalog ${file}`;
    // The Management API returns only the last statement's result. Execute
    // read-only catalog SELECTs individually so earlier assertions aren't lost.
    let source = await readFile(path.join(root, "supabase/checks", file), "utf8");
    if (file === "reservation_meetup_security.sql" && pending.some((item) => item.name === "use_non_retryable_business_conflicts")) {
      // Pre-apply inspection checks the deployed contract, not the future error
      // mapping. The full definition comparison above still rejects any drift.
      source = source.replaceAll("''PT409''", "''40001''");
    }
    const result = await executeSqlScript({ exec: async (query) => [{ rows: await read(query) }] }, source);
    const rows = result.flatMap((item) => item.rows);
    const assertions = rows.filter((row) => typeof row.passed === "boolean");
    if (!assertions.length || assertions.some((row) => !row.passed)) {
      console.log(`Staging catalog result: ${assertions.length} assertions, ${assertions.filter((row) => !row.passed).length} failed.`);
      throw new Error("Staging security catalog assertions failed.");
    }
    checks += assertions.filter((row) => !String(row.check_name ?? row.scenario ?? "").startsWith("__")).length;
  }
  const publication = await read("select schemaname,tablename from pg_catalog.pg_publication_tables where pubname='supabase_realtime'");
  if (publication.some((row) => row.schemaname !== "public" || row.tablename !== "messages")) throw new Error("Unexpected Realtime publication; private tables must not be published.");
  if (!pending.length && publication.length !== 1) throw new Error("Messaging Realtime publication is missing.");
  if (!pending.length) {
    const flags = await read("select puballtables,pubinsert,pubupdate,pubdelete,pubtruncate from pg_catalog.pg_publication where pubname='supabase_realtime'");
    if (flags.length !== 1 || flags[0].puballtables || !flags[0].pubinsert || !flags[0].pubupdate || flags[0].pubdelete || flags[0].pubtruncate) throw new Error("Unsafe messaging publication event flags.");
  }
  console.log(`Staging audit passed ${checks} native security assertions and definition/grant drift comparison. ${pending.length ? "Pending migrations require explicit review and apply." : "Schema is current; only messages are published."} No student rows were selected or modified.`);
  return { applied: history.length, pending: pending.length, catalogAssertions: checks };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(root, "scripts/staging/audit.mjs")) {
  try {
    if (process.argv.length !== 2) throw new Error("Unexpected audit arguments.");
    await auditStaging();
  } catch {
    console.log(`Staging audit did not pass during ${phase}. Review privately; no automatic repair/reset or production fallback was attempted.`);
    process.exitCode = 1;
  }
}
