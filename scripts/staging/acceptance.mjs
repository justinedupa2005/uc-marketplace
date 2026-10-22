import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { createManagementApi, root, staging, verifyStagingProject } from "./lib.mjs";
import { validateQaEnvironment } from "../qa/lib/environment.mjs";
import { createFixtureContext, provisionAccounts, cleanupFixtures } from "../qa/lib/fixtures.mjs";
import { runApiChecks } from "../qa/lib/api.mjs";
import { runConcurrencyChecks } from "../qa/lib/concurrency.mjs";
import { runRealtimeChecks } from "../qa/lib/realtime.mjs";
import { executeSqlScript, summarizeDatabaseChecks } from "../qa/lib/database-harness.mjs";
import { getStagingCa } from "./tls.mjs";
import { createQaFetch, installQaInterruptHandler } from "../qa/lib/process.mjs";

export function stagingPoolOptions(env, ca) {
  const config = validateQaEnvironment({ QA_ALLOW_MUTATIONS: "1", QA_ALLOW_REMOTE: "1",
    QA_ALLOWED_PROJECT_REF: staging.supabaseProjectRef, QA_SUPABASE_URL: `https://${staging.supabaseProjectRef}.supabase.co`,
    QA_SUPABASE_PUBLISHABLE_KEY: env.STAGING_PUBLISHABLE_KEY,
    QA_SUPABASE_SERVICE_ROLE_KEY: env.STAGING_SERVICE_ROLE_KEY, QA_DATABASE_URL: env.STAGING_DATABASE_URL,
  }, { requireDatabase: true });
  const target = new URL(config.databaseUrl);
  assert.ok(target.password && target.username);
  assert.equal(target.pathname, "/postgres");
  assert.ok(!target.port || target.port === "5432", "Use a session connection, not the transaction pooler.");
  // Do not pass connectionString: its sslmode option must not override verified
  // certificate validation. Credentials never enter arguments, files or output.
  return { config, options: { host: target.hostname, port: 5432, database: "postgres",
    user: decodeURIComponent(target.username), password: decodeURIComponent(target.password),
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) }, max: 6, connectionTimeoutMillis: 15_000,
    query_timeout: 30_000, statement_timeout: 30_000, application_name: "ucmarketplace-owned-staging-acceptance" } };
}

async function main() {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let requestSignal = controller.signal;
  globalThis.fetch = createQaFetch({ fetchImpl: originalFetch, signal: () => requestSignal });
  const interruption = installQaInterruptHandler(() => controller.abort());
  let pool, context;
  let passed = false;
  let phase = "configuration";
  try {
    assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "--database-only"));
    const api = createManagementApi(process.env);
    await verifyStagingProject(api);
    const { config, options } = stagingPoolOptions(process.env, await getStagingCa());
    pool = new pg.Pool(options);
    pool.on("error", () => { process.exitCode = 1; });
    const connection = await pool.connect();
    let messaging;
    try {
      phase = "transactional messaging SQL gate";
      const adapter = { exec: async (sql) => [await connection.query(sql)] };
      messaging = summarizeDatabaseChecks(await executeSqlScript(adapter, await readFile(path.join(root, "supabase/checks/messaging_rls_smoke.sql"), "utf8")));
      assert.ok(messaging.count >= 36 && !messaging.failures.length);
    } finally {
      try { await connection.query("rollback; reset role;"); } finally { connection.release(); }
    }
    console.log(`Staging messaging SQL gate passed ${messaging.count} assertions; every SQL fixture rolled back.`);
    if (!process.argv.includes("--database-only")) {
      phase = "run-owned Auth provisioning";
      context = createFixtureContext(config, pool);
      await provisionAccounts(context);
      phase = "direct API and Storage matrix";
      const apiChecks = await runApiChecks(context);
      phase = "concurrent transactions";
      const races = await runConcurrencyChecks(context);
      phase = "private Realtime and reconnect";
      const realtime = await runRealtimeChecks(context);
      console.log(`Staging acceptance body passed: ${apiChecks} API/Storage checks, ${races} concurrency scenarios, ${realtime.count} Realtime scenarios. Cleanup is still required.`);
    }
    interruption.throwIfInterrupted();
    passed = true;
  } catch (error) {
    const code = ["SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "28P01"].includes(error?.code) ? error.code : "unavailable";
    console.log(`Staging acceptance failed during ${phase} (code ${code}); private SQL, credentials and service responses withheld.`);
    if (Number.isSafeInteger(error?.qaAssertionIndex)) console.log(`Staging API assertion index: ${error.qaAssertionIndex}.`);
    if (Number.isSafeInteger(error?.qaAssertionIndex)) console.log(`Staging API failure metadata: ${error.qaErrorCode ?? "unavailable"}; HTTP ${error.qaHttpStatus ?? "unavailable"}.`);
    if (typeof error?.message === "string" && error.message.startsWith("Direct API security check failed:")) console.log(error.message);
    process.exitCode = 1;
  } finally {
    requestSignal = new AbortController().signal;
    if (context) {
      try { await cleanupFixtures(context); } catch { passed = false; process.exitCode = 1; console.error("Staging run-owned cleanup failed; do not reset or delete unrelated data."); }
    }
    try { await pool?.end(); } catch { passed = false; process.exitCode = 1; }
    await interruption.settled;
    if (interruption.signal) { passed = false; process.exitCode = 1; }
    interruption.dispose();
    globalThis.fetch = originalFetch;
  }
  if (passed && !process.exitCode) console.log("Staging acceptance and scoped cleanup passed. No production target, browser or SMTP acceptance is implied.");
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(root, "scripts/staging/acceptance.mjs")) await main();
