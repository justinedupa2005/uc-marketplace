import { execFileSync } from "node:child_process";

try {
  const { GITHUB_REPOSITORY: repository, GITHUB_SHA: sha, GITHUB_REF: ref, GH_TOKEN: token } = process.env;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") || !/^[a-f0-9]{40}$/.test(sha ?? "")
      || ref !== "refs/heads/staging" || !token) throw new Error();
  const actual = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (actual !== sha) throw new Error();
  async function get(suffix) {
    const result = await fetch(`https://api.github.com/repos/${repository}${suffix}`, {
      redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!result.ok) throw new Error();
    return result.json();
  }
  const branch = await get("/git/ref/heads/staging");
  if (branch.object.sha !== sha) throw new Error();
  const runs = await get(`/actions/workflows/security-qa.yml/runs?head_sha=${sha}&branch=staging&event=push&per_page=100`);
  const latest = runs.workflow_runs.filter((run) => run.head_sha === sha && run.head_repository?.full_name === repository
    && run.head_branch === "staging" && run.event === "push").sort((a, b) => b.id - a.id)[0];
  if (!latest || latest.status !== "completed" || latest.conclusion !== "success") throw new Error();
  const jobs = await get(`/actions/runs/${latest.id}/jobs?filter=latest&per_page=100`);
  if (!jobs.jobs.some((job) => job.name === "local-security" && job.status === "completed" && job.conclusion === "success")) throw new Error();
  console.log(`Approved staging source ${sha} matches the branch head and successful push CI run ${latest.id}.`);
} catch {
  console.error("Staging gate refused: use the current staging branch head with completed successful exact-commit push CI. Private API details withheld.");
  process.exitCode = 1;
}
