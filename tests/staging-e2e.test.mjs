import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registry } from "../scripts/staging/lib.mjs";
import { acceptanceStatus, accessibilityCounts, hostedPhases, manualGates, validateHostedInput } from "../scripts/staging/e2e-policy.mjs";
import { withStagingBypass } from "../scripts/deployment/staging-bypass.mjs";

const input = { sha: "a".repeat(40), deploymentId: "dpl_fixture" };
function harness({ uncertain = false, cleanupFailure = false, source = input.sha } = {}) {
  const existing = "b".repeat(32), generated = "c".repeat(32), writes = [], journals = [];
  const project = { id: registry.staging.vercelProjectId, accountId: registry.staging.vercelTeamId,
    name: "uc-online-shop-staging", framework: "nextjs", nodeVersion: "22.x", installCommand: "npm ci", buildCommand: "npm run build",
    ssoProtection: { deploymentType: "all" }, gitProviderOptions: { createDeployments: "disabled" },
    link: { type: "github", org: "justinedupa2005", repo: "uc-marketplace", productionBranch: "staging", deployHooks: [] },
    targets: { production: { id: input.deploymentId } }, protectionBypass: { [existing]: { note: "Preserve other operator", scope: "automation-bypass" } } };
  const api = async (endpoint, method = "GET", body) => {
    assert.ok(!endpoint.includes(registry.production.vercelProjectId));
    if (method === "GET") return endpoint.startsWith("/v13/") ? { projectId: project.id, readyState: "READY", meta: { githubCommitSha: source } } : structuredClone(project);
    writes.push(structuredClone(body));
    assert.equal(method, "PATCH"); assert.ok(endpoint.startsWith(`/v1/projects/${project.id}/protection-bypass?`));
    if (body.generate) { project.protectionBypass[generated] = { note: body.generate.note, scope: "automation-bypass" }; if (uncertain) throw new Error("Uncertain response"); }
    else { assert.equal(body.revoke.secret, generated); assert.equal(body.revoke.regenerate, false); if (cleanupFailure) throw new Error("Cleanup outage"); delete project.protectionBypass[generated]; }
    return { protectionBypass: structuredClone(project.protectionBypass) };
  };
  return { project, writes, journals, generated, existing, options: { api, journal: async (file, value) => { journals.push({ file, ...value }); } } };
}
test("hosted acceptance pins immutable source and never accepts a caller-supplied host or privileged payload", () => {
  assert.doesNotThrow(() => validateHostedInput(input));
  for (const patch of [{ sha: "staging" }, { deploymentId: "evil" }, { origin: registry.production.appOrigin }, { serviceKey: "private" }]) {
    assert.throws(() => validateHostedInput({ ...input, ...patch }));
  }
});
test("passing automation remains explicitly incomplete for real email, physical devices and screen readers", () => {
  const evidence = { phases: Object.fromEntries(hostedPhases.map((name) => [name, "passed"])), cleanup: true, bypassRevoked: true, failures: { browser: 0 },
    apiChecks: 253, concurrencyScenarios: 3, realtimeScenarios: 4, browserChecks: 100, accessibility: Array.from({ length: 10 }, () => ({ violations: [] })) };
  assert.equal(acceptanceStatus(evidence), "automated_passed_manual_pending");
  assert.ok(manualGates.includes("hosted_registration_confirmation") && manualGates.includes("hosted_password_recovery") && manualGates.includes("physical_ios"));
  for (const patch of [{ cleanup: false }, { bypassRevoked: false }, { phases: {} }, { failures: { browser: 1 } },
    { accessibility: [{ violations: [{ impact: "serious" }] }] }, { apiChecks: 0 }, { browserChecks: 0 }, { accessibility: [] },
    { concurrencyScenarios: 0 }, { realtimeScenarios: 0 }]) assert.equal(acceptanceStatus({ ...evidence, ...patch }), "failed");
});
test("accessibility evidence retains counts and rule IDs, never private HTML, targets or URLs", () => {
  const item = { id: "color-contrast", impact: "serious", nodes: [{ html: "private school ID", target: ["private account"], failureSummary: "secret" }] };
  assert.deepEqual(accessibilityCounts({ violations: [item], incomplete: [] }), { violations: [{ rule: "color-contrast", impact: "serious", nodes: 1 }], needsReview: [] });
  assert.throws(() => accessibilityCounts({ violations: [{ ...item, id: "secret://private" }], incomplete: [] }));
});
test("temporary hosted bypass is staging-only, generated once, privately passed and always revoked", async () => {
  const h = harness(); let received;
  assert.equal(await withStagingBypass(input, async (secret) => { received = secret; return 123; }, h.options), 123);
  assert.equal(received, h.generated); assert.equal(h.writes.length, 2);
  assert.deepEqual(Object.keys(h.project.protectionBypass), [h.existing]);
  assert.equal(h.journals.at(-1).state, "revoked"); assert.ok(!JSON.stringify(h.journals).includes(h.generated));
});
test("browser failure still revokes only this run's temporary bypass", async () => {
  const h = harness(); await assert.rejects(withStagingBypass(input, async () => { throw new Error("Browser failure"); }, h.options));
  assert.deepEqual(Object.keys(h.project.protectionBypass), [h.existing]); assert.equal(h.journals.at(-1).state, "revoked");
});
test("uncertain bypass generation is recovered by unique note without write retry", async () => {
  const h = harness({ uncertain: true }); let operations = 0;
  await assert.rejects(withStagingBypass(input, async () => { operations++; }, h.options));
  assert.equal(operations, 0); assert.equal(h.writes.filter((item) => item.generate).length, 1);
  assert.deepEqual(Object.keys(h.project.protectionBypass), [h.existing]);
});
test("stale deployed source and failed revocation never become passing evidence", async () => {
  const stale = harness({ source: "f".repeat(40) });
  await assert.rejects(withStagingBypass(input, async () => {}, stale.options)); assert.equal(stale.writes.length, 0);
  const failed = harness({ cleanupFailure: true });
  await assert.rejects(withStagingBypass(input, async () => {}, failed.options)); assert.notEqual(failed.journals.at(-1).state, "revoked");
});
test("deployed suite keeps local browser guards intact and uses owned cleanup, TLS and security matrices", async () => {
  const runner = await readFile(new URL("../scripts/staging/e2e.mjs", import.meta.url), "utf8");
  for (const contract of ["verifyStagingProject(api)", "stagingPoolOptions", "getStagingCa()", "cleanupFixtures(context)", "runApiChecks(context)", "runConcurrencyChecks(context)", "runRealtimeChecks(context)", "auth.disable_signup, true", "smtp.example.invalid"]) assert.ok(runner.includes(contract));
  const helper = await readFile(new URL("../tests/e2e/qa-helpers.ts", import.meta.url), "utf8");
  assert.ok(helper.includes("hosted-project mutations are not supported"));
});

test("hosted browser contracts match actual review triggers, successful logout notices and streamed waits", async () => {
  const source = await readFile(new URL("../scripts/staging/e2e-browser.mjs", import.meta.url), "utf8");
  assert.ok(source.includes('moderate(admin.page, "Reject", "Reject verification"'));
  assert.ok(source.includes('trigger === "Reject" ? "Reject verification"'));
  assert.ok(source.includes('url.pathname === "/login"'));
  assert.ok(!source.includes('toHaveURL(/\\/login\\?authNotice=logged-out$/)'));
  assert.ok(source.includes('timeout: 60_000'));
  assert.ok(source.includes('check(new URL(page.url()).pathname === new URL(route, origin).pathname)'));
});
