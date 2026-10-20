import assert from "node:assert/strict";
import test from "node:test";
import { createAcceptanceFailure, createAcceptancePhase, createAcceptanceSummary, parseAcceptanceFailure, parseAcceptancePhase, parseAcceptanceSummary } from "../scripts/qa/lib/acceptance-summary.mjs";

const complete = { apiChecks: 100, concurrencyScenarios: 3, realtimeScenarios: 4, emailAuthChecks: 12, authenticatedBrowser: true, apiOnly: false };

test("live acceptance progress exports only a fixed running phase, never private metadata", () => {
  const phases = ["configuration", "database", "build", "server", "provisioning", "api", "concurrency", "realtime", "email", "browser", "cleanup"];
  for (const phase of phases) {
    const value = createAcceptancePhase({ phase, message: "private-token", rows: ["private-student"], status: "passed", version: 2 });
    assert.deepEqual(value, { version: 1, status: "running", phase });
    assert.doesNotMatch(JSON.stringify(value), /private-|passed/);
  }
  for (const phase of [undefined, null, "private-token", "browser\nprivate-token", {}, ["api"]]) {
    assert.throws(() => createAcceptancePhase({ phase }), /allowlisted acceptance phase/);
  }
});

test("live phase parsing keeps the newest valid phase and never exposes malformed or injected output", () => {
  const build = createAcceptancePhase({ phase: "build" });
  const browser = createAcceptancePhase({ phase: "browser" });
  const line = (value) => `QA_PHASE_JSON:${JSON.stringify(value)}`;
  assert.deepEqual(parseAcceptancePhase(`private-sdk-output\r\n${line(build)}\r\n${line(browser)}\r\nprivate-error\r\n`), browser);
  const invalid = [
    "private-token", " QA_PHASE_JSON:{}", "QA_PHASE_JSON:not-json", "QA_PHASE_JSON:{", line(null), line([]), line("browser"), line({}),
    line({ ...browser, version: 2 }), line({ ...browser, status: "passed" }), line({ ...browser, phase: "private-token" }),
    line({ ...browser, phase: null }), line({ ...browser, phase: ["api"] }), line({ ...browser, error: "private-token" }),
    line({ ...browser, releaseReady: true }), line({ ...browser, privatePayload: "private-token".repeat(100) }),
  ];
  for (const output of invalid) {
    assert.equal(parseAcceptancePhase(output), null);
    assert.deepEqual(parseAcceptancePhase(`${line(build)}\n${output}\n`), build);
  }
});
test("sanitized summaries never promote local acceptance to deployed/external release approval", () => {
  const summary = createAcceptanceSummary({ ...complete, secret: "must-not-be-exported", email: "private@example.test" });
  assert.equal(summary.releaseReady, false);
  assert.equal(summary.externalEmailDelivery, "not_run");
  assert.equal(summary.deployedAcceptance, "not_run");
  assert.equal(JSON.stringify(summary).includes("must-not-be-exported"), false);
  assert.equal(JSON.stringify(summary).includes("private@example.test"), false);
});

test("child failure summaries expose only allowlisted phases and bounded metadata", () => {
  const failure = createAcceptanceFailure({ phase: "api", code: "42501", httpStatus: 403, assertion: 12,
    processReason: "exit", cleanupFailed: true, message: "private-token", rows: ["private-student"] });
  assert.deepEqual(failure, { version: 1, status: "failed", phase: "api", code: "42501", httpStatus: 403, assertion: 12, processReason: "exit", cleanupFailed: true });
  assert.doesNotMatch(JSON.stringify(failure), /private-/);
  assert.throws(() => createAcceptanceFailure({ phase: "private-token" }));
  const hidden = createAcceptanceFailure({ phase: "build", code: "sb_secret_private_token", httpStatus: "private-token", assertion: Infinity, processReason: "private-token" });
  assert.equal(hidden.code, "unknown");
  assert.equal(hidden.httpStatus, null);
  assert.equal(hidden.assertion, null);
  assert.equal(hidden.processReason, null);
});

test("parent failure parsing never returns private process text or ambiguous metadata", () => {
  const failure = createAcceptanceFailure({ phase: "build", processReason: "exit" });
  const line = `QA_FAILURE_JSON:${JSON.stringify({ ...failure, secret: "private-token" })}`;
  assert.deepEqual(parseAcceptanceFailure(`private-SDK-output\n${line}\n`), failure);
  for (const output of ["private-token", "QA_FAILURE_JSON:null", "QA_FAILURE_JSON:[]", "QA_FAILURE_JSON:{}", `${line}\n${line}`,
    `QA_FAILURE_JSON:${JSON.stringify({ ...failure, status: "passed" })}`, `QA_FAILURE_JSON:${JSON.stringify({ ...failure, phase: "private-token" })}`]) {
    assert.equal(parseAcceptanceFailure(output), null);
  }
});
test("API-only results explicitly leave email and browser acceptance unrun", () => {
  const summary = createAcceptanceSummary({ ...complete, apiOnly: true, emailAuthChecks: 0, authenticatedBrowser: false });
  assert.equal(summary.authenticatedBrowser, "not_run");
  assert.equal(summary.smtp, "not_run");
});
test("zero, invalid or unrun scenario counts cannot silently pass", () => {
  for (const patch of [{ apiChecks: 0 }, { concurrencyScenarios: -1 }, { realtimeScenarios: NaN }, { emailAuthChecks: 0 }, { authenticatedBrowser: false }, { apiOnly: true }]) {
    assert.throws(() => createAcceptanceSummary({ ...complete, ...patch }));
  }
});
test("launcher accepts one allowlisted summary line, not private output or ambiguous results", () => {
  const summary = createAcceptanceSummary(complete);
  const line = `QA_SUMMARY_JSON:${JSON.stringify(summary)}`;
  assert.deepEqual(parseAcceptanceSummary(`private-output-not-exported\n${line}\n`), summary);
  for (const value of ["", `${line}\n${line}`, "QA_SUMMARY_JSON:not-json", "QA_SUMMARY_JSON:{}"]) assert.throws(() => parseAcceptanceSummary(value));
});
test("launcher rejects failed, unsupported, inconsistent and release-promoting metadata", () => {
  const summary = createAcceptanceSummary(complete);
  for (const patch of [
    { version: 2 }, { status: "failed" }, { mode: "unknown" },
    { authenticatedBrowser: "not_run" }, { smtp: "not_run" },
    { externalEmailDelivery: "passed" }, { deployedAcceptance: "passed" }, { releaseReady: true },
  ]) assert.throws(() => parseAcceptanceSummary(`QA_SUMMARY_JSON:${JSON.stringify({ ...summary, ...patch })}`));
  for (const value of [null, [], "passed"]) assert.throws(() => parseAcceptanceSummary(`QA_SUMMARY_JSON:${JSON.stringify(value)}`));
  const api = createAcceptanceSummary({ ...complete, apiOnly: true, emailAuthChecks: 0, authenticatedBrowser: false });
  assert.deepEqual(parseAcceptanceSummary(`QA_SUMMARY_JSON:${JSON.stringify(api)}`), api);
});
