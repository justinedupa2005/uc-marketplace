import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertDeploymentEnabled, validateDeploymentEnvironment, VERCEL_PUBLIC_VARIABLES } from "../src/lib/deployment-environment.ts";
import { isStrongRecoverySecret } from "../src/lib/auth/recovery-secret.mjs";
import { assertProject, registry, validateVariables, validateProductionPreparation } from "../scripts/deployment/vercel.mjs";
import { existingRecoverySecret, renderLocalEnvironment } from "../scripts/deployment/local.mjs";
import applicationRegistry from "../config/environments.json" with { type: "json" };

const application = (mode = "staging") => ({ APP_ENV: mode,
  NEXT_PUBLIC_SUPABASE_URL: `https://${registry[mode].supabaseProjectRef}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${randomBytes(24).toString("base64url")}`,
  NEXT_PUBLIC_APP_URL: registry[mode].appOrigin, AUTH_RECOVERY_SECRET: randomBytes(32).toString("hex"), EMAIL_CONFIRMATION_MODE: "link" });
const local = () => ({ ...application(), APP_ENV: "local", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_APP_URL: "http://localhost:3000" });

test("environment preflight checks production dotenv files, regardless of the caller's NODE_ENV", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ucmarketplace-env-check-"));
  const entry = fileURLToPath(new URL("../scripts/deployment/check.mjs", import.meta.url));
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:path|systemroot|windir|comspec|temp|tmp)$/i.test(name)));
  const values = local();
  const dotenv = (env) => Object.entries(env).map(([name, value]) => `${name}=${value}`).join("\n");
  const run = (nodeEnv) => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", entry], {
    cwd: directory, env: { ...inherited, ...(nodeEnv ? { NODE_ENV: nodeEnv } : {}) },
    encoding: "utf8", windowsHide: true, timeout: 15_000,
  });
  try {
    await writeFile(path.join(directory, ".env.development.local"), dotenv(values));
    await writeFile(path.join(directory, ".env.test.local"), dotenv(values));
    await writeFile(path.join(directory, ".env.production.local"), dotenv({ ...values, NEXT_PUBLIC_SUPABASE_URL: application("production").NEXT_PUBLIC_SUPABASE_URL }));
    for (const nodeEnv of [undefined, "development", "test", "production"]) {
      const result = run(nodeEnv);
      assert.ok(!result.error, "The environment check must finish, not fail to launch or time out.");
      assert.equal(result.status, 1, "Development/test dotenv must not conceal an invalid production-build target.");
      assert.match(result.stderr, /Local development must use loopback/);
      assert.ok(!`${result.stdout}${result.stderr}`.includes(values.AUTH_RECOVERY_SECRET), "Diagnostics must not expose the recovery key.");
    }
    await writeFile(path.join(directory, ".env.production.local"), dotenv(values));
    await writeFile(path.join(directory, ".env.development.local"), "APP_ENV=invalid\n");
    const result = run();
    assert.ok(!result.error, "The environment check must finish.");
    assert.equal(result.status, 0, "Valid production-build dotenv must not be replaced by development settings.");
    assert.match(result.stdout, /check passed \(local\)/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deployed configuration fails closed for every missing required variable", () => {
  const valid = { ...application(), VERCEL: "1" };
  assert.equal(validateDeploymentEnvironment(valid).mode, "staging");
  for (const name of ["APP_ENV", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_APP_URL", "AUTH_RECOVERY_SECRET", "EMAIL_CONFIRMATION_MODE"]) {
    assert.throws(() => validateDeploymentEnvironment({ ...valid, [name]: undefined }), name);
  }
});

test("local mode cannot disguise either hosted student database", () => {
  assert.equal(validateDeploymentEnvironment(local()).mode, "local");
  for (const mode of ["staging", "production"]) assert.throws(() => validateDeploymentEnvironment({ ...local(), NEXT_PUBLIC_SUPABASE_URL: application(mode).NEXT_PUBLIC_SUPABASE_URL }), /loopback/);
  assert.throws(() => validateDeploymentEnvironment({ NODE_ENV: "production" }));
});

test("hosted origins must be the registered HTTPS origins, not deceptive prefixes or placeholders", () => {
  const valid = application();
  for (const field of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_URL"]) {
    for (const value of [valid[field].replace("https:", "http:"), `${valid[field]}.evil.test`, `${valid[field]}/callback`, `${valid[field]}?redirect=elsewhere`, `${valid[field]}#elsewhere`, valid[field].replace("https://", "https://user@")]) {
      assert.throws(() => validateDeploymentEnvironment({ ...valid, [field]: value }));
    }
  }
  assert.throws(() => validateDeploymentEnvironment({ ...application("production"), NEXT_PUBLIC_APP_URL: "https://production.example.test" }));
});

test("recovery configuration and signer share bounded non-placeholder validation", () => {
  for (const size of [32, 48, 64]) assert.equal(isStrongRecoverySecret(randomBytes(size).toString("hex")), true);
  for (const secret of [undefined, "", "replace-me", "00".repeat(32), "a1".repeat(32), "0123456789abcdef".repeat(4), "a".repeat(65), randomBytes(65).toString("hex")]) {
    assert.equal(isStrongRecoverySecret(secret), false);
    assert.throws(() => validateDeploymentEnvironment({ ...application(), AUTH_RECOVERY_SECRET: secret }));
  }
});

test("operator credentials and public secret/alias variables are rejected without value disclosure", () => {
  const privateValue = `private-${randomBytes(24).toString("hex")}`;
  for (const name of ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ACCESS_TOKEN", "PRODUCTION_DATABASE_URL", "STAGING_MANAGEMENT_TOKEN", "QA_SUPABASE_SERVICE_ROLE_KEY", "SMTP_PASSWORD", "NEXT_PUBLIC_AUTH_RECOVERY_SECRET", "NEXT_PUBLIC_SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
    assert.throws(() => validateDeploymentEnvironment({ ...application(), [name]: privateValue }), (error) => !error.message.includes(privateValue));
  }
});

test("documented Vercel framework metadata is allowed without allowing credential aliases", () => {
  const values = application();
  const metadata = Object.fromEntries(VERCEL_PUBLIC_VARIABLES.map((name) => [name, name === "NEXT_PUBLIC_VERCEL_PROJECT_ID" ? registry.staging.vercelProjectId : "public-metadata"]));
  assert.equal(VERCEL_PUBLIC_VARIABLES.length, 21);
  assert.equal(validateDeploymentEnvironment({ ...values, ...metadata }).mode, "staging");
  assert.throws(() => validateDeploymentEnvironment({ ...values, NEXT_PUBLIC_VERCEL_PRIVATE_TOKEN: "private-test-config" }));
  assert.throws(() => validateDeploymentEnvironment({ ...values, NEXT_PUBLIC_VERCEL_GIT_COMMIT_MESSAGE: values.AUTH_RECOVERY_SECRET }));
});

test("the builder's complete prefixed system contract is accepted but public credential aliases and wrong project IDs are not", () => {
  // Match getPrefixedEnvVars()'s explicit non-secret system list, independently
  // of our allowlist. Its GIT_* family stays restricted to reviewed names.
  const system = Object.fromEntries(["URL", "ENV", "TARGET_ENV", "REGION", "BRANCH_URL", "PROJECT_PRODUCTION_URL", "DEPLOYMENT_ID", "PROJECT_ID"]
    .map((name) => [`NEXT_PUBLIC_VERCEL_${name}`, name === "PROJECT_ID" ? registry.staging.vercelProjectId : "public-system-metadata"]));
  assert.equal(validateDeploymentEnvironment({ ...application(), ...system, NEXT_PUBLIC_VERCEL_GIT_PREVIOUS_SHA: "a".repeat(40), VERCEL: "1", VERCEL_ENV: "production" }).mode, "staging");
  for (const key of ["NEXT_PUBLIC_VERCEL_OIDC_TOKEN", "NEXT_PUBLIC_VERCEL_AUTOMATION_BYPASS_SECRET", "NEXT_PUBLIC_VERCEL_GIT_PRIVATE_KEY"]) {
    assert.throws(() => validateDeploymentEnvironment({ ...application(), [key]: "inert-unreviewed-value" }));
  }
  assert.throws(() => validateDeploymentEnvironment({ ...application(), NEXT_PUBLIC_VERCEL_PROJECT_ID: registry.production.vercelProjectId }), /Vercel project does not match/);
  assert.throws(() => validateDeploymentEnvironment({ ...application(), VERCEL_PROJECT_ID: registry.staging.vercelProjectId, NEXT_PUBLIC_VERCEL_PROJECT_ID: "another-project" }), /Vercel project does not match/);
  assert.throws(() => validateDeploymentEnvironment({ ...application(), NEXT_PUBLIC_UNKNOWN_A: "value-a", NEXT_PUBLIC_UNKNOWN_B: "value-b" }),
    (error) => error.message.includes("NEXT_PUBLIC_UNKNOWN_A") && error.message.includes("NEXT_PUBLIC_UNKNOWN_B") && !error.message.includes("value-a") && !error.message.includes("value-b"));
});

test("Vercel-injected public observability routing does not block a real hosted build or allow private aliases", () => {
  const values = application();
  const name = "NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG";
  const publicRouting = JSON.stringify({ analytics: { scriptSrc: "/_vercel/insights/script.js", viewEndpoint: "/_vercel/insights/view" } });
  assert.equal(validateDeploymentEnvironment({ ...values, VERCEL: "1", VERCEL_ENV: "production", [name]: publicRouting }).mode, "staging");
  for (const value of [values.AUTH_RECOVERY_SECRET, `sb_secret_${randomBytes(24).toString("hex")}`]) {
    assert.throws(() => validateDeploymentEnvironment({ ...values, [name]: value }), (error) => !error.message.includes(value));
  }
  const unknownName = "NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_SECRET";
  assert.throws(() => validateDeploymentEnvironment({ ...values, [unknownName]: "inert-negative-test-value" }),
    (error) => error.message.includes(unknownName) && !error.message.includes("inert-negative-test-value"));
});

test("hosted keys reject placeholders and privileged legacy roles", () => {
  for (const key of ["sb_publishable_test", "sb_publishable_ucmarketplace_anonymous_ci", `sb_secret_${"x".repeat(32)}`]) {
    assert.throws(() => validateDeploymentEnvironment({ ...application(), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }));
  }
  const jwt = (role, ref) => `header.${Buffer.from(JSON.stringify({ role, ref })).toString("base64url")}.signature`;
  for (const [role, ref] of [["service_role", registry.staging.supabaseProjectRef], ["anon", registry.production.supabaseProjectRef]]) {
    assert.throws(() => validateDeploymentEnvironment({ ...application(), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt(role, ref) }));
  }
});

test("duplicate environment database references cannot pass validation", () => {
  const original = applicationRegistry.production.supabaseProjectRef;
  try {
    applicationRegistry.production.supabaseProjectRef = applicationRegistry.staging.supabaseProjectRef;
    assert.throws(() => validateDeploymentEnvironment(application()), /distinct/);
  } finally { applicationRegistry.production.supabaseProjectRef = original; }
});

test("wrong Vercel project bindings and preview production are rejected", () => {
  assert.throws(() => validateDeploymentEnvironment({ ...application(), VERCEL_PROJECT_ID: "another-project" }));
  assert.throws(() => validateDeploymentEnvironment({ ...application("production"), VERCEL_ENV: "preview" }), /Preview/);
  assert.throws(() => validateDeploymentEnvironment({ ...application(), EMAIL_CONFIRMATION_MODE: "typo" }));
});

test("hosted production settings cannot enter Development or unspecified Vercel targets", () => {
  const values = { ...application("production"), VERCEL: "1", VERCEL_PROJECT_ID: registry.production.vercelProjectId };
  for (const target of [undefined, "development", "unexpected"]) {
    assert.throws(() => validateDeploymentEnvironment({ ...values, VERCEL_ENV: target }), /Hosted production configuration/);
  }
  assert.equal(validateDeploymentEnvironment({ ...values, VERCEL_ENV: "production" }).mode, "production");
});

test("production configuration may be prepared but deployment stays explicitly disabled", () => {
  assert.equal(validateDeploymentEnvironment(application("production")).mode, "production");
  assert.equal(registry.production.deploymentEnabled, false);
  assert.throws(() => assertDeploymentEnabled("production"), /disabled/);
  assert.doesNotThrow(() => assertDeploymentEnabled("staging"));
});

test("real Next configuration blocks a fully specified production build before deployment", { timeout: 60_000 }, () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "typegen"], {
    cwd: root, env: { ...process.env, ...application("production"), VERCEL: "1", VERCEL_ENV: "production",
      VERCEL_PROJECT_ID: registry.production.vercelProjectId, NEXT_TELEMETRY_DISABLED: "1" },
    encoding: "utf8", windowsHide: true, timeout: 45_000,
  });
  assert.ok(!result.error, "The configuration check must finish, not time out.");
  assert.notEqual(result.status, 0);
  assert.ok(`${result.stdout}${result.stderr}`.includes("Production deployment is disabled"), "The release block must be enforced by actual Next configuration.");
});

