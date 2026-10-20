import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateReleaseEvidence, RELEASE_REPOSITORY } from "./lib/release-evidence.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const git = (args, extra = {}) => execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 20_000,
  maxBuffer: 2_000_000, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], ...extra });

try {
  const args = process.argv.slice(2);
  const useCredential = args.includes("--git-credential");
  const values = args.filter((argument) => argument !== "--git-credential");
  if (values.length && !(values.length === 2 && values[0] === "--sha" && /^[0-9a-f]{40}$/.test(values[1]))) throw new Error();
  const localHead = git(["rev-parse", "HEAD"]).trim();
  const sha = values[1] ?? localHead;
  const clean = !git(["status", "--porcelain=v1", "--untracked-files=all"]).trim();
  // Never send credentials to a remote or API URL supplied by the caller.
  if (git(["remote", "get-url", "origin"]).trim() !== `https://github.com/${RELEASE_REPOSITORY}.git`) throw new Error();
  let token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token && useCredential) {
    const credential = git(["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" } });
    token = /^password=(.+)$/m.exec(credential)?.[1];
    if (!token) throw new Error();
  }
  const base = `https://api.github.com/repos/${RELEASE_REPOSITORY}`;
  async function get(endpoint) {
    const response = await fetch(base + endpoint, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error();
    return response.json();
  }
  async function list(endpoint, key) {
    const rows = [];
    for (let page = 1; page <= 10; page += 1) {
      const result = await get(`${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      const entries = result[key];
      if (!Array.isArray(entries)) throw new Error();
      rows.push(...entries);
      if (entries.length < 100) return rows;
    }
    throw new Error(); // Truncated inspection cannot certify a release.
  }
  const remote = await get("/commits/main");
  const runs = await list(`/actions/workflows/security-qa.yml/runs?head_sha=${sha}`, "workflow_runs");
  const jobsByRun = {};
  // Inspect the current attempt of every exact-commit run, never stale attempts.
  for (const run of runs) {
    if (!Number.isSafeInteger(run.id) || run.id < 1) throw new Error();
    jobsByRun[run.id] = await list(`/actions/runs/${run.id}/jobs?filter=latest`, "jobs");
  }
  const checks = await list(`/commits/${sha}/check-runs?filter=latest`, "check_runs");
  const protection = await get("/branches/main/protection");
  const result = evaluateReleaseEvidence({ sha, localHead, remoteHead: remote.sha, clean, runs, jobsByRun, checks, protection });
  console.log(`RELEASE_EVIDENCE_JSON:${JSON.stringify(result)}`);
  if (result.status !== "passed") process.exitCode = 1;
} catch {
  console.error("Release verification could not complete. Use the exact SHA, authorized GitHub read access and a clean checkout; private Git/API diagnostics were withheld.");
  process.exitCode = 1;
}
