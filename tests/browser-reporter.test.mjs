import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import SafeQaReporter, { qaResultSummary, redactQaLabel } from "./e2e/safe-reporter.ts";

test("QA labels redact configured credentials and token patterns", () => {
  const secret = "Qa-secret-from-environment-19!";
  const email = "isolated-person@example.test";
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxYSJ9.tokenSignature";
  const generated = "Qa-11111111-1111-4111-8111-111111111111-9!";
  const result = redactQaLabel(`${secret} ${email} ${jwt} sb_secret_ExampleKey ${generated}`, {
    QA_SELLER_PASSWORD: secret, QA_SELLER_EMAIL: email,
  });
  for (const value of [secret, email, jwt, "sb_secret_ExampleKey", generated]) assert.equal(result.includes(value), false);
  assert.match(result, /redacted/);
});

test("QA summary allowlists metadata and discards secret-bearing errors, steps and attachments", () => {
  const password = "generated-secret-not-in-environment";
  const summary = qaResultSummary({
    title: "password workflow", location: { file: "C:/tests/authenticated.spec.ts", line: 15 }, expectedStatus: "passed",
  }, {
    status: "failed", duration: 25,
    errors: [{ message: `locator.fill(${password})`, stack: password }],
    steps: [{ title: `fill ${password}`, error: { message: password }, steps: [{ title: password }] }],
    attachments: [{ body: Buffer.from(password) }], stdout: [password], stderr: [password],
  });
  assert.equal(JSON.stringify(summary).includes(password), false);
  assert.deepEqual(summary.failedStepIndexes, [0]);
  assert.deepEqual(Object.keys(summary), ["file", "line", "title", "status", "expectedStatus", "durationMs", "failedStepIndexes", "failedStepLocation"]);
  assert.equal(summary.failedStepLocation, null);
});

test("failed steps report only the deepest known source location and index path", () => {
  const secret = "private-password-bearing-argument";
  const summary = qaResultSummary({
    title: "password workflow", location: { file: "authenticated.spec.ts", line: 15 }, expectedStatus: "passed",
  }, {
    status: "timedOut", duration: 300_000,
    steps: [{
      title: secret, error: { message: secret }, location: { file: "C:/private/path/authenticated.spec.ts", line: 25 },
      steps: [{
        title: secret, subtitle: secret, params: { value: secret }, error: { message: secret, stack: secret },
        location: { file: "C:/private/path/qa-helpers.ts", line: 31 },
        steps: [{ title: secret, error: { message: secret }, location: { file: `${secret}.ts`, line: 32 }, steps: [] }],
      }],
    }],
  });
  assert.deepEqual(summary.failedStepLocation, { file: "qa-helpers.ts", line: 31, indexPath: [0, 0, 0] });
  assert.equal(JSON.stringify(summary).includes(secret), false);
  assert.equal(JSON.stringify(summary).includes("private/path"), false);
});

