import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registry, applicationNames, vercelApi } from "./vercel.mjs";
import { validateDeploymentEnvironment } from "../../src/lib/deployment-environment.ts";
import { auditStaging } from "../staging/audit.mjs";

export const repository = "justinedupa2005/uc-marketplace";
const root = fileURLToPath(new URL("../../", import.meta.url));
const staging = registry.staging;
const team = `teamId=${staging.vercelTeamId}`;
const projectPath = `/v9/projects/${staging.vercelProjectId}`;
const shaPattern = /^[a-f0-9]{40}$/;

export function assertStagingProject(project, { linked = false } = {}) {
  assert.equal(registry.production.deploymentEnabled, false, "Production must remain disabled.");
  assert.notEqual(staging.supabaseProjectRef, registry.production.supabaseProjectRef);
  assert.notEqual(staging.vercelProjectId, registry.production.vercelProjectId);
  assert.equal(project.id, staging.vercelProjectId);
  assert.equal(project.accountId, staging.vercelTeamId);
  assert.equal(project.name, "uc-online-shop-staging");
  assert.equal(project.ssoProtection?.deploymentType, "all");
  assert.equal(project.framework, "nextjs");
  assert.equal(project.nodeVersion, "22.x");
  assert.equal(project.installCommand, "npm ci");
  assert.equal(project.buildCommand, "npm run build");
  assert.ok(!project.rootDirectory && !project.outputDirectory, "Use the repository root and full Next.js adapter, not a static export.");
  if (project.link || linked) {
    assert.equal(project.link?.type, "github");
    assert.equal(`${project.link?.org}/${project.link?.repo}`, repository);
    assert.equal(project.link?.productionBranch, "staging");
    assert.equal(project.link?.deployHooks?.length ?? 0, 0);
    assert.equal(project.gitProviderOptions?.createDeployments, "disabled");
  }
}

export function assertVercelConfig(config) {
  assert.deepEqual(config, { $schema: "https://openapi.vercel.sh/vercel.json", framework: "nextjs",
    installCommand: "npm ci", buildCommand: "npm run build", git: { deploymentEnabled: false } });
}

export function assertExactCi(runs, jobs, sha) {
  assert.match(sha, shaPattern);
  const latest = runs.filter((run) => run.head_sha === sha && run.head_branch === "staging"
    && run.event === "push" && run.head_repository?.full_name === repository).sort((a, b) => b.id - a.id)[0];
  assert.ok(latest && latest.status === "completed" && latest.conclusion === "success", "Current staging push CI must pass.");
  assert.ok(jobs.some((job) => job.run_id === latest.id && job.name === "local-security"
    && job.status === "completed" && job.conclusion === "success"), "Required CI job must pass, not skip.");
  return latest.id;
}

export function assertEnvironment(records) {
  assert.equal(records.length, applicationNames.length);
  const values = {};
  for (const name of applicationNames) {
    const matches = records.filter((item) => item.key === name);
    assert.equal(matches.length, 1);
    const item = matches[0];
    assert.deepEqual([...item.target].sort(), ["preview", "production"]);
    assert.ok(!item.gitBranch && !item.customEnvironmentIds?.length);
    if (name === "AUTH_RECOVERY_SECRET") {
      assert.ok(["sensitive", "secret"].includes(item.type), "Preserve the existing write-only recovery Secret.");
    } else values[name] = item.value;
  }
  // The hosting API deliberately cannot return a write-only Secret. Validate all
  // readable configuration without retrieving, replacing or rotating that value.
  validateDeploymentEnvironment({ ...values, AUTH_RECOVERY_SECRET: randomBytes(32).toString("hex"),
    VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_ID: staging.vercelProjectId });
  assert.equal(values.APP_ENV, "staging");
  return { environment: "staging", writeOnlyRecoverySecret: true };
}

function hostingEnvironment(projectId) {
  const records = vercelApi(`/v10/projects/${projectId}/env?${team}&decrypt=true`).envs;
  assert.ok(Array.isArray(records) && records.length === applicationNames.length);
  for (const item of records) {
    assert.ok(applicationNames.includes(item.key));
    // Config list responses may remain encrypted even with decrypt=true. Read
    // each non-secret Config separately; NEVER request the recovery Secret.
    if (item.key !== "AUTH_RECOVERY_SECRET" && item.decrypted === false) {
      assert.match(item.id, /^[a-zA-Z0-9_]+$/);
      const readable = vercelApi(`/v1/projects/${projectId}/env/${item.id}?${team}`);
      assert.equal(readable.key, item.key);
      item.value = readable.value;
    }
  }
  assertEnvironment(records);
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 20_000 });
  assert.equal(result.status, 0);
  return result.stdout.trim();
}

