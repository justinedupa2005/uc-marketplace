import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dispatchSchedule, scheduledOperation, verifyScheduleOrigin, schedulerPath } from "../scripts/operations/schedule.mjs";

const repo = "justinedupa2005/uc-marketplace", sha = "a".repeat(40), now = Date.parse("2026-11-08T04:00:00Z");
const env = { GITHUB_REPOSITORY: repo, GITHUB_EVENT_NAME: "schedule", GITHUB_REF: "refs/heads/main", GITHUB_RUN_ID: "12345",
  GH_TOKEN: "private-test-config", STAGING_BACKUPS_ENABLED: "true" };
function responses(changes = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    assert.ok(url.startsWith(`https://api.github.com/repos/${repo}/`));
    assert.equal(init.redirect, "error"); assert.equal(init.headers.Authorization, `Bearer ${env.GH_TOKEN}`);
    calls.push({ url, ...init });
    if (init.method === "POST") return new Response(null, { status: 204 });
    const value = url.includes("/git/ref/") ? { object: { sha } } : url.includes("event=push")
      ? { workflow_runs: [{ id: 1, head_sha: sha, head_branch: "staging", event: "push", head_repository: { full_name: repo }, status: "completed", conclusion: "success", ...changes.ci }] }
      : { workflow_runs: changes.prior ?? [] };
    return Response.json(value);
  };
  return { calls, fetcher };
}

test("only registered staging schedules can queue; monitoring requires independent inbox confirmation", () => {
  assert.equal(scheduledOperation("17 18 * * *", {}), null);
  assert.equal(scheduledOperation("17 18 * * *", env), "capture-restore");
  assert.equal(scheduledOperation("47 18 * * 0", env), "check");
  assert.throws(() => scheduledOperation("* * * * *", env));
  assert.equal(scheduledOperation("*/15 * * * *", env), null);
  assert.throws(() => scheduledOperation("*/15 * * * *", { ...env, STAGING_MONITORING_ENABLED: "true" }));
  const monitoring = { ...env, STAGING_MONITORING_ENABLED: "true", STAGING_ALERTS_ENABLED: "true" };
  assert.throws(() => scheduledOperation("*/15 * * * *", monitoring));
  assert.equal(scheduledOperation("*/15 * * * *", { ...monitoring, STAGING_ALERT_DELIVERY_CONFIRMED: "true" }), "monitor");
});

test("cron queues exactly one staging workflow with no deployment, approval or long-lived credentials", async () => {
  const { calls, fetcher } = responses();
  const result = await dispatchSchedule(env, { schedule: "17 18 * * *" }, fetcher);
  assert.equal(result.status, "queued"); assert.equal(result.backupCompleted, false); assert.equal(result.manualReviewRequired, true);
  assert.equal(result.productionTouched, false);
  const posts = calls.filter(call => call.method === "POST");
  assert.equal(posts.length, 1);
  assert.ok(posts[0].url.endsWith("/actions/workflows/security-qa.yml/dispatches"));
  assert.deepEqual(JSON.parse(posts[0].body), { ref: "staging", inputs: { staging_operation: "capture-restore", full_stack: false,
    synthetic_b2: false, staging_schedule_run_id: env.GITHUB_RUN_ID, staging_schedule_cron: "17 18 * * *" } });
  assert.ok(!JSON.stringify(result).includes(env.GH_TOKEN));
});

test("disabled, unapproved, non-main, duplicate and failed requests cannot dispatch or retry", async () => {
  const disabled = responses();
  assert.equal((await dispatchSchedule({ ...env, STAGING_BACKUPS_ENABLED: "false" }, { schedule: "17 18 * * *" }, disabled.fetcher)).status, "disabled");
  assert.equal(disabled.calls.length, 0);
  for (const changes of [{ ci: { conclusion: "failure" } }, { ci: { status: "in_progress" } }, { ci: { head_sha: "b".repeat(40) } }]) {
    const f = responses(changes);
    await assert.rejects(dispatchSchedule(env, { schedule: "17 18 * * *" }, f.fetcher));
    assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
  }
  const busy = responses({ prior: [{ status: "waiting" }] });
  assert.equal((await dispatchSchedule(env, { schedule: "17 18 * * *" }, busy.fetcher)).status, "deferred_pending_run");
  assert.equal(busy.calls.filter(call => call.method === "POST").length, 0);
  await assert.rejects(dispatchSchedule({ ...env, GITHUB_REF: "refs/heads/staging" }, { schedule: "17 18 * * *" }));
  await assert.rejects(dispatchSchedule({ ...env, GITHUB_EVENT_NAME: "workflow_dispatch" }, { schedule: "17 18 * * *" }));
  let sends = 0;
  const f = responses();
  await assert.rejects(dispatchSchedule(env, { schedule: "17 18 * * *" }, (url, init) => {
    if (init.method === "POST") { sends++; throw new Error("synthetic network failure"); }
    return f.fetcher(url, init);
  }));
  assert.equal(sends, 1);
});

test("the protected child rejects stale, failed, unrelated and forged scheduled provenance", async () => {
  const child = { ...env, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/staging", GITHUB_RUN_ID: "12346",
    OPS_SCHEDULE_RUN_ID: "12345", OPS_SCHEDULE_CRON: "17 18 * * *", OPS_OPERATION: "capture-restore" };
  const parent = { id: 12345, event: "schedule", path: schedulerPath, head_branch: "main", head_repository: { full_name: repo },
    status: "completed", conclusion: "success", created_at: new Date(now - 60000).toISOString() };
  await verifyScheduleOrigin(child, async () => Response.json(parent), now);
  await verifyScheduleOrigin({ ...child, OPS_SCHEDULE_RUN_ID: "", OPS_SCHEDULE_CRON: "" });
  for (const changes of [{ event: "workflow_dispatch" }, { path: ".github/workflows/unrelated.yml" }, { head_branch: "staging" },
    { conclusion: "failure" }, { status: "in_progress" }, { created_at: new Date(now - 27 * 3600000).toISOString() },
    { head_repository: { full_name: "untrusted/fork" } }, { id: 9 }]) {
    await assert.rejects(verifyScheduleOrigin(child, async () => Response.json({ ...parent, ...changes }), now));
  }
  await assert.rejects(verifyScheduleOrigin({ ...child, STAGING_BACKUPS_ENABLED: "false" }, async () => Response.json(parent), now));
  await assert.rejects(verifyScheduleOrigin({ ...child, OPS_OPERATION: "alert-test" }, async () => Response.json(parent), now));
});

test("default-branch registration is credential-free and protected workers remain staging-only", async () => {
  const workflow = await readFile(new URL("../.github/workflows/staging-operations-schedule.yml", import.meta.url), "utf8");
  assert.match(workflow, /cron: "17 18 \* \* \*"/);
  assert.match(workflow, /permissions: \{\}/); assert.match(workflow, /actions: write/);
  assert.doesNotMatch(workflow, /secrets\.|^\s+environment:|^\s+run:.*(?:npm ci|gh run approve|vercel)/m);
  const workers = await readFile(new URL("../.github/workflows/backups-and-restore.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workers, /^  schedule:/m);
  assert.equal((workers.match(/environment: staging-operations/g) ?? []).length, 3);
  assert.match(workers, /OPS_SCHEDULED_CONFIRM:.*inputs.schedule_run_id/);
  const source = await readFile(new URL("../scripts/operations/verify-source.mjs", import.meta.url), "utf8");
  assert.match(source, /await verifyScheduleOrigin\(process.env\)/);
  assert.doesNotMatch(source, /GITHUB_EVENT_NAME === "schedule"/);
});
