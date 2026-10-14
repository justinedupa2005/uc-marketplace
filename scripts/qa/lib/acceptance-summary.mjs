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

const failurePhases = new Set(["configuration", "database", "build", "server", "provisioning", "api", "concurrency", "realtime", "email", "browser", "cleanup"]);
const processReasons = new Set(["start", "timeout", "output", "runtime", "stopped", "exit", "cleanup", "progress"]);
const serviceCodes = new Set(["service_error", "unexpected_failure", "invalid_credentials", "email_not_confirmed", "weak_password", "same_password", "email_exists", "user_not_found", "not_admin", "signup_disabled", "otp_expired", "bad_jwt", "bad_json", "validation_failed", "over_email_send_rate_limit", "over_request_rate_limit"]);

/** A failed child may export only phase/IDs, never its error or private output. */
export function createAcceptanceFailure({ phase, code = "unknown", httpStatus = null, assertion = null, processReason = null, cleanupFailed = false }) {
  if (!failurePhases.has(phase)) throw new Error("QA failure requires an allowlisted acceptance phase.");
  return {
    version: 1, status: "failed", phase,
    code: typeof code === "string" && (/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(code) || serviceCodes.has(code)) ? code : "unknown",
    httpStatus: Number.isSafeInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
    assertion: Number.isSafeInteger(assertion) && assertion > 0 && assertion <= 100_000 ? assertion : null,
    processReason: processReasons.has(processReason) ? processReason : null,
    cleanupFailed: cleanupFailed === true,
  };
}

export function parseAcceptanceFailure(output) {
  const lines = String(output).split(/\r?\n/).filter((line) => line.startsWith("QA_FAILURE_JSON:"));
  if (lines.length !== 1) return null;
  try {
    const value = JSON.parse(lines[0].slice("QA_FAILURE_JSON:".length));
    if (!value || Array.isArray(value) || value.version !== 1 || value.status !== "failed") return null;
    return createAcceptanceFailure(value);
  } catch { return null; }
}