test("actual Next configuration loads in hosted staging with the complete builder-prefixed public system metadata", { timeout: 60_000 }, () => {
  const values = application();
  const metadata = {
    NEXT_PUBLIC_VERCEL_PROJECT_ID: registry.staging.vercelProjectId,
    NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID: "dpl_inertRegressionFixture",
    NEXT_PUBLIC_VERCEL_REGION: "iad1", NEXT_PUBLIC_VERCEL_URL: "inert-build.vercel.app",
    NEXT_PUBLIC_VERCEL_ENV: "production", NEXT_PUBLIC_VERCEL_TARGET_ENV: "production",
    NEXT_PUBLIC_VERCEL_BRANCH_URL: "inert-staging-branch.vercel.app",
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: "uc-online-shop-staging.vercel.app",
    NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG: JSON.stringify({ analytics: { scriptSrc: "/_vercel/insights/script.js" } }),
  };
  const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "typegen"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), env: { ...process.env, ...values, ...metadata,
      VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_ID: registry.staging.vercelProjectId, NEXT_TELEMETRY_DISABLED: "1" },
    encoding: "utf8", windowsHide: true, timeout: 45_000,
  });
  assert.ok(!result.error, "The actual hosted configuration must load within the bounded test.");
  assert.equal(result.status, 0, "Provider public metadata must not block Next configuration; private output withheld.");
});

