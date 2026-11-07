import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { policy, registry, backupBindings, requireBackupBindings } from "../scripts/operations/policy.mjs";
import { validateBundle, validateRestoreEvidence, readJsonSnapshot } from "../scripts/operations/bundle.mjs";
import { verifyScheduledReadiness, cycle } from "../scripts/operations/cycle.mjs";
import { testAlert } from "../scripts/operations/alert-test.mjs";
import { sendBrevoAlert } from "../scripts/operations/brevo.mjs";
import { databaseFailureCode } from "../scripts/operations/diagnostics.mjs";
import { fingerprintFormat } from "../scripts/operations/fingerprints.mjs";

const run = "11111111-1111-4111-8111-111111111111", sha = "a".repeat(40);
const ids = { database: "1".repeat(64), media: "2".repeat(64), verification: "3".repeat(64), bundle: "4".repeat(64) };
const snapshots = Object.entries(ids).map(([component, id]) => ({ id, hostname: "uc-marketplace-staging", time: new Date().toISOString(),
  tags: ["ucm:staging", `component:${component}`, `run:${run}`] }));
const manifest = { version: 1, complete: true, projectRef: registry.staging.supabaseProjectRef, runId: run, dataScope: "synthetic-only",
  snapshots: { database: ids.database, media: ids.media, verification: ids.verification },
  storage: { inventory: [], objects: 0 }, database: { fingerprintFormat, fingerprints: {}, roles: [] } };
const proof = () => ({ version: 1, status: "passed", environment: "staging", dataScope: "synthetic-only", repositoryId: policy.staging.repositoryId,
  sourceSha: sha, bundleId: ids.bundle, runId: run, databaseRestored: true, storageRestored: true, tablesMatched: true, imageDecoded: true,
  cleanup: true, catalogAssertions: 129, restoredAccessChecks: 3, objectsRestored: 15, completedAt: new Date().toISOString(), productionTouched: false });
const env = { OPS_ENV: "staging", OPS_PROJECT_REF: registry.staging.supabaseProjectRef, OPS_DATA_SCOPE: "synthetic-only",
  RESTIC_REPOSITORY: policy.staging.repository, RESTIC_PASSWORD: "Synthetic-test-only-repository-password-0123456789", OPS_SCHEDULED_CONFIRM: "staging-synthetic-only" };

