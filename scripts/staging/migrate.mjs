import { createManagementApi, loadMigrations, migrationQuery, planMigrations, verifyStagingProject } from "./lib.mjs";

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => !["--plan", "--apply"].includes(arg))) throw new Error("Use --plan (default) or --apply.");
  const api = createManagementApi(process.env);
  await verifyStagingProject(api);
  const read = (query) => api("/database/query/read-only", { method: "POST", body: { query } });
  const present = await read("select to_regclass('supabase_migrations.schema_migrations') is not null as history, to_regclass('supabase_migrations.uc_staging_checksums') is not null as checksums");
  let applied = [];
  if (present[0]?.history) {
    const count = await read("select count(*)::int as count from supabase_migrations.schema_migrations");
    if (count[0]?.count && !present[0]?.checksums) throw new Error("Existing migration history requires explicit checksum reconciliation; refusing adoption.");
    if (present[0]?.checksums) applied = await read("select m.version,c.checksum from supabase_migrations.schema_migrations m left join supabase_migrations.uc_staging_checksums c using(version) order by m.version");
  }
  const pending = planMigrations(await loadMigrations(), applied);
  console.log(`Staging migration plan: ${applied.length} applied, ${pending.length} pending.`);
  if (!args.includes("--apply")) {
    console.log("Read-only plan completed. No schema or application data changed.");
  } else {
    const write = (query) => api("/database/query", { method: "POST", body: { query } });
    await write(`begin;
create schema if not exists supabase_migrations;
revoke all on schema supabase_migrations from public,anon,authenticated;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
create table if not exists supabase_migrations.uc_staging_checksums (version text primary key references supabase_migrations.schema_migrations(version), checksum text not null);
revoke all on all tables in schema supabase_migrations from public,anon,authenticated;
commit;`);
    for (const item of pending) {
      await write(migrationQuery(item));
      console.log(`Applied staging migration ${item.version}.`);
    }
    const actual = await read("select m.version,c.checksum from supabase_migrations.schema_migrations m left join supabase_migrations.uc_staging_checksums c using(version) order by m.version");
    if (planMigrations(await loadMigrations(), actual).length) throw new Error("Staging migration validation incomplete.");
    console.log("Registered staging schema and migration checksums validated. Production was not targeted.");
  }
} catch (error) {
  // Only our static errors may be displayed; never raw service/SQL responses.
  console.error(error instanceof Error && /^(?:Staging |Explicit |A staging|No versioned|Out-of-order|Existing migration|Use --|Registered)/.test(error.message)
    ? error.message : "Staging migration failed; private details withheld. Re-run --plan before any retry.");
  process.exitCode = 1;
}
