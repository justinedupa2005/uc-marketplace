import assert from "node:assert/strict";
import { registry, staging } from "./lib.mjs";

export const hostedPhases = ["accounts", "api", "concurrency", "realtime", "verification", "selling", "buying", "transaction", "security", "sessions", "accessibility"];
export const manualGates = ["hosted_registration_confirmation", "hosted_password_recovery", "physical_android", "physical_ios", "screen_reader_review", "manual_visual_keyboard_zoom"];

export function validateHostedInput(input) {
  assert.deepEqual(Object.keys(input).sort(), ["deploymentId", "sha"]);
  assert.match(input.sha, /^[a-f0-9]{40}$/);
  assert.match(input.deploymentId, /^dpl_[A-Za-z0-9]+$/);
  assert.equal(registry.production.deploymentEnabled, false);
  assert.notEqual(staging.supabaseProjectRef, registry.production.supabaseProjectRef);
  assert.notEqual(staging.appOrigin, registry.production.appOrigin);
  return input;
}

export function accessibilityCounts(results) {
  // Never persist node HTML, selectors, screenshots or private page contents.
  const summarize = (items) => items.map(({ id, impact, nodes }) => {
    assert.match(id, /^[a-z][a-z0-9-]{0,80}$/);
    assert.ok([null, "minor", "moderate", "serious", "critical"].includes(impact));
    assert.ok(Array.isArray(nodes));
    return { rule: id, impact, nodes: nodes.length };
  });
  return { violations: summarize(results.violations), needsReview: summarize(results.incomplete) };
}

export function acceptanceStatus({ phases, cleanup, bypassRevoked, failures, accessibility, apiChecks, concurrencyScenarios, realtimeScenarios, browserChecks }) {
  const complete = hostedPhases.every((phase) => phases[phase] === "passed");
  const blockers = accessibility.some((scan) => scan.violations.some((rule) => ["serious", "critical"].includes(rule.impact)));
  const counts = [apiChecks, concurrencyScenarios, realtimeScenarios, browserChecks];
  const sufficient = counts.every(Number.isSafeInteger) && apiChecks >= 253 && concurrencyScenarios >= 3 && realtimeScenarios >= 4 && browserChecks >= 100 && accessibility.length >= 10;
  return complete && sufficient && cleanup && bypassRevoked && !blockers && Object.values(failures).every((count) => count === 0)
    ? "automated_passed_manual_pending" : "failed";
}