test("build and runtime both invoke the same validation and release block", async () => {
  for (const filename of ["next.config.ts", "src/instrumentation.ts"]) {
    const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
    assert.ok(source.includes("validateDeploymentEnvironment(process.env)"));
    assert.ok(source.includes("assertDeploymentEnabled("));
  }
});

test("inactive production preparation leaves the missing public key unset rather than fabricating one", () => {
  const prepared = application("production");
  delete prepared.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert.doesNotThrow(() => validateProductionPreparation(prepared));
  assert.throws(() => validateDeploymentEnvironment(prepared));
  assert.throws(() => validateProductionPreparation({ ...prepared, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "placeholder" }));
  assert.throws(() => validateProductionPreparation({ ...prepared, NEXT_PUBLIC_SUPABASE_URL: application().NEXT_PUBLIC_SUPABASE_URL }));
});

test("hosting tooling requires the exact protected project without a Git deployment connection", () => {
  const project = { id: registry.staging.vercelProjectId, accountId: registry.staging.vercelTeamId, ssoProtection: { deploymentType: "all" } };
  assert.doesNotThrow(() => assertProject(project, "staging"));
  for (const patch of [{ id: "another-project" }, { accountId: "another-team" }, { ssoProtection: null }, { link: {} }]) assert.throws(() => assertProject({ ...project, ...patch }, "staging"));
  assert.doesNotThrow(() => validateVariables(application(), "staging"));
  assert.throws(() => validateVariables({ ...application(), SUPABASE_SECRET_KEY: "private-test-config" }, "staging"));
});

