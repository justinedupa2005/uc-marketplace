import { mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import net from "node:net";
import pg from "pg";
import { assertQaDotenvSafety, getQaAppEnvironment } from "./lib/environment.mjs";
import { assertLocalDockerEndpoint, buildLocalQaConfig, LOCAL_QA_PORTS, qaEnvironmentFromLocalStatus } from "./lib/local-stack.mjs";
import { installQaInterruptHandler, launchQaProcess, resolveInstalledSupabaseBinary } from "./lib/process.mjs";
import { executeSqlScript, formatDatabaseCheckDiagnostics, MESSAGING_GATE_SCENARIOS, summarizeDatabaseChecks } from "./lib/database-harness.mjs";
import { parseAcceptanceSummary } from "./lib/acceptance-summary.mjs";
import { resolveQaDockerBinary } from "./lib/docker.mjs";
import { LOCAL_QUALITY_GATES, NATIVE_CATALOG_CHECKS, parseEmbeddedDbResult, parseUnitResult } from "./lib/quality-gates.mjs";
import { parseBrowserAcceptance } from "./lib/browser-acceptance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const projectId = `ucmarketplace-qa-${randomBytes(8).toString("hex")}`;
let cliPath;
let dockerPath;
const baseEnvironment = getQaAppEnvironment({ supabaseUrl: "http://127.0.0.1:54331",
  publishableKey: "sb_publishable_ucmarketplace_anonymous_ci", appBaseUrl: "http://127.0.0.1:3106",
  recoverySecret: randomBytes(32).toString("hex") });
// The CLI must not inherit an executable override, linked credentials or flags.
const cliEnvironment = Object.fromEntries(Object.entries(baseEnvironment).filter(([name]) => !/^SUPABASE_|^QA_/.test(name)));
Object.assign(cliEnvironment, { SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" });

let activeProcess;
const interrupts = installQaInterruptHandler(async () => { await activeProcess?.stop(); });

async function runQuiet(command, args, label, { env = cliEnvironment, timeout = 30_000, cleanup = false } = {}) {
  if (!cleanup) interrupts.throwIfInterrupted();
  const owned = launchQaProcess({ command, args, label, cwd: root, env,
    progressIntervalMs: timeout > 60_000 ? 30_000 : 0,
    onProgress: () => {
      const phase = owned.getAcceptancePhase();
      console.log(`${label} is still running${phase ? ` (phase: ${phase.phase})` : ""}; private command output is withheld.`);
    },
  });
  activeProcess = owned;
  try {
    const output = await owned.wait({ timeoutMs: timeout });
    if (!cleanup) interrupts.throwIfInterrupted();
    return output;
  } catch (error) {
    const failure = owned.getAcceptanceFailure();
    if (failure) console.error(`QA acceptance failure: phase=${failure.phase}; code=${failure.code}; HTTP=${failure.httpStatus ?? "unknown"}; assertion=${failure.assertion ?? "unknown"}; process=${failure.processReason ?? "unknown"}; cleanup_failed=${failure.cleanupFailed}.`);
    throw error;
  } finally { if (activeProcess === owned) activeProcess = null; }
}

async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Local QA port ${port} is occupied. No existing process will be stopped.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

let workingDirectory;
let started = false;
let completedSummary;
const quality = { gates: [], unit: null, embeddedDatabase: null, nativeCatalogAssertions: 0 };
try {
  if (process.argv.length > 2) throw new Error("Usage: npm run qa:local (requires a running local Docker runtime).");
  cliPath = resolveInstalledSupabaseBinary(root);
  await assertQaDotenvSafety(root);
  dockerPath = resolveQaDockerBinary();
  if (process.platform === "win32") {
    const pathKey = Object.keys(cliEnvironment).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
    // Supabase's child Docker lookup receives this process-local addition only.
    // No user PATH, registry setting, or global Docker configuration is changed.
    cliEnvironment[pathKey] = `${path.dirname(dockerPath)};${cliEnvironment[pathKey] ?? ""}`;
  }
  if (process.env.DOCKER_HOST) assertLocalDockerEndpoint(process.env.DOCKER_HOST);
  const contexts = JSON.parse(await runQuiet(dockerPath, ["context", "inspect"], "Local Docker context check"));
  if (!Array.isArray(contexts) || contexts.length !== 1) throw new Error("QA cannot identify one local Docker context.");
  assertLocalDockerEndpoint(contexts[0]?.Endpoints?.docker?.Host);
  await runQuiet(dockerPath, ["info", "--format", "{{json .ServerVersion}}"], "Local Docker readiness check");
  await runQuiet(cliPath, ["--version"], "Local Supabase CLI readiness check");
  for (const port of [...Object.values(LOCAL_QA_PORTS), 3106]) {
    interrupts.throwIfInterrupted();
    await requireFreePort(port);
  }
  for (const gate of LOCAL_QUALITY_GATES) {
    const output = await runQuiet(process.execPath, gate.args, gate.label, { timeout: gate.timeoutMs });
    if (gate.id === "unit") {
      quality.unit = parseUnitResult(output);
      if (!quality.unit) throw new Error("QA regression tests did not export complete passing counts.");
    }
    if (gate.id === "database") {
      quality.embeddedDatabase = parseEmbeddedDbResult(output);
      if (!quality.embeddedDatabase) throw new Error("QA embedded database assertions did not export complete passing counts.");
    }
    quality.gates.push(gate.id);
    console.log(`${gate.label} passed${gate.id === "unit" ? `: ${quality.unit.tests} tests` : gate.id === "database" ? `: ${quality.embeddedDatabase.migrations} migrations, ${quality.embeddedDatabase.assertions} assertions` : ""}.`);
  }
  const scratch = path.join(root, ".qa");
  await mkdir(scratch, { recursive: true });
  if (await realpath(scratch) !== path.join(await realpath(root), ".qa")) throw new Error("QA scratch directory must remain inside the workspace, without a redirected path.");
  workingDirectory = await mkdtemp(path.join(scratch, "stack-"));
  const supabase = path.join(workingDirectory, "supabase");
  await mkdir(path.join(supabase, "migrations"), { recursive: true });
  await mkdir(path.join(supabase, "templates"));
  await writeFile(path.join(supabase, "config.toml"), buildLocalQaConfig(await readFile(path.join(root, "supabase/config.toml"), "utf8"), projectId), { flag: "wx" });
  await writeFile(path.join(supabase, "templates/confirmation.html"), await readFile(path.join(root, "supabase/templates/confirmation.html")), { flag: "wx" });
  await writeFile(path.join(supabase, "templates/recovery.html"), '<!doctype html><html lang="en"><body><h1>Disposable QA password recovery</h1><p>{{ .Token }}</p><a href="{{ .SiteURL }}/auth/recovery?token_hash={{ .TokenHash }}&amp;type=recovery">Reset password</a></body></html>', { flag: "wx" });
  for (const file of (await readdir(path.join(root, "supabase/migrations"))).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    interrupts.throwIfInterrupted();
    await writeFile(path.join(supabase, "migrations", file), await readFile(path.join(root, "supabase/migrations", file)), { flag: "wx" });
  }
  console.log(`Starting owned disposable local QA project ${projectId}. Existing development/hosted projects will not be reset or reused.`);
  interrupts.throwIfInterrupted();
  started = true;
  const cli = (args, label, options) => runQuiet(cliPath, [...args, "--workdir", workingDirectory, "--agent", "no", "--log-level", "error"], label, options);
  await cli(["start", "--exclude", "studio,postgres-meta,edge-runtime,logflare,vector"], "Isolated Supabase startup", { timeout: 300_000 });
  const qaEnvironment = qaEnvironmentFromLocalStatus(JSON.parse(await cli(["status", "--output", "json"], "Local QA status validation")), baseEnvironment);
  const connection = new pg.Client({ connectionString: qaEnvironment.QA_DATABASE_URL, connectionTimeoutMillis: 10_000 });
  try {
    await connection.connect();
    await connection.query("set statement_timeout='30s'");
    let messaging;
    try {
      const database = { exec: async (sql) => { interrupts.throwIfInterrupted(); return [await connection.query(sql)]; } };
      messaging = summarizeDatabaseChecks(await executeSqlScript(database, await readFile(path.join(root, "supabase/checks/messaging_rls_smoke.sql"), "utf8")), { includeStatementIndex: true });
      if (messaging.count < 1 || messaging.failures.length) throw new Error("QA database-only messaging assertions failed.");
      console.log(`Database-only messaging gate passed ${messaging.count} assertions on the owned disposable database.`);
    } catch (error) {
      try { await connection.query("rollback"); await connection.query("reset role"); } catch { /* The enclosing finally closes this owned connection. */ }
      const diagnostic = formatDatabaseCheckDiagnostics(error, { summary: messaging, allowedScenarios: MESSAGING_GATE_SCENARIOS });
      throw new Error(`QA database-only messaging gate did not pass (${diagnostic}); staged realtime publication was not applied.`);
    }
    interrupts.throwIfInterrupted();
    // This socket is validated against our newly prepared loopback ports only.
    // Enable the existing staged publication on this disposable database, never
    // move it into the normal hosted migration path as an incidental QA step.
    await connection.query(await readFile(path.join(root, "supabase/staged/20260927010000_enable_messaging_realtime.sql"), "utf8"));
    // Inspect native Auth/Storage/Postgres catalogs after all migrations and
    // the explicitly gated publication. These scripts perform read-only checks.
    for (const file of NATIVE_CATALOG_CHECKS) {
      let catalog;
      try {
        const database = { exec: async (sql) => { interrupts.throwIfInterrupted(); return [await connection.query(sql)]; } };
        catalog = summarizeDatabaseChecks(await executeSqlScript(database, await readFile(path.join(root, "supabase/checks", file), "utf8")), { includeStatementIndex: true });
        if (catalog.count < 1 || catalog.failures.length) throw new Error("QA native catalog assertions failed.");
        quality.nativeCatalogAssertions += catalog.count;
      } catch (error) {
        throw new Error(`QA native catalog gate ${file} did not pass (${formatDatabaseCheckDiagnostics(error, { summary: catalog })}).`);
      }
    }
    console.log(`Native database security catalog gate passed ${quality.nativeCatalogAssertions} assertions.`);
  } finally { await connection.end(); }
  const acceptanceStartedAt = Date.now();
  const privateOutput = await runQuiet(process.execPath, [path.join(root, "scripts/qa/integration.mjs")], "Full isolated QA acceptance", { env: qaEnvironment, timeout: 1_200_000 });
  completedSummary = parseAcceptanceSummary(privateOutput);
  if (completedSummary.mode !== "full_local") throw new Error("QA local acceptance requires completed full-stack evidence; API-only results cannot pass.");
  const browserReport = path.join(root, "node_modules/.cache/uc-qa-browser/report.json");
  if ((await stat(browserReport)).mtimeMs < acceptanceStartedAt) throw new Error("QA local browser evidence is stale.");
  quality.browser = parseBrowserAcceptance(JSON.parse(await readFile(browserReport, "utf8")));
  if (!quality.browser) throw new Error("QA local browser evidence does not confirm all required suites.");
} catch (error) {
  // Use only our controlled messages; JSON/SQL/OS exceptions can contain secrets.
  const safeMessage = error instanceof Error && /^(?:Usage:|QA |Full-stack QA|Local QA|Local Docker|Local Supabase CLI|Isolated Supabase|Full isolated QA|CLI status|Local Supabase|Route type generation|TypeScript validation|ESLint validation|Regression tests|Embedded database assertions|Source security checks)/.test(error.message)
    ? error.message : "Local QA could not complete. Check the local runtime/configuration; no hosted fallback or reset was attempted.";
  console.error(safeMessage);
  process.exitCode = interrupts.signal === "SIGINT" ? 130 : interrupts.signal === "SIGTERM" ? 143 : 1;
} finally {
  await interrupts.settled;
  if (started && workingDirectory) {
    try {
      await runQuiet(cliPath, ["stop", "--project-id", projectId, "--workdir", workingDirectory, "--agent", "no", "--log-level", "error"], "Local QA project shutdown", { timeout: 60_000, cleanup: true });
      console.log(`Stopped only ${projectId}; data backups and ignored scratch files retained for scoped diagnosis.`);
    } catch { console.error(`Stop the run-owned local QA project ${projectId} manually. No other project was stopped.`); process.exitCode = 1; }
  }
  if (interrupts.signal) process.exitCode = interrupts.signal === "SIGINT" ? 130 : 143;
  interrupts.dispose();
}
// A completed test body is not a passed run until scoped cleanup also succeeds.
if (completedSummary && !process.exitCode && !interrupts.signal) {
  try {
    const summaryPath = path.join(workingDirectory, "acceptance-summary.json");
    await writeFile(summaryPath, JSON.stringify({ ...completedSummary, quality, executedAt: new Date().toISOString() }, null, 2), { flag: "wx" });
    console.log(`Full isolated QA passed: ${completedSummary.apiChecks} API checks, ${completedSummary.concurrencyScenarios} concurrency scenarios, ${completedSummary.realtimeScenarios} Realtime scenarios, ${completedSummary.emailAuthChecks} local SMTP checks, and authenticated browsers.`);
    console.log(`Sanitized counts saved to ${path.relative(root, summaryPath)}; external delivery/deployment acceptance is not implied.`);
  } catch {
    console.error("QA could not save completed sanitized acceptance evidence. No passing summary was exported.");
    process.exitCode = 1;
  }
}
