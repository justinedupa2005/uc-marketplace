import assert from "node:assert/strict";
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
  assert.deepEqual(Object.keys(summary), ["file", "line", "title", "status", "expectedStatus", "durationMs", "failedStepIndexes"]);
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
    process.stdout.write = () => true;
    const listing = new SafeQaReporter({ outputFile, listOnly: true });
    await listing.onEnd({ status: "passed" });
    assert.equal(readFileSync(outputFile, "utf8"), "previous acceptance evidence");
    const zero = new SafeQaReporter({ outputFile, listOnly: false });
    assert.equal((await zero.onEnd({ status: "passed" })).status, "failed");
  } finally {
    process.stdout.write = originalWrite;
    rmSync(directory, { recursive: true, force: true });
  }
});