test("local configuration rewriting is scoped, preserves unrelated settings and keeps secrets stable", () => {
  const values = local();
  for (const quote of ["", "'", '"']) {
    const source = `# Keep comment\nUNRELATED=value\nAUTH_RECOVERY_SECRET=${quote}${values.AUTH_RECOVERY_SECRET}${quote}\nNEXT_PUBLIC_APP_URL=http://localhost:4000\n`;
    const rendered = renderLocalEnvironment(source, values);
    assert.equal(renderLocalEnvironment(rendered, values), rendered);
    assert.ok(rendered.includes("UNRELATED=value"));
    assert.equal(rendered.match(/^AUTH_RECOVERY_SECRET=/gm).length, 1);
    assert.equal(existingRecoverySecret(source), values.AUTH_RECOVERY_SECRET);
    assert.equal(existingRecoverySecret(rendered), values.AUTH_RECOVERY_SECRET);
  }
  assert.equal(existingRecoverySecret("# New configuration"), null);
  assert.equal(existingRecoverySecret(`AUTH_RECOVERY_SECRET: ${values.AUTH_RECOVERY_SECRET}`), values.AUTH_RECOVERY_SECRET);
  assert.throws(() => renderLocalEnvironment("", application()));
  assert.throws(() => existingRecoverySecret("AUTH_RECOVERY_SECRET=replace-me"));
  assert.throws(() => existingRecoverySecret(`AUTH_RECOVERY_SECRET=${values.AUTH_RECOVERY_SECRET}\nAUTH_RECOVERY_SECRET=${values.AUTH_RECOVERY_SECRET}`));
});
