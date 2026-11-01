import assert from "node:assert/strict";
import { policy, validateTarget } from "./policy.mjs";

export const incidentCodes = Object.freeze(["DEPLOYMENT_NOT_READY", "RUNTIME_COVERAGE_INCOMPLETE", "SERVER_ERRORS", "DATABASE_UNAVAILABLE",
  "DATABASE_CONNECTION_PRESSURE", "SLOW_ACTIVE_QUERIES", "CAPACITY_BUDGETS_UNCONFIGURED", "DATABASE_CAPACITY_PRESSURE", "STORAGE_CAPACITY_PRESSURE",
  "SERVICE_LOGS_UNAVAILABLE", "API_ERROR_SPIKE", "AUTH_FAILURE_SPIKE", "TRAFFIC_REVIEW", "SMTP_FAILURES", "DATABASE_ERRORS", "STORAGE_ERRORS", "REALTIME_ERRORS", "RESERVATION_FAILURES", "BACKUP_NOT_VERIFIED_FRESH"]);

// Operator-only transport. Never import into application/browser code, reuse
// Supabase SMTP credentials, accept caller URLs, or print provider responses.
export async function sendBrevoAlert(report, env, fetcher = fetch, test = false) {
  validateTarget(env);
  const selected = policy.staging;
  assert.equal(selected.alertProvider, "brevo");
  assert.equal(selected.monitoringApproved, true); assert.equal(env.OPS_ALERTS_ENABLED, "1");
  assert.equal(selected.alertEmail, "ucmarketplace.security@gmail.com");
  assert.equal(selected.alertSenderVerified, true, "Confirm the selected sender is verified in Brevo.");
  assert.match(selected.alertSenderEmail ?? "", /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/);
  const key = env.OPS_BREVO_API_KEY;
  assert.ok(typeof key === "string" && key.length >= 32 && key.length <= 512 && !/\s|example|placeholder|changeme/i.test(key), "A dedicated operator-only Brevo API key is required.");
  assert.equal(new Date(report.sampledAt).toISOString(), report.sampledAt);
  assert.ok(Array.isArray(report.incidents) && report.incidents.length > 0);
  if (test) {
    assert.equal(env.OPS_ALERT_TEST_CONFIRM, selected.alertEmail);
    assert.deepEqual(report.incidents, ["OPS_TEST_ALERT"]);
  } else {
    assert.equal(selected.monitoringEnabled, true);
    assert.ok(report.incidents.every(code => incidentCodes.includes(code)));
  }
  const response = await fetcher(new URL("https://api.brevo.com/v3/smtp/email"), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", "api-key": key },
    body: JSON.stringify({ sender: { email: selected.alertSenderEmail, name: "UC Online Shop Operations" },
      to: [{ email: selected.alertEmail }],
      subject: test ? "[STAGING] UC Online Shop operational alert test" : "[STAGING] UC Online Shop operational alerts",
      textContent: `UC Online Shop staging operations\n${test ? "This is the single requested synthetic delivery test." : "Investigate these operational signals in the private dashboards."}\nSampled at: ${report.sampledAt}\nSignals: ${report.incidents.join(", ")}\nNo student records, passwords, tokens or verification images are included.\nProduction deployment remains disabled.`,
      tags: ["ucmarketplace-staging-operations", test ? "delivery-test" : "incident"] }),
  });
  // A timeout may follow provider acceptance: never automatically resend. Review
  // Brevo privately before retrying; acceptance is not inbox delivery evidence.
  assert.equal(response.status, 201, "Brevo did not confirm acceptance; no automatic retry.");
  await response.body?.cancel();
  return { environment: "staging", provider: "brevo", providerAccepted: true, inboxDeliveryConfirmed: false, productionTouched: false };
}
