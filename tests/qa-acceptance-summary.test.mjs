import assert from "node:assert/strict";
import test from "node:test";
import { createAcceptanceSummary, parseAcceptanceSummary } from "../scripts/qa/lib/acceptance-summary.mjs";

const complete = { apiChecks: 100, concurrencyScenarios: 3, realtimeScenarios: 4, emailAuthChecks: 12, authenticatedBrowser: true, apiOnly: false };
test("sanitized summaries never promote local acceptance to deployed/external release approval", () => {
  const summary = createAcceptanceSummary({ ...complete, secret: "must-not-be-exported", email: "private@example.test" });
  assert.equal(summary.releaseReady, false);
  assert.equal(summary.externalEmailDelivery, "not_run");
  assert.equal(summary.deployedAcceptance, "not_run");
  assert.equal(JSON.stringify(summary).includes("must-not-be-exported"), false);
  assert.equal(JSON.stringify(summary).includes("private@example.test"), false);
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
