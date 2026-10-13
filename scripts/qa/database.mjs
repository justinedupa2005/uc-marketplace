import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { DATABASE_BOOTSTRAP } from "./lib/database-bootstrap.mjs";
import {
  DEFAULT_DATABASE_CHECKS, executeSqlScript, summarizeDatabaseChecks, validateDatabaseCheckNames,
} from "./lib/database-harness.mjs";

// Intentionally accepts neither credentials nor a connection URL. Every run
// creates a new in-memory database and reads only tracked migration/check SQL.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const checksDirectory = path.join(root, "supabase/checks");
const argumentsList = process.argv.slice(2);
if (argumentsList.includes("--help")) {
  console.log("Usage: node scripts/qa/database.mjs [check_basename.sql ...] | --list");
  console.log("Default: deterministic embedded database security/workflow suite. No remote connections.");
  process.exit(0);
}
if (argumentsList.includes("--list")) {
  console.log(DEFAULT_DATABASE_CHECKS.join("\n"));
  process.exit(0);
}
const files = validateDatabaseCheckNames(
  argumentsList.length ? argumentsList : DEFAULT_DATABASE_CHECKS,
  await readdir(checksDirectory),
);
const database = await PGlite.create({ extensions: { pgcrypto, pg_trgm } });
let failureCount = 0;
let total = 0;
let migrationCount = 0;
try {
  await database.exec(DATABASE_BOOTSTRAP);
  console.log((await database.query("select version()")).rows[0].version);
  const migrations = (await readdir(path.join(root, "supabase/migrations")))
    .filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) {
    try {
      await database.exec(await readFile(path.join(root, "supabase/migrations", name), "utf8"));
      migrationCount++;
      console.log(`Migration passed: ${name}`);
    } catch (error) {
      throw new Error(`Migration failed: ${name} (${error.code ?? "unknown"}): ${error.message}`);
    }
  }
  for (const name of files) {
    try {
      const results = await executeSqlScript(database, await readFile(path.join(checksDirectory, name), "utf8"));
      const result = summarizeDatabaseChecks(results);
      total += result.count;
      failureCount += result.failures.length;
      console.log(`${name}: ${result.count} checks, ${result.failures.length} failed`);
      for (const failure of result.failures) console.error(JSON.stringify(failure));
    } catch (error) {
      failureCount++;
      console.error(`SQL check script failed: ${name} (${error.code ?? "unknown"}): ${error.message}`);
      await database.exec("rollback; reset role;");
    }
  }
  console.log(`Embedded SQL result: ${migrationCount} migrations, ${total} individual checks, ${failureCount} failed.`);
  console.log("Limits: emulated Supabase auth/storage SQL; no hosted Auth, API, Storage HTTP, Realtime, or simultaneous PostgreSQL connections tested.");
  console.log("True acceptance/sale races must also be run against isolated real PostgreSQL/Supabase sessions before release.");
} catch (error) {
  failureCount++;
  console.error(error.message);
} finally {
  await database.close();
}
process.exitCode = failureCount ? 1 : 0;