test("missing reusable-workflow credentials fail before network or capture and expose only fixed input names", async () => {
  const configured = Object.fromEntries(backupBindings.map(name => [name, `synthetic-test-only-${name}`]));
  const original = { ...configured };
  assert.doesNotThrow(() => requireBackupBindings(configured)); assert.deepEqual(configured, original);
  const missing = ["OPS_DATABASE_URL", "OPS_SERVICE_ROLE_KEY", "RESTIC_PASSWORD", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
  const delivered = { ...env, ...Object.fromEntries(missing.map(name => [name, ""])), AWS_DEFAULT_REGION: "us-west-004" };
  await assert.rejects(cycle(delivered), error => {
    assert.equal(error.operationPhase, "preflight-bindings");
    assert.deepEqual(error.operationCodes, missing.map(name => `${name}_REQUIRED`));
    assert.ok(!JSON.stringify(error).includes(env.RESTIC_PASSWORD)); return true;
  });
  for (const value of [undefined, "", " \r\n ", 1]) {
    assert.throws(() => requireBackupBindings({ ...configured, RESTIC_PASSWORD: value }), error => {
      assert.deepEqual(error.operationCodes, ["RESTIC_PASSWORD_REQUIRED"]); return true;
    });
  }
});

test("invalid repository/password policy failures stay inside the cycle's classified preflight without private assertion diffs", async () => {
  const delivered = { ...Object.fromEntries(backupBindings.map(name => [name, `synthetic-test-only-${name}`])), ...env };
  for (const [values, code] of [[{ RESTIC_PASSWORD: "short-test-value" }, "RESTIC_PASSWORD_POLICY_REJECTED"],
    [{ RESTIC_REPOSITORY: "s3:https://wrong.example.test/wrong" }, "RESTIC_REPOSITORY_MISMATCH"]]) {
    await assert.rejects(cycle({ ...delivered, ...values }), error => {
      assert.equal(error.operationPhase, "preflight-policy"); assert.deepEqual(error.operationCodes, [code]);
      assert.ok(!JSON.stringify(error).includes(Object.values(values)[0])); return true;
    });
  }
});

test("database preflight diagnostics distinguish refused authentication without exposing provider details", () => {
  assert.equal(databaseFailureCode({ code: "28P01", message: "private provider detail" }), "DATABASE_AUTHENTICATION_REJECTED");
  assert.equal(databaseFailureCode({ code: "42501" }), "DATABASE_PERMISSION_DENIED");
  assert.equal(databaseFailureCode({ code: "ETIMEDOUT" }), "DATABASE_NETWORK_UNAVAILABLE");
  assert.equal(databaseFailureCode({ code: "untrusted-code", message: "private" }), "DATABASE_PREFLIGHT_FAILED");
  assert.equal(databaseFailureCode({ code: "constructor" }), "DATABASE_PREFLIGHT_FAILED");
});

test("restoration resolves the exact complete bundle and refuses mixed source, scope, run or component IDs", () => {
  assert.equal(validateBundle(manifest, ids.bundle, snapshots), manifest);
  for (const change of [{ complete: false }, { projectRef: registry.production.supabaseProjectRef }, { dataScope: "real-data" }, { runId: "bad" },
    { snapshots: { ...manifest.snapshots, bundle: ids.database } }, { snapshots: { database: ids.database } }]) {
    assert.throws(() => validateBundle({ ...manifest, ...change }, ids.bundle, snapshots));
  }
  assert.throws(() => validateBundle(manifest, ids.bundle, snapshots.slice(1)));
  assert.throws(() => validateBundle(manifest, ids.bundle, snapshots.map(item => ({ ...item, hostname: "another-project" }))));
});

test("encrypted manifest reads are bounded and never accept truncated JSON", async () => {
  const storage = { dump: async (_id, _component, output) => output(Buffer.from(JSON.stringify(manifest))) };
  assert.deepEqual(await readJsonSnapshot(storage, ids.bundle, "bundle"), manifest);
  await assert.rejects(readJsonSnapshot(storage, ids.bundle, "bundle", 1));
  await assert.rejects(readJsonSnapshot({ dump: async (_id, _component, output) => output(Buffer.from("{")) }, ids.bundle, "bundle"));
});

test("automatic backup proof must match this vault and exact reviewed source, with complete recent restoration and cleanup", () => {
  assert.equal(validateRestoreEvidence(proof(), policy.staging.repositoryId, sha).status, "passed");
  for (const changes of [{ status: "failed" }, { environment: "production" }, { dataScope: "real-data" }, { repositoryId: ids.database },
    { sourceSha: "b".repeat(40) }, { bundleId: "latest" }, { databaseRestored: false }, { storageRestored: false }, { tablesMatched: false },
    { imageDecoded: false }, { cleanup: false }, { catalogAssertions: 0 }, { restoredAccessChecks: 2 }, { objectsRestored: 0 },
    { completedAt: "not-a-date" }, { completedAt: new Date(Date.now() - 8 * 86400000).toISOString() }, { productionTouched: true }]) {
    assert.throws(() => validateRestoreEvidence({ ...proof(), ...changes }, policy.staging.repositoryId, sha));
  }
});

test("scheduled backups refuse disabled policy, missing evidence and evidence from a different commit", async () => {
  let accessed = false;
  const original = policy.staging.enabled;
  const value = proof();
  const storage = { verify: async () => { accessed = true; }, snapshots: async () => [{ ...snapshots[3], id: "5".repeat(64), tags: ["component:restore-evidence", `run:${run}`] }],
    dump: async (_id, component, output) => { assert.equal(component, "restore-evidence"); output(Buffer.from(JSON.stringify(value))); } };
  try {
    policy.staging.enabled = false;
    await assert.rejects(verifyScheduledReadiness(env, sha, storage)); assert.equal(accessed, false);
    policy.staging.enabled = true;
    assert.equal((await verifyScheduledReadiness(env, sha, storage)).bundleId, ids.bundle);
    await assert.rejects(verifyScheduledReadiness(env, "b".repeat(40), storage));
    await assert.rejects(verifyScheduledReadiness(env, sha, { ...storage, snapshots: async () => [] }));
    await assert.rejects(verifyScheduledReadiness({ ...env, OPS_SCHEDULED_CONFIRM: undefined }, sha, storage));
  } finally { policy.staging.enabled = original; }
});

test("an unconfigured or unapproved alert provider cannot receive even a test request", async () => {
  let called = false;
  const fetcher = async () => { called = true; return new Response("ok"); };
  await assert.rejects(testAlert({ ...env, OPS_ALERTS_ENABLED: "1", OPS_ALERT_TEST_CONFIRM: policy.staging.alertEmail }, fetcher));
  await assert.rejects(testAlert({ ...env, OPS_ALERTS_ENABLED: "1", OPS_ALERT_TEST_CONFIRM: "unapproved@example.test" }, fetcher));
  assert.equal(called, false);
});

test("alert test sends only a fixed synthetic payload to the exact approved HTTPS origin, without retry or inbox claims", async () => {
  const original = policy.staging.alertWebhookOrigin;
  const provider = policy.staging.alertProvider;
  policy.staging.alertProvider = "webhook";
  policy.staging.alertWebhookOrigin = "https://alerts.example.test";
  const configured = { ...env, OPS_ALERTS_ENABLED: "1", OPS_ALERT_TEST_CONFIRM: policy.staging.alertEmail, OPS_ALERT_WEBHOOK_URL: "https://alerts.example.test/private-path" };
  let calls = 0;
  try {
    const result = await testAlert(configured, async (url, init) => {
      calls++; assert.equal(url.origin, policy.staging.alertWebhookOrigin); assert.equal(init.redirect, "error");
      const body = JSON.parse(init.body);
      assert.deepEqual(Object.keys(body).sort(), ["application", "environment", "incidents", "recipient", "sampledAt", "test"]);
      assert.deepEqual(body.incidents, ["OPS_TEST_ALERT"]); assert.equal(body.recipient, policy.staging.alertEmail);
      return new Response("accepted");
    });
    assert.equal(calls, 1); assert.equal(result.providerAccepted, true); assert.equal(result.inboxDeliveryConfirmed, false);
    await assert.rejects(testAlert({ ...configured, OPS_ALERT_WEBHOOK_URL: "https://another.example.test/private" }, async () => { throw new Error("Must not send"); }));
    await assert.rejects(testAlert(configured, async () => { calls++; return new Response("rejected", { status: 500 }); }));
    assert.equal(calls, 2);
  } finally { policy.staging.alertWebhookOrigin = original; policy.staging.alertProvider = provider; }
});

test("Brevo sends one consented, fixed-payload test to its pinned API; missing sender/key and unsafe input cannot send", async () => {
  const sender = policy.staging.alertSenderEmail, verified = policy.staging.alertSenderVerified;
  let calls = 0;
  const secret = "synthetic-test-only-operator-api-value-".repeat(2);
  const configured = { ...env, OPS_ALERTS_ENABLED: "1", OPS_ALERT_TEST_CONFIRM: policy.staging.alertEmail, OPS_BREVO_API_KEY: secret };
  try {
    policy.staging.alertSenderEmail = "operations@example.test";
    policy.staging.alertSenderVerified = true;
    const result = await testAlert(configured, async (url, init) => {
      calls++; assert.equal(url.href, "https://api.brevo.com/v3/smtp/email"); assert.equal(init.redirect, "error");
      assert.equal(init.headers["api-key"], secret);
      const body = JSON.parse(init.body);
      assert.deepEqual(body.to, [{ email: "ucmarketplace.security@gmail.com" }]);
      assert.deepEqual(body.sender, { email: "operations@example.test", name: "UC Online Shop Operations" });
      assert.match(body.textContent, /OPS_TEST_ALERT/); assert.ok(!body.textContent.includes(secret));
      return new Response(null, { status: 201 });
    });
    assert.equal(result.provider, "brevo"); assert.equal(result.providerAccepted, true); assert.equal(result.inboxDeliveryConfirmed, false);
    const forbidden = async () => { throw new Error("Must not send"); };
    await assert.rejects(testAlert({ ...configured, OPS_BREVO_API_KEY: undefined }, forbidden));
    await assert.rejects(testAlert({ ...configured, OPS_ALERT_TEST_CONFIRM: "unapproved@example.test" }, forbidden));
    policy.staging.alertSenderVerified = false; await assert.rejects(testAlert(configured, forbidden));
    policy.staging.alertSenderVerified = true;
    await assert.rejects(sendBrevoAlert({ sampledAt: new Date().toISOString(), incidents: ["unreviewed student content"] }, configured, forbidden, true));
    for (const status of [400, 401, 429, 500]) await assert.rejects(testAlert(configured, async () => { calls++; return new Response(null, { status }); }));
    assert.equal(calls, 5);
  } finally { policy.staging.alertSenderEmail = sender; policy.staging.alertSenderVerified = verified; }
});

test("manual vault operations are independent of daily scheduling and retain staging review, source checks and step-only secrets", async () => {
  const workflow = await readFile(new URL("../.github/workflows/backups-and-restore.yml", import.meta.url), "utf8");
  const job = workflow.slice(workflow.indexOf("\n  encrypted-backup:"), workflow.indexOf("\n  monitoring:"));
  const condition = job.split("\n").find(line => line.trimStart().startsWith("if:"));
  const manual = condition.split("|| (github.event_name == 'schedule'")[0];
  assert.ok(manual.includes("workflow_dispatch") && manual.includes("capture-restore") && !manual.includes("STAGING_BACKUPS_ENABLED"));
  assert.ok(condition.includes("vars.STAGING_BACKUPS_ENABLED == 'true'"));
  assert.match(job, /environment: staging-operations/);
  assert.equal((job.match(/node scripts\/operations\/verify-source\.mjs/g) ?? []).length, 2);
  assert.match(job, /OPS_DATA_SCOPE: synthetic-only/); assert.match(job, /npm run ops:cycle/);
  const restore = await readFile(new URL("../scripts/operations/restore.mjs", import.meta.url), "utf8");
  assert.ok(!restore.includes("--clean") && !restore.includes("env.OPS_DATABASE_URL"));
  assert.doesNotMatch(restore, /--publish/); assert.match(restore, /openRestoreTunnel\(containerEnv\)/);
  assert.match(restore, /assertDrillContainer\(containerEnv/);
  assert.match(restore, /"network", "create", "--internal"/);
  assert.match(restore, /networkInfo\[0\]\.Labels\["ucmarketplace.restore-drill"\]/);
  const drill = await readFile(new URL("../scripts/operations/drill.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(drill, /--publish/); assert.match(drill, /openRestoreTunnel\(privateEnv\)/);
  assert.match(drill, /"network", "create", "--internal"/);
});

test("credential-free CI runs a complete encrypted synthetic restore through the same internal-network relay", async () => {
  const workflow = await readFile(new URL("../.github/workflows/security-qa.yml", import.meta.url), "utf8");
  const local = workflow.slice(workflow.indexOf("\n  local-security:"), workflow.indexOf("\n  staging-operations:"));
  assert.ok(local.indexOf("npx playwright install") < local.indexOf("run: npm run ops:drill"));
  assert.ok(local.indexOf("run: npm run ops:install-restic") < local.indexOf("run: npm run ops:drill"));
  assert.match(local, /OPS_RESTIC_BINARY: \$\{\{ github\.workspace \}\}\/\.qa\/tools\/restic-0\.19\.1\/restic/);
  assert.doesNotMatch(local, /\$\{\{ secrets\.|environment: staging/);
});

test("the registered QA workflow explicitly passes only declared operation secret names after CI, without broad inheritance", async () => {
  const workflow = await readFile(new URL("../.github/workflows/security-qa.yml", import.meta.url), "utf8");
  const job = workflow.slice(workflow.indexOf("\n  staging-operations:"), workflow.indexOf("\n  isolated-full-stack:"));
  assert.match(job, /github\.event_name == 'workflow_dispatch'/);
  assert.match(job, /github\.ref == 'refs\/heads\/staging'/);
  assert.match(job, /needs: local-security/);
  assert.match(job, /uses: \.\/\.github\/workflows\/backups-and-restore\.yml/);
  assert.match(job, /operation: \$\{\{ inputs\.staging_operation \}\}/);
  assert.ok(!/^\s*secrets:\s*inherit\s*$/m.test(job));
  const required = ["OPS_DATABASE_URL", "OPS_SERVICE_ROLE_KEY", "RESTIC_PASSWORD", "BACKUP_ACCESS_KEY_ID", "BACKUP_SECRET_ACCESS_KEY"];
  const optional = ["OPS_MANAGEMENT_TOKEN", "OPS_VERCEL_TOKEN", "OPS_ALERT_WEBHOOK_URL", "OPS_BREVO_API_KEY"];
  const bindings = [...job.matchAll(/^\s+([A-Z_]+): \$\{\{ secrets\.([A-Z_]+) \}\}$/gm)];
  assert.deepEqual(bindings.map(([, name]) => name), [...required, ...optional]);
  assert.ok(bindings.every(([, name, source]) => name === source));
  assert.match(job, /actions: read/);
  assert.match(workflow, /cancel-in-progress: \$\{\{.*inputs\.staging_operation == 'none'/);
  assert.match(workflow, /group: security-qa-.*'operations' \|\| 'quality'/);
  const called = await readFile(new URL("../.github/workflows/backups-and-restore.yml", import.meta.url), "utf8");
  assert.match(called, /workflow_call:\s+inputs:\s+operation:/);
  const contract = called.slice(called.indexOf("  workflow_call:"), called.indexOf("  workflow_dispatch:"));
  for (const name of required) assert.match(contract, new RegExp(`${name}:\\s+required: true`));
  for (const name of optional) assert.match(contract, new RegExp(`${name}:\\s+required: false`));
  assert.equal((called.match(/environment: staging-operations/g) ?? []).length, 3);
});

test("the explicit Brevo delivery job never releases database, vault or hosting credentials", async () => {
  const workflow = await readFile(new URL("../.github/workflows/backups-and-restore.yml", import.meta.url), "utf8");
  const job = workflow.slice(workflow.indexOf("\n  alert-delivery:"));
  assert.match(job, /environment: staging-operations/);
  assert.match(job, /github\.ref == 'refs\/heads\/staging'.*inputs\.operation == 'alert-test'/);
  assert.equal((job.match(/node scripts\/operations\/verify-source\.mjs/g) ?? []).length, 2);
  assert.match(job, /npm run ops:alerts:test/);
  assert.deepEqual([...job.matchAll(/\$\{\{ secrets\.([A-Z_]+) \}\}/g)].map(match => match[1]), ["OPS_BREVO_API_KEY"]);
});

test("protected operation jobs re-audit after review and installation, before releasing step-only credentials", async () => {
  const workflow = await readFile(new URL("../.github/workflows/backups-and-restore.yml", import.meta.url), "utf8");
  const qa = await readFile(new URL("../.github/workflows/security-qa.yml", import.meta.url), "utf8");
  const sections = [
    workflow.slice(workflow.indexOf("\n  encrypted-backup:"), workflow.indexOf("\n  monitoring:")),
    workflow.slice(workflow.indexOf("\n  monitoring:"), workflow.indexOf("\n  alert-delivery:")),
    workflow.slice(workflow.indexOf("\n  alert-delivery:")),
    qa.slice(qa.indexOf("\n  synthetic-backblaze:")),
  ];
  for (const job of sections) {
    assert.match(job, /environment: staging(?:-operations)?/);
    const install = job.indexOf("run: npm ci"), audit = job.indexOf("run: npm run qa:dependencies");
    const lastSource = job.lastIndexOf("run: node scripts/operations/verify-source.mjs");
    const credentials = job.indexOf("${{ secrets.");
    assert.ok(install >= 0 && audit > install && lastSource > audit && credentials > lastSource);
    assert.equal((job.match(/run: npm run qa:dependencies/g) ?? []).length, 1);
    assert.doesNotMatch(job, /continue-on-error: true/);
  }
});
