import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertEnvironment, assertExactCi, assertStagingProject, assertVercelConfig, deploymentPayload, repository } from "../scripts/deployment/staging.mjs";
import { registry } from "../scripts/deployment/vercel.mjs";
import { protectedRequestHeaders, validateSmokeInput } from "../scripts/deployment/staging-smoke.mjs";

const sha = "a".repeat(40);
const project = () => ({ id: registry.staging.vercelProjectId, accountId: registry.staging.vercelTeamId,
  name: "uc-online-shop-staging", framework: "nextjs", nodeVersion: "22.x", installCommand: "npm ci", buildCommand: "npm run build",
  ssoProtection: { deploymentType: "all" }, gitProviderOptions: { createDeployments: "disabled" },
  link: { type: "github", org: "justinedupa2005", repo: "uc-marketplace", productionBranch: "staging", deployHooks: [] } });
const run = (patch = {}) => ({ id: 123, head_sha: sha, head_branch: "staging", event: "push",
  head_repository: { full_name: repository }, status: "completed", conclusion: "success", ...patch });
const job = (patch = {}) => ({ run_id: 123, name: "local-security", status: "completed", conclusion: "success", ...patch });
const records = () => Object.entries({ APP_ENV: "staging", NEXT_PUBLIC_SUPABASE_URL: `https://${registry.staging.supabaseProjectRef}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${randomBytes(24).toString("base64url")}`,
  NEXT_PUBLIC_APP_URL: registry.staging.appOrigin, AUTH_RECOVERY_SECRET: undefined, EMAIL_CONFIRMATION_MODE: "code" })
  .map(([key, value]) => ({ key, value, target: ["production", "preview"], type: key === "AUTH_RECOVERY_SECRET" ? "sensitive" : "encrypted" }));

test("hosting accepts only the protected staging project and exact repository/branch", () => {
  assert.doesNotThrow(() => assertStagingProject(project(), { linked: true }));
  for (const patch of [{ id: registry.production.vercelProjectId }, { accountId: "other-team" }, { name: "uc-online-shop" },
    { ssoProtection: { deploymentType: "preview" } }, { framework: "other" }, { rootDirectory: "other" }, { outputDirectory: "out" },
    { nodeVersion: "20.x" }, { buildCommand: "npm run export" }, { installCommand: "npm install" },
    { link: { ...project().link, productionBranch: "main" } }, { link: { ...project().link, org: "other" } },
    { link: { ...project().link, deployHooks: [{}] } }, { gitProviderOptions: { createDeployments: "enabled" } }]) {
    assert.throws(() => assertStagingProject({ ...project(), ...patch }, { linked: true }));
  }
  assert.throws(() => assertStagingProject({ ...project(), link: null }, { linked: true }));
  assert.doesNotThrow(() => assertStagingProject({ ...project(), link: null }));
});

test("exact-commit CI rejects older successes, skips, unfinished runs and unrelated jobs", () => {
  assert.equal(assertExactCi([run()], [job()], sha), 123);
  for (const patch of [{ head_sha: "b".repeat(40) }, { head_branch: "main" }, { event: "pull_request" },
    { head_repository: { full_name: "other/repo" } }, { status: "in_progress" }, { conclusion: "cancelled" }, { conclusion: "skipped" }]) {
    assert.throws(() => assertExactCi([run(patch)], [job()], sha));
  }
  assert.throws(() => assertExactCi([run(), run({ id: 124, conclusion: "failure" })], [job()], sha));
  for (const patch of [{ run_id: 1 }, { name: "other" }, { status: "queued" }, { conclusion: "skipped" }, { conclusion: "failure" }]) {
    assert.throws(() => assertExactCi([run()], [job(patch)], sha));
  }
});

