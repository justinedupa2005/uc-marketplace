export const RELEASE_REPOSITORY = "justinedupa2005/uc-marketplace";
export const RELEASE_WORKFLOW = ".github/workflows/security-qa.yml";
const shaPattern = /^[0-9a-f]{40}$/;

export function evaluateReleaseEvidence({ sha, localHead, remoteHead, clean, runs, jobsByRun, checks, protection }) {
  if (!shaPattern.test(sha) || !shaPattern.test(localHead) || !shaPattern.test(remoteHead)
    || typeof clean !== "boolean" || !Array.isArray(runs) || !Array.isArray(checks)) throw new Error("Invalid release evidence.");
  const blockers = new Set();
  if (!clean) blockers.add("uncommitted_changes");
  if (localHead !== sha) blockers.add("local_commit_mismatch");
  if (remoteHead !== sha) blockers.add("main_commit_mismatch");
  const relevant = runs.filter((run) => run.head_sha === sha && run.path === RELEASE_WORKFLOW
    && run.repository?.full_name === RELEASE_REPOSITORY && run.head_repository?.full_name === RELEASE_REPOSITORY);
  const latest = (values) => [...values].sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
  const current = latest(relevant);
  const manual = latest(relevant.filter((run) => run.event === "workflow_dispatch"));
  function passed(run, name) {
    const jobs = jobsByRun?.[run?.id];
    const found = Array.isArray(jobs) ? jobs.filter((job) => job.name === name) : [];
    return run?.status === "completed" && run.conclusion === "success" && found.length === 1
      && found[0].head_sha === sha && found[0].status === "completed" && found[0].conclusion === "success";
  }
  if (!passed(current, "local-security")) blockers.add("latest_ci_not_successful");
  if (!passed(manual, "local-security") || !passed(manual, "isolated-full-stack")) blockers.add("full_stack_ci_not_successful");
  const required = protection?.required_status_checks?.checks;
  if (!protection?.enforce_admins?.enabled || !protection?.required_status_checks?.strict
    || !protection?.required_pull_request_reviews || protection?.allow_force_pushes?.enabled !== false
    || protection?.allow_deletions?.enabled !== false || !Array.isArray(required)
    || !required.some((check) => check.context === "local-security" && check.app_id === 15368)) blockers.add("branch_protection_unverified");
  for (const check of required ?? []) {
    const found = checks.filter((candidate) => candidate.name === check.context
      && candidate.app?.id === check.app_id && candidate.head_sha === sha);
    if (found.length !== 1 || found[0].status !== "completed" || found[0].conclusion !== "success") blockers.add("required_check_not_successful");
  }
  return { version: 1, status: blockers.size ? "blocked" : "passed", repository: RELEASE_REPOSITORY,
    candidateSha: sha, localHead, remoteHead, workingTreeClean: clean,
    latestRunId: Number.isSafeInteger(current?.id) ? current.id : null,
    fullStackRunId: Number.isSafeInteger(manual?.id) ? manual.id : null,
    blockers: [...blockers].sort(), releaseReady: false };
}
