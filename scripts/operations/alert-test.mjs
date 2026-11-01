import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { policy, validateTarget } from "./policy.mjs";
import { sendBrevoAlert } from "./brevo.mjs";

export async function testAlert(env, fetcher = fetch) {
  validateTarget(env);
  assert.equal(policy.staging.monitoringApproved, true);
  assert.equal(env.OPS_ALERTS_ENABLED, "1");
  assert.equal(env.OPS_ALERT_TEST_CONFIRM, policy.staging.alertEmail, "Explicit approved test recipient required.");
  if (policy.staging.alertProvider === "brevo") return sendBrevoAlert({ sampledAt: new Date().toISOString(), incidents: ["OPS_TEST_ALERT"] }, env, fetcher, true);
  assert.ok(policy.staging.alertWebhookOrigin, "An approved alert provider is not configured.");
  const url = new URL(env.OPS_ALERT_WEBHOOK_URL);
  assert.equal(url.protocol, "https:"); assert.equal(url.origin, policy.staging.alertWebhookOrigin);
  assert.ok(!url.username && !url.password && !url.hash);
  const response = await fetcher(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ application: "UC Online Shop", environment: "staging",
      test: true, recipient: policy.staging.alertEmail, sampledAt: new Date().toISOString(), incidents: ["OPS_TEST_ALERT"] }) });
  assert.ok(response.ok, "The alert provider did not accept the test; no automatic retry.");
  return { environment: "staging", providerAccepted: true, inboxDeliveryConfirmed: false, productionTouched: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assert.equal(process.argv.length, 2); console.log(JSON.stringify(await testAlert(process.env))); }
  catch { console.error(JSON.stringify({ status: "failed", operation: "alert-delivery-test", privateDetailsWithheld: true, productionTouched: false })); process.exitCode = 1; }
}