test("hosting environment rejects production, operator keys, overrides and readable recovery secrets", () => {
  assert.deepEqual(assertEnvironment(records()), { environment: "staging", writeOnlyRecoverySecret: true });
  for (const [name, value] of [["APP_ENV", "production"], ["NEXT_PUBLIC_SUPABASE_URL", `https://${registry.production.supabaseProjectRef}.supabase.co`],
    ["NEXT_PUBLIC_APP_URL", registry.production.appOrigin], ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_secret_private"]]) {
    assert.throws(() => assertEnvironment(records().map((item) => item.key === name ? { ...item, value } : item)));
  }
  for (const patch of [{ target: ["production"] }, { gitBranch: "feature/test" }, { customEnvironmentIds: ["custom"] }]) {
    assert.throws(() => assertEnvironment(records().map((item, index) => index ? item : { ...item, ...patch })));
  }
  assert.throws(() => assertEnvironment(records().filter((item) => item.key !== "AUTH_RECOVERY_SECRET")));
  assert.throws(() => assertEnvironment(records().map((item) => item.key === "AUTH_RECOVERY_SECRET" ? { ...item, type: "encrypted" } : item)));
  assert.throws(() => assertEnvironment([...records(), { key: "SUPABASE_SERVICE_ROLE_KEY" }]));
});

test("Vercel config preserves full Next.js server builds and disables automatic Git deploys", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.doesNotThrow(() => assertVercelConfig(config));
  for (const patch of [{ git: { deploymentEnabled: true } }, { outputDirectory: "out" }, { framework: null }, { installCommand: "npm install" }]) {
    assert.throws(() => assertVercelConfig({ ...config, ...patch }));
  }
});

test("deployment payload pins immutable source and only the isolated staging hosting project", () => {
  const payload = deploymentPayload(sha, 12345);
  assert.equal(payload.project, registry.staging.vercelProjectId);
  assert.notEqual(payload.project, registry.production.vercelProjectId);
  assert.equal(payload.gitSource.ref, sha);
  assert.equal(payload.gitSource.sha, sha);
  assert.equal(payload.meta.marketplaceEnvironment, "staging");
  assert.equal(payload.target, "production", "This is the dedicated STAGING project's canonical Vercel target.");
  for (const invalid of ["staging", "main", "HEAD", "a".repeat(39)]) assert.throws(() => deploymentPayload(invalid, 12345));
  for (const invalid of [undefined, -1, 0, "12345"]) assert.throws(() => deploymentPayload(sha, invalid));
  assert.ok(!("env" in payload) && !("files" in payload) && !("gitAccessToken" in payload));
});

test("hosted smoke accepts only owned synthetic accounts and a staging public API key", () => {
  const valid = { accounts: Object.fromEntries(["admin", "pending", "seller", "buyer", "suspended"].map((role) => [role, randomBytes(24).toString("hex")])),
    bypassSecret: randomBytes(24).toString("hex"), publishableKey: `sb_publishable_${randomBytes(24).toString("base64url")}`, sha, deploymentId: "dpl_fixture" };
  assert.doesNotThrow(() => validateSmokeInput(valid));
  for (const patch of [{ origin: registry.production.appOrigin }, { sha: "staging" }, { deploymentId: "untrusted" },
    { accounts: { ...valid.accounts, other: "unexpected" } }, { publishableKey: "sb_secret_private" }, { bypassSecret: "" }]) {
    assert.throws(() => validateSmokeInput({ ...valid, ...patch }));
  }
});

test("hosting bypass credentials are attached only to the exact staging origin", () => {
  const secret = randomBytes(24).toString("hex");
  assert.equal(protectedRequestHeaders(`${registry.staging.appOrigin}/login`, {}, secret)["x-vercel-protection-bypass"], secret);
  for (const target of [registry.production.appOrigin, `https://${registry.staging.supabaseProjectRef}.supabase.co`,
    `${registry.staging.appOrigin}.evil.test`, "http://uc-online-shop-staging.vercel.app", "https://vercel.com"]) {
    assert.equal(protectedRequestHeaders(target, { "x-vercel-protection-bypass": secret }, secret)["x-vercel-protection-bypass"], undefined);
  }
});
