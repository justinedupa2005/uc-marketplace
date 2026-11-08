import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = "justinedupa2005/uc-marketplace";
export const schedulerPath = ".github/workflows/staging-operations-schedule.yml";
export const schedules = Object.freeze({ "17 18 * * *": "capture-restore", "47 18 * * 0": "check", "*/15 * * * *": "monitor" });

export function scheduledOperation(cron, env) {
  assert.ok(Object.hasOwn(schedules, cron), "Unregistered staging schedule.");
  const operation = schedules[cron];
  const enabled = operation === "monitor" ? env.STAGING_MONITORING_ENABLED : env.STAGING_BACKUPS_ENABLED;
  if (enabled !== "true") return null;
  if (operation === "monitor") {
    assert.equal(env.STAGING_ALERTS_ENABLED, "true", "Test alert delivery before scheduling monitoring.");
    assert.equal(env.STAGING_ALERT_DELIVERY_CONFIRMED, "true", "Inbox delivery confirmation is required.");
  }
  return operation;
}

function github(env, fetcher) {
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.ok(env.GH_TOKEN);
  return async (suffix, method = "GET", body) => {
    const response = await fetcher(`https://api.github.com/repos/${repository}${suffix}`, {
      method, redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, "Staging scheduler API request failed; details withheld.");
    return response.status === 204 ? null : response.json();
  };
}

// Runs from main with only the short-lived Actions token. No checkout of
// staging code, npm install, hosted credentials, environment or self-approval.
export async function dispatchSchedule(env, event, fetcher = fetch) {
  assert.equal(env.GITHUB_EVENT_NAME, "schedule");
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.match(env.GITHUB_RUN_ID ?? "", /^[1-9]\d{0,19}$/);
  const operation = scheduledOperation(event.schedule, env);
  if (!operation) return { status: "disabled", productionTouched: false };
  const api = github(env, fetcher);
  const branch = await api("/git/ref/heads/staging");
  const sha = branch.object?.sha;
  assert.match(sha ?? "", /^[a-f0-9]{40}$/);
  const ci = await api(`/actions/workflows/security-qa.yml/runs?branch=staging&head_sha=${sha}&event=push&per_page=100`);
  const latest = ci.workflow_runs.filter(run => run.head_sha === sha && run.head_branch === "staging" && run.event === "push"
    && run.head_repository?.full_name === repository).sort((a, b) => b.id - a.id)[0];
  assert.ok(latest?.status === "completed" && latest.conclusion === "success", "Current staging push CI must pass first.");
  const prior = await api("/actions/workflows/security-qa.yml/runs?branch=staging&event=workflow_dispatch&per_page=100");
  assert.ok(Array.isArray(prior.workflow_runs));
  if (prior.workflow_runs.some(run => run.status !== "completed")) {
    return { status: "deferred_pending_run", operation, manualReviewRequired: true, backupCompleted: false, productionTouched: false };
  }
  await api("/actions/workflows/security-qa.yml/dispatches", "POST", { ref: "staging", inputs: {
    staging_operation: operation, full_stack: false, synthetic_b2: false,
    staging_schedule_run_id: env.GITHUB_RUN_ID, staging_schedule_cron: event.schedule,
  } });
  return { status: "queued", operation, sourceSha: sha, parentRunId: env.GITHUB_RUN_ID,
    manualReviewRequired: true, backupCompleted: false, productionTouched: false };
}

// The protected child rechecks provenance before every credential-using step.
// Queuing is not a backup receipt; required staging-operations review stays intact.
export async function verifyScheduleOrigin(env, fetcher = fetch, now = Date.now()) {
  const id = env.OPS_SCHEDULE_RUN_ID ?? "";
  if (!id) { assert.ok(!env.OPS_SCHEDULE_CRON); return; }
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(env.GITHUB_REF, "refs/heads/staging");
  assert.match(id, /^[1-9]\d{0,19}$/);
  assert.notEqual(id, env.GITHUB_RUN_ID);
  assert.equal(scheduledOperation(env.OPS_SCHEDULE_CRON, env), env.OPS_OPERATION);
  const api = github(env, fetcher);
  const parent = await api(`/actions/runs/${id}`);
  assert.equal(String(parent.id), id);
  assert.equal(parent.event, "schedule"); assert.equal(parent.path, schedulerPath);
  assert.equal(parent.head_branch, "main"); assert.equal(parent.head_repository?.full_name, repository);
  assert.equal(parent.status, "completed"); assert.equal(parent.conclusion, "success");
  const created = Date.parse(parent.created_at);
  assert.ok(Number.isFinite(created) && created <= now + 300000 && now - created <= 26 * 3600000,
    "A stale scheduled request needs a fresh review/run.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 2);
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
    console.log(JSON.stringify(await dispatchSchedule(process.env, event)));
  } catch { console.error(JSON.stringify({ status: "failed", operation: "queue-staging-schedule", privateDetailsWithheld: true, productionTouched: false })); process.exitCode = 1; }
}
