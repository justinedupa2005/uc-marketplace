import assert from "node:assert/strict";
import test from "node:test";
import { parseBrowserAcceptance } from "../scripts/qa/lib/browser-acceptance.mjs";

const completedTest = (file, line = 15, title = "required workflow") => ({ file, line, title, status: "passed", expectedStatus: "passed" });
const completedReport = () => ({
  version: 1,
  status: "passed",
  runnerErrors: 0,
  unexpectedRuntimeSignals: 0,
  tests: [
    completedTest("anonymous.spec.ts"),
    completedTest("anonymous.spec.ts", 15, "another parameterized anonymous workflow"),
    completedTest("authenticated.spec.ts"),
    completedTest("recovery.spec.ts"),
  ],
});

test("combined browser acceptance exports only anonymous and authenticated suite counts", () => {
  assert.deepEqual(parseBrowserAcceptance(completedReport()), { anonymousTests: 2, authenticatedTests: 2, totalTests: 4 });
});

test("browser acceptance rejects failed, interrupted, skipped and runtime-tainted evidence", () => {
  for (const patch of [
    { version: 2 }, { status: "failed" }, { status: "running" }, { status: "interrupted" }, { status: "timedout" },
    { runnerErrors: 1 }, { runnerErrors: "0" }, { runnerErrors: undefined },
    { unexpectedRuntimeSignals: 1 }, { unexpectedRuntimeSignals: false }, { unexpectedRuntimeSignals: undefined },
  ]) assert.throws(() => parseBrowserAcceptance({ ...completedReport(), ...patch }));
  for (const status of ["failed", "timedOut", "skipped", "interrupted", undefined]) {
    const report = completedReport();
    report.tests[0] = { ...report.tests[0], status };
    assert.throws(() => parseBrowserAcceptance(report));
  }
  for (const expectedStatus of ["failed", "skipped", undefined]) {
    const report = completedReport();
    report.tests[0] = { ...report.tests[0], expectedStatus };
    assert.throws(() => parseBrowserAcceptance(report));
  }
});

test("browser acceptance rejects empty or incomplete suite coverage", () => {
  for (const value of [null, undefined, [], "passed", {}, { ...completedReport(), tests: [] }, { ...completedReport(), tests: null }]) {
    assert.throws(() => parseBrowserAcceptance(value));
  }
  for (const file of ["anonymous.spec.ts", "authenticated.spec.ts", "recovery.spec.ts"]) {
    const report = completedReport();
    report.tests = report.tests.filter((entry) => entry.file !== file);
    assert.throws(() => parseBrowserAcceptance(report));
  }
});

test("browser acceptance rejects invalid source metadata and duplicate test identities", () => {
  for (const patch of [
    { file: "unknown.spec.ts" }, { file: "C:/private/anonymous.spec.ts" }, { file: "../anonymous.spec.ts" },
    { file: null }, { line: 0 }, { line: -1 }, { line: 1.5 }, { line: "15" }, { line: Infinity }, { line: Number.MAX_SAFE_INTEGER + 1 },
    { title: null }, { title: [] }, { title: "" }, { title: "a".repeat(10_001) },
  ]) {
    const report = completedReport();
    report.tests[0] = { ...report.tests[0], ...patch };
    assert.throws(() => parseBrowserAcceptance(report));
  }
  for (const value of [null, "passed", []]) {
    const report = completedReport();
    report.tests[0] = value;
    assert.throws(() => parseBrowserAcceptance(report));
  }
  const duplicate = completedReport();
  duplicate.tests.push({ ...duplicate.tests[0] });
  assert.throws(() => parseBrowserAcceptance(duplicate));
});

test("browser acceptance rejects reports exceeding the bounded test count", () => {
  const report = completedReport();
  report.tests = Array(100_001).fill(report.tests[0]);
  assert.throws(() => parseBrowserAcceptance(report));
});

test("browser acceptance never returns private titles, fields or diagnostic payloads", () => {
  const secret = "private-password-token-student-identity";
  const report = completedReport();
  report.privatePayload = secret;
  report.tests = report.tests.map((entry, index) => ({ ...entry, title: `${secret}-${index}`, errors: [{ message: secret }], attachments: [secret], extra: secret }));
  const result = parseBrowserAcceptance(report);
  assert.deepEqual(result, { anonymousTests: 2, authenticatedTests: 2, totalTests: 4 });
  assert.deepEqual(Object.keys(result), ["anonymousTests", "authenticatedTests", "totalTests"]);
  assert.equal(JSON.stringify(result).includes(secret), false);
  report.tests[0].file = secret;
  assert.throws(() => parseBrowserAcceptance(report), (error) => {
    assert.equal(error.message.includes(secret), false);
    assert.equal(error.cause, undefined);
    return true;
  });
});
