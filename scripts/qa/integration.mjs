import { once } from "node:events";
import { readFile, stat } from "node:fs/promises";
import net from "node:net";
import { setTimeout as pause } from "node:timers/promises";
import pg from "pg";
import { assertQaDotenvSafety, getQaAppEnvironment, getQaBrowserEnvironment, readQaEnvironment } from "./lib/environment.mjs";
import { accountEnvironment, cleanupFixtures, createFixtureContext, createSignupFixture, provisionAccounts } from "./lib/fixtures.mjs";
import { runApiChecks } from "./lib/api.mjs";
import { runConcurrencyChecks } from "./lib/concurrency.mjs";
import { runRealtimeChecks } from "./lib/realtime.mjs";
import { runEmailChecks } from "./lib/email.mjs";
import { createQaFetch, installQaInterruptHandler, launchQaProcess, QaProcessError } from "./lib/process.mjs";
import { createAcceptanceFailure, createAcceptancePhase, createAcceptanceSummary } from "./lib/acceptance-summary.mjs";
import { parseBrowserAcceptance } from "./lib/browser-acceptance.mjs";

const apiOnly = process.argv.includes("--api-only");
if (process.argv.slice(2).some((argument) => argument !== "--api-only")) throw new Error("Usage: node scripts/qa/integration.mjs [--api-only]");

let activeProcess;
let server;
const requestController = new AbortController();
let requestSignal = requestController.signal;
const originalFetch = globalThis.fetch;
globalThis.fetch = createQaFetch({ fetchImpl: originalFetch, signal: () => requestSignal });
const interruption = installQaInterruptHandler(async () => {
  requestController.abort();
  await Promise.allSettled([activeProcess?.stop(), server?.stop()]);
});

function assertRunHealthy() {
  interruption.throwIfInterrupted();
  server?.assertHealthy();
}

async function runNode(args, env, label) {
  interruption.throwIfInterrupted();
  activeProcess = launchQaProcess({ command: process.execPath, args, env, label,
    failOnUnhandledRuntime: true, progressIntervalMs: 30_000,
    onProgress: () => console.log(`${label} is still running; sensitive diagnostics are withheld.`) });
  try { await activeProcess.wait({ timeoutMs: 900_000 }); }
  finally { activeProcess = null; }
  interruption.throwIfInterrupted();
  console.log(`${label} passed.`);
}

async function requireFreePort(port) {
  const probe = net.createServer();
  try {
    probe.listen(Number(port), "127.0.0.1");
    await once(probe, "listening");
  } catch { throw new Error("QA application port is already in use. Stop that server or choose a separate QA_APP_BASE_URL."); }
  finally { if (probe.listening) await new Promise((resolve) => probe.close(resolve)); }
}

async function waitForApp(server, baseUrl) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    interruption.throwIfInterrupted();
    server.assertHealthy();
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: "manual", signal: AbortSignal.timeout(1500) });
      if (response.status === 200) { server.assertHealthy(); return; }
    } catch { /* Startup may briefly refuse connections. */ }
    await pause(200);
  }
  throw new Error("Dedicated QA server did not become ready.");
}

