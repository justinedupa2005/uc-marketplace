import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDeploymentEnvironment } from "../../src/lib/deployment-environment.ts";
import { isStrongRecoverySecret } from "../../src/lib/auth/recovery-secret.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
let phase = "configuration";
export const registry = JSON.parse(await readFile(path.join(root, "config/environments.json"), "utf8"));
export const applicationNames = ["APP_ENV", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_APP_URL", "AUTH_RECOVERY_SECRET", "EMAIL_CONFIRMATION_MODE"];

export function assertProject(project, mode) {
  const selected = registry[mode];
  if (!selected || !["staging", "production"].includes(mode) || !selected.vercelProjectId
    || project.id !== selected.vercelProjectId || project.accountId !== selected.vercelTeamId
    || project.ssoProtection?.deploymentType !== "all" || project.link) throw new Error("Registered protected project with no Git deployment connection required.");
}

export function validateVariables(variables, mode) {
  if (!variables || Object.keys(variables).sort().join() !== [...applicationNames].sort().join()
    || Object.values(variables).some((value) => typeof value !== "string") || variables.APP_ENV !== mode) throw new Error("Exact application-only configuration required.");
  validateDeploymentEnvironment({ ...variables, VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_ID: registry[mode]?.vercelProjectId });
}

export function validateProductionPreparation(variables) {
  const expected = applicationNames.filter((name) => name !== "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!variables || Object.keys(variables).sort().join() !== expected.sort().join() || registry.production.deploymentEnabled
    || variables.APP_ENV !== "production" || variables.NEXT_PUBLIC_APP_URL !== registry.production.appOrigin
    || variables.NEXT_PUBLIC_SUPABASE_URL !== `https://${registry.production.supabaseProjectRef}.supabase.co`
    || variables.EMAIL_CONFIRMATION_MODE !== "link" || !isStrongRecoverySecret(variables.AUTH_RECOVERY_SECRET)) throw new Error("Invalid blocked production preparation.");
}

function api(endpoint, method = "GET", body) {
  // CLI credentials remain in its existing credential store. No shell, token
  // arguments, environment dumps, persisted API responses or raw child output.
  const entry = path.join(process.env.APPDATA ?? "", "npm/node_modules/vercel/dist/index.js");
  const args = [entry, "api", endpoint, "--method", method, "--raw", "--non-interactive"];
  if (body) args.push("--input", "-");
  const result = spawnSync(process.execPath, args, { input: body ? JSON.stringify(body) : undefined,
    encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 4_000_000 });
  if (result.error || result.status !== 0) {
    const privateOutput = `${result.stdout ?? ""} ${result.stderr ?? ""}`.toLowerCase();
    const flags = Object.fromEntries(["nodeVersion", "installCommand", "buildCommand", "ssoProtection", "publicSource", "teamId", "framework", "invalid", "not allowed", "forbidden", "already exists", "unauthorized", "400", "403", "404"].map((word) => [word, privateOutput.includes(word.toLowerCase())]));
    console.log(JSON.stringify({ transport: "vercel-cli", exitCode: result.status, timedOut: result.error?.code === "ETIMEDOUT", method, flags }));
    throw new Error("Vercel request failed; private response withheld.");
  }
  return JSON.parse(result.stdout);
}

async function main() {
  const [command, mode] = process.argv.slice(2);
  if (process.argv.length !== 4 || !["staging", "production"].includes(mode)) throw new Error();
  const selected = registry[mode];
  const team = `teamId=${selected.vercelTeamId}`;
  if (command === "create" && mode === "production") {
    if (selected.vercelProjectId) throw new Error("Production project already registered; refusing recreation.");
    const projects = api(`/v9/projects?${team}&limit=100`);
    if (projects.pagination?.next || projects.projects.some((item) => item.name === selected.vercelProjectName)) throw new Error("Review project ownership/name availability before adoption.");
    const project = api(`/v11/projects?${team}`, "POST", { name: selected.vercelProjectName, framework: "nextjs", publicSource: false,
      ssoProtection: { deploymentType: "all" } });
    if (project.name !== selected.vercelProjectName || project.accountId !== selected.vercelTeamId || project.link || project.ssoProtection?.deploymentType !== "all") throw new Error();
    const domains = api(`/v9/projects/${project.id}/domains?${team}`).domains;
    console.log(JSON.stringify({ createdProjectId: project.id, name: project.name,
      requestedDomainReserved: domains.some((domain) => `https://${domain.name}` === selected.appOrigin), protected: true, gitConnected: false, deployed: false }));
    return;
  }
  if (!["inspect", "configure", "prepare"].includes(command) || !selected.vercelProjectId || (command === "prepare" && mode !== "production")) throw new Error();
  phase = "project identity";
  const project = api(`/v9/projects/${selected.vercelProjectId}?${team}`);
  assertProject(project, mode);
  const deployed = Boolean(project.latestDeployments?.length || Object.keys(project.targets ?? {}).length);
  if (command !== "inspect" && deployed) throw new Error("Existing deployments require a separately reviewed configuration change.");
  const endpoint = `/v10/projects/${project.id}/env`;
  phase = "environment inventory";
  const records = api(`${endpoint}?${team}&decrypt=true`).envs;
  if (!Array.isArray(records)) throw new Error();
  if (records.some((item) => !applicationNames.includes(item.key) || item.gitBranch || item.customEnvironmentIds?.length)) throw new Error("Review unexpected variables/overrides before configuration.");
  const targets = mode === "staging" ? ["production", "preview"] : ["production"];
  if (["configure", "prepare"].includes(command)) {
    let input = "";
    for await (const chunk of process.stdin) { input += chunk; if (input.length > 20_000) throw new Error(); }
    const variables = JSON.parse(input);
    phase = "configuration validation";
    if (command === "prepare") validateProductionPreparation(variables);
    else validateVariables(variables, mode);
    api(`/v9/projects/${project.id}?${team}`, "PATCH", { nodeVersion: "22.x", installCommand: "npm ci", buildCommand: "npm run build" });
    const secret = records.filter((item) => item.key === "AUTH_RECOVERY_SECRET");
    phase = "secret continuity";
    if (secret.length === 1 && !["sensitive", "secret"].includes(secret[0].type) && secret[0].value !== variables.AUTH_RECOVERY_SECRET) {
      // List responses can be encrypted even with decrypt=true. Retrieve only
      // this one Config value privately before changing its classification.
      const existing = api(`/v1/projects/${project.id}/env/${secret[0].id}?${team}`);
      if (existing.value === variables.AUTH_RECOVERY_SECRET) secret[0].value = existing.value;
    }
    if (secret.length > 1 || (secret[0] && !["sensitive", "secret"].includes(secret[0].type)
      && secret[0].value !== variables.AUTH_RECOVERY_SECRET)) throw new Error("Refusing implicit recovery-secret rotation.");
    phase = "provider writes";
    for (const key of applicationNames) {
      if (!(key in variables)) continue;
      // A write-only secret already saved is preserved, never regenerated or
      // overwritten by a repeat configuration run.
      if (key === "AUTH_RECOVERY_SECRET" && ["sensitive", "secret"].includes(secret[0]?.type)) continue;
      api(`${endpoint}?${team}&upsert=true`, "POST", { key, value: variables[key], target: targets,
        type: key === "AUTH_RECOVERY_SECRET" ? "sensitive" : "encrypted",
        visibility: key === "AUTH_RECOVERY_SECRET" ? "secret" : "config" });
    }
  }
  phase = "post-write inventory";
  const current = api(`${endpoint}?${team}&decrypt=true`).envs;
  const summary = applicationNames.map((key) => {
    const matches = current.filter((item) => item.key === key);
    const item = matches[0];
    return { name: key, configured: matches.length === 1, targetsMatch: matches.length === 1 && [...item.target].sort().join() === [...targets].sort().join(),
      ...(key === "AUTH_RECOVERY_SECRET" ? { writeOnly: ["sensitive", "secret"].includes(item?.type) || item?.visibility === "secret" } : {}) };
  });
  if (command === "configure" && summary.some((item) => !item.configured || !item.targetsMatch || item.writeOnly === false)) throw new Error();
  if (command === "prepare" && summary.filter((item) => item.name !== "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY").some((item) => !item.configured || !item.targetsMatch || item.writeOnly === false)) throw new Error();
  console.log(JSON.stringify({ mode, projectId: project.id, protected: true, gitConnected: false, deployed,
    productionDeploymentEnabled: registry.production.deploymentEnabled,
    productionConnectivityBlocked: mode === "production" && !summary.find((item) => item.name === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")?.configured,
    variables: summary }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch { console.log(`Deployment environment operation did not complete during ${phase}; private values/responses withheld. No deployment was requested.`); process.exitCode = 1; }
}
