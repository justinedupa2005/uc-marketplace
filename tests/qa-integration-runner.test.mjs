import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The entrypoint provisions native fixtures and must never be imported by a
// unit test. These structural regressions guard its fail-closed orchestration;
// actual workflows are independently exercised by disposable live acceptance.
const source = await readFile(new URL("../scripts/qa/integration.mjs", import.meta.url), "utf8");

function position(marker) {
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, `Missing integration safety boundary: ${marker}`);
  return index;
}

function ordered(...markers) {
  const positions = markers.map(position);
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index] > positions[index - 1], `Integration boundary order changed: ${markers[index]}`);
  }
}

test("full integration validates explicit database, local and SMTP targets before building", () => {
  ordered(
    "await readQaEnvironment({ requireDatabase: true, requireLocal: !apiOnly, requireMailpit: !apiOnly })",
    "if (!apiOnly) await assertQaDotenvSafety()",
    'setPhase("database")',
    'await pool.query("select 1")',
    "const appEnvironment = getQaAppEnvironment(config)",
    'setPhase("build")',
  );
});

test("integration checks production bundles after build and before starting its owned server", () => {
  ordered(
    'setPhase("build")',
    'await runNode(["node_modules/next/dist/bin/next", "build"]',
    'await runNode(["scripts/qa/security-hygiene.mjs", "--bundles"]',
    'setPhase("server")',
    "server = launchQaProcess",
    "await waitForApp(server, config.appBaseUrl)",
    "context = createFixtureContext(config, pool)",
  );
  assert.match(source, /label: "Dedicated QA application server", failOnUnhandledRuntime: true/);
});

test("integration emits only controlled phase metadata around every acceptance gate", () => {
  assert.deepEqual([...source.matchAll(/setPhase\("([a-z]+)"\)/g)].map((match) => match[1]), [
    "database", "build", "server", "provisioning", "api", "concurrency", "realtime", "email", "browser",
  ]);
  ordered(
    'setPhase("provisioning")', "await provisionAccounts(context)",
    'setPhase("api")', "await runApiChecks(context)",
    'setPhase("concurrency")', "await runConcurrencyChecks(context)",
    'setPhase("realtime")', "await runRealtimeChecks(context)",
    'setPhase("email")', "await runEmailChecks(context",
    'setPhase("browser")',
  );
  assert.match(source, /const progress = createAcceptancePhase\(\{ phase: next \}\)/);
  assert.match(source, /QA_PHASE_JSON:\$\{JSON\.stringify\(progress\)\}/);
});

test("full browser acceptance explicitly executes both projects with public-only worker configuration", () => {
  assert.match(source, /await runNode\(\["node_modules\/@playwright\/test\/cli\.js", "test", "--project=anonymous-chromium", "--project=qa-chromium", "--forbid-only"\]/);
  ordered(
    'setPhase("browser")',
    "const browserStartedAt = Date.now()",
    'await runNode(["node_modules/@playwright/test/cli.js"',
    "...getQaBrowserEnvironment(config), ...accountEnvironment(context.accounts)",
    "const reportPath =",
  );
  const browserConfiguration = source.slice(position("...getQaBrowserEnvironment(config)"), position("const reportPath ="));
  assert.doesNotMatch(browserConfiguration, /SERVICE_ROLE_KEY|AUTH_RECOVERY_SECRET|QA_DATABASE_URL|storageState|trace:|screenshot:|video:/);
});

test("full browser acceptance forbids focused tests without depending on CI or test filters", () => {
  const invocation = /await runNode\((\["node_modules\/@playwright\/test\/cli\.js"[^\]]*\])/.exec(source);
  assert.ok(invocation, "Full acceptance must use fixed repository-owned Playwright arguments");
  const args = JSON.parse(invocation[1]);
  assert.deepEqual(args, [
    "node_modules/@playwright/test/cli.js", "test", "--project=anonymous-chromium", "--project=qa-chromium", "--forbid-only",
  ]);
  assert.equal(args.filter((argument) => argument === "--forbid-only").length, 1);
  assert.equal(args.some((argument) => /--(?:grep|list|last-failed|pass-with-no-tests)/.test(argument)), false);
});

test("integration requires fresh report and complete suite coverage before creating passing evidence", () => {
  ordered(
    "const browserStartedAt = Date.now()",
    'await runNode(["node_modules/@playwright/test/cli.js"',
    "if ((await stat(reportPath)).mtimeMs < browserStartedAt) throw",
    'const browserCounts = parseBrowserAcceptance(JSON.parse(await readFile(reportPath, "utf8")))',
    "if (!browserCounts) throw",
    "Browser acceptance passed",
    "completedSummary = createAcceptanceSummary",
  );
  assert.match(source, /const reportPath = "node_modules\/\.cache\/uc-qa-browser\/report\.json"/);
  assert.match(source, /authenticatedBrowser: !apiOnly, apiOnly/);
});

test("integration failure metadata omits raw errors and sets a nonpassing exit code", () => {
  ordered(
    "acceptanceFailure = createAcceptanceFailure",
    "processReason: error instanceof QaProcessError ? error.reason : null",
  );
  const failureStart = position("acceptanceFailure = createAcceptanceFailure");
  assert.ok(source.indexOf("process.exitCode = 1", failureStart) > failureStart);
  const metadata = source.slice(position("acceptanceFailure = createAcceptanceFailure"), position("// Never print raw service responses"));
  assert.doesNotMatch(metadata, /error\.message|cause:|stack:|password:|token:/);
  assert.match(source, /QA_FAILURE_JSON:\$\{JSON\.stringify\(createAcceptanceFailure/);
});

test("integration waits for server, fixtures and database cleanup before exporting a passing summary", () => {
  ordered(
    "completedSummary = createAcceptanceSummary",
    'createAcceptancePhase({ phase: "cleanup" })',
    "await server.stop(); server.assertNoFailures()",
    "await cleanupFixtures(context)",
    "await pool?.end()",
    "await interruption.settled",
    "globalThis.fetch = originalFetch",
    "if (process.exitCode)",
    "} else if (completedSummary)",
    "QA_SUMMARY_JSON:",
  );
  assert.match(source, /QA database cleanup failed; no completed acceptance summary will be emitted/);
  assert.match(source, /process\.exitCode = 1; cleanupFailed = true/);
});
