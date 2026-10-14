import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { DATABASE_BOOTSTRAP } from "../scripts/qa/lib/database-bootstrap.mjs";
import { executeSqlScript, summarizeDatabaseChecks } from "../scripts/qa/lib/database-harness.mjs";

const root = new URL("../", import.meta.url);
const fixtureTables = ["auth.users", "public.profiles", "public.categories", "public.listings",
  "public.listing_images", "public.conversations", "public.messages", "public.notifications", "storage.objects"];

async function snapshot(database) {
  return Promise.all(fixtureTables.map(async (name) => ({ name,
    count: (await database.query(`select count(*)::integer as count from ${name}`)).rows[0].count,
  })));
}

test("messaging smoke rolls back all fixtures while native-style Storage deletion protection stays enabled", async () => {
  const database = await PGlite.create({ extensions: { pgcrypto, pg_trgm } });
  try {
    await database.exec(DATABASE_BOOTSTRAP);
    const migrations = new URL("supabase/migrations/", root);
    for (const name of (await readdir(migrations)).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
      await database.exec(await readFile(new URL(name, migrations), "utf8"));
    }
    // Emulate the upstream service's statement-level catalog protection, not a
    // weaker delete policy. Even a DELETE matching zero rows must be rejected.
    await database.exec(`
      create function storage.qa_protect_catalog_delete() returns trigger language plpgsql as $$
      begin
        if current_setting('storage.allow_delete_query', true) is distinct from 'true' then
          raise exception 'Storage catalog deletion is protected.' using errcode = '42501';
        end if;
        return null;
      end;
      $$;
      create trigger qa_protect_catalog_delete before delete on storage.objects
      for each statement execute function storage.qa_protect_catalog_delete();
    `);
    const before = await snapshot(database);
    assert.ok(before.find((entry) => entry.name === "public.categories").count > 0);
    const source = await readFile(new URL("supabase/checks/messaging_rls_smoke.sql", root), "utf8");
    for (let run = 0; run < 2; run++) {
      const summary = summarizeDatabaseChecks(await executeSqlScript(database, source));
      assert.equal(summary.count, 36);
      assert.deepEqual(summary.failures, []);
      assert.deepEqual(await snapshot(database), before);
      const temporary = await database.query("select to_regclass('pg_temp.step10_messaging_results') as results, to_regclass('pg_temp.step10_messaging_subjects') as subjects");
      assert.deepEqual(temporary.rows, [{ results: null, subjects: null }]);
      const guard = await database.query("select current_setting('storage.allow_delete_query', true) as bypass, tgenabled from pg_trigger where tgname = 'qa_protect_catalog_delete'");
      assert.notEqual(guard.rows[0].bypass, "true");
      assert.equal(guard.rows[0].tgenabled, "O");
      await assert.rejects(database.exec("delete from storage.objects where false"), (error) => error.code === "42501");
    }
  } finally { await database.close(); }
});
