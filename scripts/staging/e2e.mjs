import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createManagementApi, staging, verifyStagingProject } from "./lib.mjs";
import { stagingPoolOptions } from "./acceptance.mjs";
import { getStagingCa } from "./tls.mjs";
import { createFixtureContext, provisionAccounts, cleanupFixtures } from "../qa/lib/fixtures.mjs";
import { runApiChecks } from "../qa/lib/api.mjs";
import { runConcurrencyChecks } from "../qa/lib/concurrency.mjs";
import { runRealtimeChecks } from "../qa/lib/realtime.mjs";
import { createQaFetch, installQaInterruptHandler } from "../qa/lib/process.mjs";
import { withStagingBypass } from "../deployment/staging-bypass.mjs";
import { runHostedBrowsers } from "./e2e-browser.mjs";
import { acceptanceStatus, hostedPhases, manualGates, validateHostedInput } from "./e2e-policy.mjs";

async function main() {
  const originalFetch = globalThis.fetch, controller = new AbortController();
  let requestSignal = controller.signal;
  globalThis.fetch = createQaFetch({ fetchImpl: originalFetch, signal: () => requestSignal, timeoutMs: 30_000 });
  const interruption = installQaInterruptHandler(() => controller.abort());
  const deadline = setTimeout(() => controller.abort(), 20 * 60_000);
  const evidence = { version: 1, status: "failed", startedAt: new Date().toISOString(), origin: staging.appOrigin,
    phases: Object.fromEntries(hostedPhases.map((name) => [name, "not_run"])),
    browserChecks: 0, apiChecks: 0, concurrencyScenarios: 0, realtimeScenarios: 0,
    failures: { browser: 0, hydration: 0, server: 0, crossEnvironment: 0 }, accessibility: [], touchTargetReview: 0,
    manual: Object.fromEntries(manualGates.map((name) => [name, "not_run"])),
    registrationFixtureMethod: "admin_confirmed_synthetic_not_email_acceptance", productionDeploymentEnabled: false,
    cleanup: false, bypassRevoked: true };
  let pool, context, currentPhase = "preflight";
  const phase = (name) => { assert.ok(hostedPhases.includes(name)); currentPhase = name;
    evidence.phases[name] = "running";
    assert.ok(!controller.signal.aborted);
    writeFileSync(`.qa/staging-e2e-progress-${context.runId}.json`, JSON.stringify({ phase: name, runId: context.runId, updatedAt: new Date().toISOString() }));
    console.log(JSON.stringify({ phase: name, status: "running" })); };
  try {
    assert.equal(process.argv.length, 2);
    let raw = ""; for await (const chunk of process.stdin) { raw += chunk; assert.ok(raw.length < 1000); }
    const input = validateHostedInput(JSON.parse(raw));
    Object.assign(evidence, input);
    const api = createManagementApi(process.env);
    await verifyStagingProject(api);
    const auth = await api("/config/auth");
    assert.equal(auth.disable_signup, true); assert.equal(auth.smtp_host, "smtp.example.invalid"); assert.equal(auth.site_url, staging.appOrigin);
    const keys = await api("/api-keys");
    assert.ok(keys.some((key) => key.api_key === process.env.STAGING_SERVICE_ROLE_KEY && (key.name === "service_role" || key.type === "secret")));
    assert.ok(keys.some((key) => key.api_key === process.env.STAGING_PUBLISHABLE_KEY && (key.name === "anon" || key.type === "publishable")));
    const { config, options } = stagingPoolOptions(process.env, await getStagingCa());
    pool = new pg.Pool(options); pool.on("error", () => { evidence.failures.server++; controller.abort(); });
    context = createFixtureContext(config, pool); evidence.runId = context.runId;
    const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true });
    if (revision.status === 0 && /^[a-f0-9]{40}$/.test(revision.stdout.trim())) evidence.runnerSha = revision.stdout.trim();
    const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8", windowsHide: true });
    evidence.runnerDirty = status.status !== 0 || Boolean(status.stdout.trim());
    // Hosting identity/immutable canonical source is checked before provisioning.
    // The temporary token never enters files, environment dumps or output.
    evidence.bypassRevoked = false;
    let bodyError;
    await withStagingBypass(input, async (secret) => {
      try {
        phase("accounts"); await provisionAccounts(context); evidence.phases.accounts = "passed";
        phase("api"); evidence.apiChecks = await runApiChecks(context); evidence.phases.api = "passed";
        phase("concurrency"); evidence.concurrencyScenarios = await runConcurrencyChecks(context); evidence.phases.concurrency = "passed";
        phase("realtime"); evidence.realtimeScenarios = (await runRealtimeChecks(context)).count; evidence.phases.realtime = "passed";
        await runHostedBrowsers(context, secret, evidence, phase, controller.signal);
        interruption.throwIfInterrupted(); assert.ok(!controller.signal.aborted);
      } catch (error) { bodyError = error; }
    });
    evidence.bypassRevoked = true;
    if (bodyError) throw bodyError;
  } catch (error) {
    evidence.failedPhase = currentPhase;
    evidence.sourceLocation = /(?:e2e-browser|e2e|api|concurrency|realtime)\.mjs:\d+:\d+/.exec(String(error?.stack ?? ""))?.[0] ?? null;
    if (Number.isSafeInteger(error?.qaAssertionIndex)) evidence.apiAssertion = error.qaAssertionIndex;
    console.log(JSON.stringify({ status: "failed", phase: currentPhase, sourceLocation: evidence.sourceLocation, privateDetailsWithheld: true }));
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline); requestSignal = new AbortController().signal;
    try { if (context) await cleanupFixtures(context); evidence.cleanup = true; }
    catch { process.exitCode = 1; console.log("Run-owned fixture cleanup requires scoped review; never reset staging."); }
    try { await pool?.end(); } catch { process.exitCode = 1; evidence.cleanup = false; }
    await interruption.settled; if (interruption.signal) process.exitCode = 1;
    interruption.dispose(); globalThis.fetch = originalFetch;
  }
  evidence.finishedAt = new Date().toISOString();
  evidence.status = process.exitCode ? "failed" : acceptanceStatus(evidence);
  if (evidence.status === "failed") process.exitCode = 1;
  if (evidence.runId) {
    await mkdir(".qa", { recursive: true });
    await writeFile(`.qa/staging-e2e-${evidence.runId}.json`, JSON.stringify(evidence, null, 2), { flag: "wx" });
    await writeFile(`.qa/staging-e2e-progress-${evidence.runId}.json`, JSON.stringify({ phase: "finished", runId: evidence.runId, status: evidence.status, updatedAt: evidence.finishedAt }));
  }
  console.log(JSON.stringify(evidence));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch { console.log("Hosted E2E evidence could not be saved; private details withheld."); process.exitCode = 1; }
}