test("running progress safely tracks nested steps and finalizes consistently", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "uc-qa-reporter-"));
  const outputFile = path.join(directory, "summary.json");
  const progressFile = `${outputFile}.progress.json`;
  const originalWrite = process.stdout.write;
  const fixture = { title: "password workflow", location: { file: "authenticated.spec.ts", line: 15 }, expectedStatus: "passed" };
  const result = { startTime: new Date("2026-10-14T00:00:00Z"), status: "passed", duration: 25, steps: [] };
  const secret = "generated-password-never-print-this";
  const parent = { title: secret, location: { file: "authenticated.spec.ts", line: 20 }, params: { password: secret }, steps: [] };
  const child = { title: `fill(${secret})`, subtitle: secret, location: { file: "qa-helpers.ts", line: 31 }, error: { message: secret }, steps: [] };
  try {
    writeFileSync(outputFile, "previous acceptance evidence");
    process.stdout.write = () => true;
    const reporter = new SafeQaReporter({ outputFile });
    reporter.onBegin({ argv: [] }, { allTests: () => [fixture] });
    assert.equal(readFileSync(outputFile, "utf8"), "previous acceptance evidence");
    let progress = JSON.parse(readFileSync(progressFile, "utf8"));
    assert.equal(progress.status, "running");
    assert.deepEqual(progress.tests, []);
    assert.equal(progress.discoveredTests, 1);
    reporter.onTestBegin(fixture, result);
    reporter.onStepBegin(fixture, result, parent);
    reporter.onStepBegin(fixture, result, child);
    progress = JSON.parse(readFileSync(progressFile, "utf8"));
    assert.deepEqual(progress.activeTest, { file: "authenticated.spec.ts", line: 15, title: "password workflow", startedAt: "2026-10-14T00:00:00.000Z" });
    assert.deepEqual(progress.activeStep, { index: 2, file: "qa-helpers.ts", line: 31 });
    assert.equal(JSON.stringify(progress).includes(secret), false);
    reporter.onStepEnd(fixture, result, child);
    assert.deepEqual(JSON.parse(readFileSync(progressFile, "utf8")).activeStep, { index: 1, file: "authenticated.spec.ts", line: 20 });
    reporter.onStepEnd(fixture, result, parent);
    assert.equal(JSON.parse(readFileSync(progressFile, "utf8")).activeStep, null);
    reporter.onTestEnd(fixture, result);
    assert.equal((await reporter.onEnd({ status: "passed" })).status, "passed");
    progress = JSON.parse(readFileSync(progressFile, "utf8"));
    const final = JSON.parse(readFileSync(outputFile, "utf8"));
    assert.equal(progress.status, final.status);
    assert.deepEqual(progress.tests, final.tests);
    assert.equal(progress.activeTest, null);
    assert.equal(progress.activeStep, null);
  } finally {
    process.stdout.write = originalWrite;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("QA artifact contains no raw worker output or diagnostic payloads", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "uc-qa-reporter-"));
  const outputFile = path.join(directory, "summary.json");
  const terminalOutput = [];
  const originalWrite = process.stdout.write;
  try {
    const reporter = new SafeQaReporter({ outputFile });
    process.stdout.write = (chunk) => { terminalOutput.push(String(chunk)); return true; };
    try {
      reporter.onStdOut(Buffer.from("secret-worker-output"));
      reporter.onStdErr("secret-token-output");
      reporter.onError({ message: "secret-runner-error" });
      reporter.onTestEnd({ title: "password workflow", location: { file: "authenticated.spec.ts", line: 15 }, expectedStatus: "passed" }, {
        status: "failed", duration: 25, steps: [{ title: "fill(generated-secret)", error: { message: "generated-secret" } }],
        errors: [{ message: "generated-secret" }], attachments: [{ body: Buffer.from("generated-secret") }],
      });
      await reporter.onEnd({ status: "failed" });
    } finally { process.stdout.write = originalWrite; }
    const artifact = readFileSync(outputFile, "utf8");
    for (const secret of ["secret-worker-output", "secret-token-output", "secret-runner-error", "generated-secret"]) {
      assert.equal(artifact.includes(secret), false);
      assert.equal(terminalOutput.join("").includes(secret), false);
    }
    const summary = JSON.parse(artifact);
    assert.equal(summary.suppressedOutputChunks, 2);
    assert.equal(summary.runnerErrors, 1);
  } finally {
    process.stdout.write = originalWrite;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("suppressed unhandled-runtime output still fails the gate, including markers split across chunks", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "uc-qa-reporter-"));
  const outputFile = path.join(directory, "summary.json");
  const originalWrite = process.stdout.write;
  try {
    const reporter = new SafeQaReporter({ outputFile });
    reporter.onStdErr("[WebServer] unhandled");
    reporter.onStdErr("Rejection: secret-diagnostic");
    process.stdout.write = () => true;
    const result = await reporter.onEnd({ status: "passed" });
    assert.equal(result.status, "failed");
    const artifact = readFileSync(outputFile, "utf8");
    assert.equal(artifact.includes("secret-diagnostic"), false);
    assert.equal(JSON.parse(artifact).unexpectedRuntimeSignals, 1);
  } finally {
    process.stdout.write = originalWrite;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("test discovery preserves previous acceptance evidence and zero execution cannot pass", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "uc-qa-reporter-"));
  const outputFile = path.join(directory, "summary.json");
  const originalWrite = process.stdout.write;
  try {
    writeFileSync(outputFile, "previous acceptance evidence");
    writeFileSync(`${outputFile}.progress.json`, "previous progress evidence");
    process.stdout.write = () => true;
    const listing = new SafeQaReporter({ outputFile, listOnly: true });
    listing.onBegin({ argv: ["--list"] }, { allTests: () => [{ title: "discovered only" }] });
    await listing.onEnd({ status: "passed" });
    assert.equal(readFileSync(outputFile, "utf8"), "previous acceptance evidence");
    assert.equal(readFileSync(`${outputFile}.progress.json`, "utf8"), "previous progress evidence");
    const zero = new SafeQaReporter({ outputFile, listOnly: false });
    assert.equal((await zero.onEnd({ status: "passed" })).status, "failed");
  } finally {
    process.stdout.write = originalWrite;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("skipped or incomplete execution cannot produce a passing QA artifact", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "uc-qa-reporter-"));
  const outputFile = path.join(directory, "summary.json");
  const originalWrite = process.stdout.write;
  const fixture = { title: "required workflow", location: { file: "authenticated.spec.ts", line: 15 }, expectedStatus: "passed" };
  try {
    process.stdout.write = () => true;
    for (const [status, expectedStatus, discovered] of [["skipped", "skipped", 1], ["passed", "passed", 2]]) {
      const reporter = new SafeQaReporter({ outputFile });
      reporter.onBegin({ argv: [] }, { allTests: () => Array(discovered).fill(fixture) });
      reporter.onTestEnd({ ...fixture, expectedStatus }, { status, duration: 0, steps: [] });
      assert.equal((await reporter.onEnd({ status: "passed" })).status, "failed");
      assert.equal(JSON.parse(readFileSync(outputFile, "utf8")).status, "failed");
      assert.equal(JSON.parse(readFileSync(`${outputFile}.progress.json`, "utf8")).status, "failed");
    }
  } finally {
    process.stdout.write = originalWrite;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("hard termination leaves running progress rather than false passing evidence", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "uc-qa-reporter-"));
  const outputFile = path.join(directory, "summary.json");
  const reporterModule = new URL("./e2e/safe-reporter.ts", import.meta.url).href;
  let child;
  try {
    writeFileSync(outputFile, "previous acceptance evidence");
    child = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--experimental-strip-types", "--input-type=module", "-e", `
      import SafeQaReporter from ${JSON.stringify(reporterModule)};
      const reporter = new SafeQaReporter({ outputFile: ${JSON.stringify(outputFile)} });
      const fixture = { title: 'required workflow', location: { file: 'authenticated.spec.ts', line: 15 }, expectedStatus: 'passed' };
      const result = { startTime: new Date(), status: 'passed', duration: 0, steps: [] };
      reporter.onBegin({ argv: [] }, { allTests: () => [fixture] });
      reporter.onTestBegin(fixture, result);
      reporter.onStepBegin(fixture, result, { title: 'fill(private-argument)', location: { file: 'qa-helpers.ts', line: 31 }, steps: [] });
      process.stdout.write('ready');
      setInterval(() => {}, 1000);
    `], { stdio: ["ignore", "pipe", "pipe"] });
    const ready = await Promise.race([
      once(child.stdout, "data").then(([chunk]) => String(chunk)),
      once(child, "exit").then(([code]) => { throw new Error(`Reporter child ended before readiness (${code}).`); }),
    ]);
    assert.equal(ready, "ready");
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const progress = JSON.parse(readFileSync(`${outputFile}.progress.json`, "utf8"));
    assert.equal(progress.status, "running");
    assert.deepEqual(progress.tests, []);
    assert.deepEqual(progress.activeStep, { index: 1, file: "qa-helpers.ts", line: 31 });
    assert.equal(readFileSync(outputFile, "utf8"), "previous acceptance evidence");
    assert.equal(JSON.stringify(progress).includes("private-argument"), false);
  } finally {
    if (child?.exitCode === null && child?.signalCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});