let pool;
let context;
let completedSummary;
let completedMessage;
let phase = "configuration";
function setPhase(next) {
  const progress = createAcceptancePhase({ phase: next });
  phase = progress.phase;
  console.log(`QA_PHASE_JSON:${JSON.stringify(progress)}`);
}
let acceptanceFailure;
let cleanupFailed = false;
try {
  const config = await readQaEnvironment({ requireDatabase: true, requireLocal: !apiOnly, requireMailpit: !apiOnly });
  if (!apiOnly) await assertQaDotenvSafety();
  setPhase("database");
  pool = new pg.Pool({ connectionString: config.databaseUrl, max: 6, connectionTimeoutMillis: 10_000,
    query_timeout: 30_000, statement_timeout: 30_000, application_name: "ucmarketplace-disposable-qa" });
  pool.on("error", () => {
    requestController.abort();
    process.exitCode = 1;
    console.error("QA database connection failed; acceptance cannot be recorded as passed.");
  });
  await pool.query("select 1");
  if (!apiOnly) {
    await requireFreePort(config.appPort);
    const appEnvironment = getQaAppEnvironment(config);
    setPhase("build");
    console.log("Building the production application against explicit disposable QA public configuration.");
    await runNode(["node_modules/next/dist/bin/next", "build"], appEnvironment, "Production QA build");
    await runNode(["scripts/qa/security-hygiene.mjs", "--bundles"], appEnvironment, "Production browser bundle security");
    setPhase("server");
    server = launchQaProcess({ command: process.execPath, args: ["node_modules/next/dist/bin/next", "start", "-p", config.appPort, "-H", "127.0.0.1"], env: appEnvironment, label: "Dedicated QA application server", failOnUnhandledRuntime: true });
    await waitForApp(server, config.appBaseUrl);
  }
  context = createFixtureContext(config, pool);
  setPhase("provisioning");
  await provisionAccounts(context);
  assertRunHealthy();
  setPhase("api");
  const apiCount = await runApiChecks(context);
  assertRunHealthy();
  setPhase("concurrency");
  const concurrencyCount = await runConcurrencyChecks(context);
  assertRunHealthy();
  setPhase("realtime");
  const realtime = await runRealtimeChecks(context);
  assertRunHealthy();
  setPhase("email");
  const emailCount = apiOnly ? 0 : await runEmailChecks(context, { createSignupFixture });
  assertRunHealthy();
  if (!apiOnly) {
    setPhase("browser");
    console.log("Running isolated browser-account workflows; traces, screenshots, video, and persisted session state are disabled.");
    const browserStartedAt = Date.now();
    await runNode(["node_modules/@playwright/test/cli.js", "test", "--project=anonymous-chromium", "--project=qa-chromium", "--forbid-only"], {
      ...getQaBrowserEnvironment(config), ...accountEnvironment(context.accounts),
      QA_SUPABASE_URL: config.supabaseUrl,
      QA_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
      QA_APP_BASE_URL: config.appBaseUrl,
      QA_BROWSER_ALLOW_MUTATIONS: "1",
      QA_MAILPIT_URL: config.mailpitUrl,
    }, "Authenticated browser acceptance");
    const reportPath = "node_modules/.cache/uc-qa-browser/report.json";
    if ((await stat(reportPath)).mtimeMs < browserStartedAt) throw new Error("QA browser report is stale; no completed acceptance evidence is available.");
    const browserCounts = parseBrowserAcceptance(JSON.parse(await readFile(reportPath, "utf8")));
    if (!browserCounts) throw new Error("QA browser report does not confirm every required anonymous and authenticated suite.");
    console.log(`Browser acceptance passed ${browserCounts.anonymousTests} anonymous and ${browserCounts.authenticatedTests} authenticated tests.`);
  }
  assertRunHealthy();
  completedSummary = createAcceptanceSummary({ apiChecks: apiCount, concurrencyScenarios: concurrencyCount, realtimeScenarios: realtime.count, emailAuthChecks: emailCount, authenticatedBrowser: !apiOnly, apiOnly });
  completedMessage = `QA completed: ${apiCount} direct API checks, ${concurrencyCount} real concurrency scenarios and ${realtime.count} Realtime scenarios${apiOnly ? "; browser and SMTP acceptance NOT run" : `; ${emailCount} local SMTP Auth checks and authenticated browser suite passed; external SMTP delivery remains separate`}.`;
} catch (error) {
  acceptanceFailure = createAcceptanceFailure({ phase, code: error?.qaErrorCode ?? error?.code,
    httpStatus: error?.qaHttpStatus, assertion: error?.qaAssertionIndex,
    processReason: error instanceof QaProcessError ? error.reason : null });
  // Never print raw service responses, connection strings, passwords or tokens.
  const controlled = error instanceof QaProcessError || /^QA_|^Set QA_|^QA |^Full-stack QA|^Full local|^Dedicated QA|^Direct API security|^Realtime acceptance|^Email acceptance|^Local Mailpit|^Mailpit|^Remote QA|^The repository|^Browser QA|^Full browser/.test(error?.message ?? "");
  console.error(`QA failed: ${controlled ? error.message : "Acceptance could not complete. Inspect only the disposable services and sanitized test results."}`);
  process.exitCode = 1;
} finally {
  console.log(`QA_PHASE_JSON:${JSON.stringify(createAcceptancePhase({ phase: "cleanup" }))}`);
  // An interrupt cancels normal requests, but owned fixture cleanup still gets
  // bounded HTTP requests with a fresh signal before the wrapper is restored.
  requestSignal = new AbortController().signal;
  if (server) {
    try {
      if (!interruption.signal) server.assertHealthy();
    } catch { console.error("QA application server stopped or failed before expected shutdown."); process.exitCode = 1; cleanupFailed = true; }
    try { await server.stop(); server.assertNoFailures(); }
    catch { console.error("QA application shutdown failed; inspect only the server created by this invocation."); process.exitCode = 1; cleanupFailed = true; }
  }
  if (context) {
    try { await cleanupFixtures(context); }
    catch { console.error("QA cleanup failed. Inspect ONLY the run-owned fixture accounts before retrying; no broad deletion was attempted."); process.exitCode = 1; cleanupFailed = true; }
  }
  try { await pool?.end(); }
  catch { console.error("QA database cleanup failed; no completed acceptance summary will be emitted."); process.exitCode = 1; cleanupFailed = true; }
  finally {
    await interruption.settled;
    if (interruption.signal) process.exitCode = interruption.signal === "SIGINT" ? 130 : 143;
    interruption.dispose();
    globalThis.fetch = originalFetch;
  }
}

if (process.exitCode) {
  console.log(`QA_FAILURE_JSON:${JSON.stringify(createAcceptanceFailure({ ...(acceptanceFailure ?? { phase: completedSummary ? "cleanup" : phase }), cleanupFailed }))}`);
} else if (completedSummary) {
  console.log(completedMessage);
  console.log(`QA_SUMMARY_JSON:${JSON.stringify(completedSummary)}`);
}
