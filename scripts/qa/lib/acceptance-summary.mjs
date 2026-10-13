/** Only counts/statuses leave the private fixture process, never identities or keys. */
export function createAcceptanceSummary({ apiChecks, concurrencyScenarios, realtimeScenarios, emailAuthChecks, authenticatedBrowser, apiOnly }) {
  for (const count of [apiChecks, concurrencyScenarios, realtimeScenarios]) {
    if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) throw new Error("QA summary requires completed, nonempty acceptance scenarios.");
  }
  if (typeof apiOnly !== "boolean" || typeof authenticatedBrowser !== "boolean"
    || !Number.isSafeInteger(emailAuthChecks) || emailAuthChecks < 0 || emailAuthChecks > 100_000
    || (apiOnly ? authenticatedBrowser || emailAuthChecks !== 0 : !authenticatedBrowser || emailAuthChecks < 10)) {
    throw new Error("QA summary cannot describe unrun browser or SMTP gates as passed.");
  }
  return { version: 1, mode: apiOnly ? "api_only" : "full_local", status: "passed",
    apiChecks, concurrencyScenarios, realtimeScenarios, emailAuthChecks,
    authenticatedBrowser: authenticatedBrowser ? "passed" : "not_run",
    smtp: emailAuthChecks ? "passed_local_capture" : "not_run",
    externalEmailDelivery: "not_run", deployedAcceptance: "not_run", releaseReady: false };
}

export function parseAcceptanceSummary(output) {
  const lines = String(output).split(/\r?\n/).filter((line) => line.startsWith("QA_SUMMARY_JSON:"));
  if (lines.length !== 1) throw new Error("QA requires exactly one completed sanitized acceptance summary.");
  let summary;
  try { summary = JSON.parse(lines[0].slice("QA_SUMMARY_JSON:".length)); }
  catch { throw new Error("QA completed without valid sanitized summary JSON."); }
  if (!summary || typeof summary !== "object" || Array.isArray(summary)
    || summary.version !== 1 || summary.status !== "passed"
    || !["api_only", "full_local"].includes(summary.mode)
    || summary.externalEmailDelivery !== "not_run" || summary.deployedAcceptance !== "not_run"
    || summary.releaseReady !== false
    || summary.authenticatedBrowser !== (summary.mode === "api_only" ? "not_run" : "passed")
    || summary.smtp !== (summary.mode === "api_only" ? "not_run" : "passed_local_capture")) {
    throw new Error("QA completed without consistent passed acceptance metadata.");
  }
  return createAcceptanceSummary({ ...summary,
    apiOnly: summary.mode === "api_only", authenticatedBrowser: summary.authenticatedBrowser === "passed" });
}
