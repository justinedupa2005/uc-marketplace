import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReleaseEvidence, RELEASE_REPOSITORY, RELEASE_WORKFLOW } from "../scripts/qa/lib/release-evidence.mjs";

const sha = "1".repeat(40);
function fixture() {
  const run = { id: 2, run_attempt: 1, head_sha: sha, path: RELEASE_WORKFLOW, event: "workflow_dispatch", status: "completed", conclusion: "success",
    repository: { full_name: RELEASE_REPOSITORY }, head_repository: { full_name: RELEASE_REPOSITORY } };
  const job = (name) => ({ name, head_sha: sha, status: "completed", conclusion: "success" });
  return { sha, localHead: sha, remoteHead: sha, clean: true, runs: [run], jobsByRun: { 2: [job("local-security"), job("isolated-full-stack")] },
    checks: [{ ...job("local-security"), app: { id: 15368 } }],
    protection: { enforce_admins: { enabled: true }, required_pull_request_reviews: {}, allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false }, required_status_checks: { strict: true, checks: [{ context: "local-security", app_id: 15368 }] } } };
}

test("release evidence requires exact clean local/main SHA, required CI, manual full-stack and enforced protection", () => {
  const result = evaluateReleaseEvidence(fixture());
  assert.equal(result.status, "passed");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.releaseReady, false, "Step 2 is not deployed acceptance or launch authorization.");
});

test("local modifications and mismatched deployed commits cannot inherit earlier CI success", () => {
  for (const patch of [{ clean: false }, { localHead: "2".repeat(40) }, { remoteHead: "2".repeat(40) }, { runs: [] }]) {
    assert.equal(evaluateReleaseEvidence({ ...fixture(), ...patch }).status, "blocked");
  }
});

test("failed, skipped, cancelled, neutral or running required jobs never count as green", () => {
  for (const conclusion of ["failure", "skipped", "cancelled", "neutral", "timed_out", null]) {
    const f = fixture(); f.jobsByRun[2][0].conclusion = conclusion;
    assert.equal(evaluateReleaseEvidence(f).status, "blocked");
    const check = fixture(); check.checks[0].conclusion = conclusion;
    assert.equal(evaluateReleaseEvidence(check).status, "blocked");
  }
  const f = fixture(); f.jobsByRun[2][0].status = "in_progress";
  assert.equal(evaluateReleaseEvidence(f).status, "blocked");
});

test("the latest failed/running attempt cannot be replaced with an earlier successful run", () => {
  for (const patch of [{ status: "in_progress", conclusion: null }, { status: "completed", conclusion: "failure" }]) {
    const f = fixture();
    f.runs.push({ ...f.runs[0], ...patch, id: 3 });
    f.jobsByRun[3] = structuredClone(f.jobsByRun[2]);
    assert.equal(evaluateReleaseEvidence(f).status, "blocked");
  }
});

test("a skipped optional push full-stack job is not release full-stack evidence", () => {
  const f = fixture(); f.runs[0].event = "push"; f.jobsByRun[2][1].conclusion = "skipped";
  assert.ok(evaluateReleaseEvidence(f).blockers.includes("full_stack_ci_not_successful"));
});

test("fork results, another workflow, another SHA or a spoofed check app cannot certify this release", () => {
  for (const mutate of [
    (f) => { f.runs[0].head_repository.full_name = "outsider/fork"; },
    (f) => { f.runs[0].path = ".github/workflows/unreviewed.yml"; },
    (f) => { f.runs[0].head_sha = "2".repeat(40); },
    (f) => { f.jobsByRun[2][0].head_sha = "2".repeat(40); },
    (f) => { f.checks[0].app.id = 999; },
    (f) => { f.protection.enforce_admins.enabled = false; },
    (f) => { f.protection.required_status_checks.strict = false; },
    (f) => { f.protection.required_status_checks.checks = []; },
  ]) { const f = fixture(); mutate(f); assert.equal(evaluateReleaseEvidence(f).status, "blocked"); }
});

test("invalid release data fails without echoing arbitrary service content", () => {
  assert.throws(() => evaluateReleaseEvidence({ ...fixture(), sha: "private-content" }), (error) => {
    assert.equal(error.message, "Invalid release evidence."); return true;
  });
});