function githubClient() {
  let token = process.env.GH_TOKEN;
  if (!token) {
    const credential = spawnSync("git", ["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8", windowsHide: true, timeout: 20_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" } });
    token = /^password=(.+)$/m.exec(credential.stdout ?? "")?.[1];
  }
  assert.ok(token);
  return async (suffix) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${suffix}`, {
      redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    assert.ok(response.ok);
    return response.json();
  };
}

async function sourceGate(sha, get) {
  assert.match(sha ?? "", shaPattern);
  assert.equal(git(["rev-parse", "HEAD"]), sha);
  assert.equal(git(["status", "--porcelain"]), "", "Commit reviewed source before deployment.");
  assert.equal((await get("/git/ref/heads/staging")).object.sha, sha);
  const protection = await get("/branches/staging/protection");
  assert.equal(protection.enforce_admins.enabled, true);
  assert.equal(protection.required_status_checks.strict, true);
  assert.ok(protection.required_status_checks.checks.some((check) => check.context === "local-security"));
  assert.ok(protection.required_pull_request_reviews);
  const runs = (await get(`/actions/workflows/security-qa.yml/runs?head_sha=${sha}&branch=staging&event=push&per_page=100`)).workflow_runs;
  const latest = runs.filter((run) => run.head_sha === sha && run.head_branch === "staging"
    && run.event === "push" && run.head_repository?.full_name === repository).sort((a, b) => b.id - a.id)[0];
  assert.ok(latest);
  const ciRun = assertExactCi(runs, (await get(`/actions/runs/${latest.id}/jobs?filter=latest&per_page=100`)).jobs, sha);
  const source = await get(`/contents/vercel.json?ref=${sha}`);
  assertVercelConfig(JSON.parse(Buffer.from(source.content, "base64").toString("utf8")));
  return ciRun;
}

export function deploymentPayload(sha, repoId) {
  assert.match(sha, shaPattern);
  assert.ok(Number.isSafeInteger(repoId) && repoId > 0);
  return { name: "uc-online-shop-staging", project: staging.vercelProjectId, target: "production",
    gitSource: { type: "github", repoId, ref: sha, sha },
    meta: { approvedStagingSha: sha, marketplaceEnvironment: "staging" } };
}

async function main() {
  const [command, identifier] = process.argv.slice(2);
  assert.ok(["inspect", "connect", "plan", "deploy", "status"].includes(command));
  assert.equal(process.argv.length, command === "inspect" ? 3 : 4);
  const project = vercelApi(`${projectPath}?${team}`);
  assertStagingProject(project);
  hostingEnvironment(project.id);
  if (command === "inspect") {
    console.log(JSON.stringify({ projectId: project.id, linked: Boolean(project.link), protected: true,
      stagingOnly: true, deploymentIds: (project.latestDeployments ?? []).map((item) => item.id), productionDeploymentEnabled: false }));
    return;
  }
  if (command === "status") {
    assert.match(identifier, /^dpl_[a-zA-Z0-9]+$/);
    const deployment = vercelApi(`/v13/deployments/${identifier}?${team}`);
    assert.equal(deployment.projectId, project.id);
    console.log(JSON.stringify({ id: deployment.id, state: deployment.readyState,
      sha: deployment.meta?.githubCommitSha, url: deployment.url,
      aliasAssigned: Boolean(deployment.aliasAssigned), errorCode: /^[a-zA-Z0-9_]{1,80}$/.test(deployment.errorCode ?? "") ? deployment.errorCode : null,
      productionDeploymentEnabled: false }));
    return;
  }
  const get = githubClient();
  const ciRun = await sourceGate(identifier, get);
  if (command === "connect") {
    if (!project.link) {
      // Disable provider-created deployments before linking ANY branch. This
      // protects older branches that do not yet contain vercel.json.
      vercelApi(`${projectPath}?${team}`, "PATCH", { gitProviderOptions: { createDeployments: "disabled" } });
      assert.equal(vercelApi(`${projectPath}?${team}`).gitProviderOptions?.createDeployments, "disabled");
      vercelApi(`${projectPath}/link?${team}`, "POST", { type: "github", repo: repository });
      vercelApi(`${projectPath}/branch?${team}`, "PATCH", { branch: "staging" });
    }
    assertStagingProject(vercelApi(`${projectPath}?${team}`), { linked: true });
    console.log(JSON.stringify({ linked: true, branch: "staging", automaticDeployments: false, deployed: false, productionDeploymentEnabled: false }));
    return;
  }
  assertStagingProject(project, { linked: true });
  const audit = await auditStaging();
  assert.equal(audit.pending, 0);
  if (command === "plan") {
    console.log(JSON.stringify({ sha: identifier, ciRun, database: audit, readyForStagingDeployment: true, productionDeploymentEnabled: false }));
    return;
  }
  assert.equal(process.env.STAGING_DEPLOY_CONFIRM, `${project.id}:${identifier}`);
  // Recheck immediately before the write. Only immutable remote source is sent;
  // local dotenv/operator files and privileged credentials are never uploaded.
  assert.equal((await get("/git/ref/heads/staging")).object.sha, identifier);
  assertStagingProject(vercelApi(`${projectPath}?${team}`), { linked: true });
  const repo = await get("");
  const payload = deploymentPayload(identifier, repo.id);
  const journal = path.join(root, ".qa", `staging-deployment-${identifier}.json`);
  await mkdir(path.dirname(journal), { recursive: true });
  await writeFile(journal, JSON.stringify({ sha: identifier, ciRun, attemptedAt: new Date().toISOString(), state: "request_pending" }), { flag: "wx" });
  // Never retry an ambiguous POST. Inspect Vercel and this journal first.
  const deployment = vercelApi(`/v13/deployments?${team}`, "POST", payload);
  assert.equal(deployment.projectId, project.id);
  const result = { id: deployment.id, sha: identifier, ciRun, state: deployment.readyState, url: deployment.url, productionDeploymentEnabled: false };
  await writeFile(journal, JSON.stringify(result));
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch {
    console.error("Staging deployment gate did not complete. Private credentials/provider responses withheld; no automatic retry or production fallback.");
    process.exitCode = 1;
  }
}
