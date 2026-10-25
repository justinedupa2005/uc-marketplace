import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { validateDeploymentEnvironment } from "../src/lib/deployment-environment.ts";
import robots from "../src/app/robots.ts";
import { createManagementApi, fixtureStoragePaths, loadMigrations, migrationQuery, planMigrations, registry, staging, validateFixtureCredentials, validateStagingTarget, verifyStagingProject } from "../scripts/staging/lib.mjs";

const operator = { STAGING_PROJECT_REF: staging.supabaseProjectRef, STAGING_ALLOW_MUTATIONS: "1", STAGING_MANAGEMENT_TOKEN: "private-test-token" };
const application = { APP_ENV: "staging", NEXT_PUBLIC_SUPABASE_URL: `https://${staging.supabaseProjectRef}.supabase.co`,
  NEXT_PUBLIC_APP_URL: staging.appOrigin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${randomBytes(24).toString("base64url")}`, AUTH_RECOVERY_SECRET: randomBytes(32).toString("hex"), EMAIL_CONFIRMATION_MODE: "code" };

test("staging build and startup refuse production, deceptive and incomplete targets", () => {
  assert.equal(validateDeploymentEnvironment(application).mode, "staging");
  for (const url of [`https://${registry.production.supabaseProjectRef}.supabase.co`, `${application.NEXT_PUBLIC_SUPABASE_URL}.evil.test`,
    `${application.NEXT_PUBLIC_SUPABASE_URL}/path`, `${application.NEXT_PUBLIC_SUPABASE_URL}?redirect=production`, "http://localhost:54321"]) {
    assert.throws(() => validateDeploymentEnvironment({ ...application, NEXT_PUBLIC_SUPABASE_URL: url }));
  }
  for (const update of [{ NEXT_PUBLIC_APP_URL: "https://production.example.test" }, { NEXT_PUBLIC_APP_URL: `${staging.appOrigin}/path` },
    { AUTH_RECOVERY_SECRET: "" }, { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_test" }, { STAGING_DATABASE_URL: "private-database-config" }]) {
    assert.throws(() => validateDeploymentEnvironment({ ...application, ...update }));
  }
});
test("hosted deployment mode must be explicit and preview cannot become production", () => {
  assert.throws(() => validateDeploymentEnvironment({ VERCEL: "1" }), /APP_ENV/);
  assert.throws(() => validateDeploymentEnvironment({ VERCEL: "1", APP_ENV: "local" }), /Hosted/);
  assert.throws(() => validateDeploymentEnvironment({ ...application, VERCEL_ENV: "preview", APP_ENV: "production" }), /Preview/);
  assert.equal(validateDeploymentEnvironment({}).mode, "local");
  assert.equal(validateDeploymentEnvironment(application).noIndex, true);
});
test("staging crawlers are blocked without changing public production homepage indexing", () => {
  const previous = process.env.APP_ENV;
  try {
    process.env.APP_ENV = "staging";
    assert.equal(robots().rules.disallow, "/");
    process.env.APP_ENV = "production";
    assert.ok(robots().rules.disallow.includes("/admin"));
    assert.ok(!robots().rules.disallow.includes("/"));
    assert.equal(validateDeploymentEnvironment({ ...application, APP_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: `https://${registry.production.supabaseProjectRef}.supabase.co`,
      NEXT_PUBLIC_APP_URL: registry.production.appOrigin }).noIndex, false);
  } finally {
    if (previous === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previous;
  }
});
test("legacy public credentials must belong to the selected project and never have privileged roles", () => {
  const jwt = (role, ref) => `header.${Buffer.from(JSON.stringify({ role, ref })).toString("base64url")}.signature`;
  for (const [role, ref] of [["service_role", staging.supabaseProjectRef], ["anon", registry.production.supabaseProjectRef]]) {
    const key = jwt(role, ref);
    assert.throws(() => validateDeploymentEnvironment({ ...application, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }), (error) => !error.message.includes(key));
  }
  assert.equal(validateDeploymentEnvironment({ ...application, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("anon", staging.supabaseProjectRef) }).mode, "staging");
});
test("staging operator fails closed before network access without exact isolated confirmation", () => {
  for (const update of [{ STAGING_ALLOW_MUTATIONS: "0" }, { STAGING_PROJECT_REF: registry.production.supabaseProjectRef },
    { STAGING_PROJECT_REF: "" }, { STAGING_MANAGEMENT_TOKEN: "" }]) assert.throws(() => validateStagingTarget({ ...operator, ...update }));
  assert.equal(validateStagingTarget(operator), staging.supabaseProjectRef);
});
test("staging API pins HTTPS target, rejects redirects, bounds time and withholds service bodies", async () => {
  let count = 0;
  const api = createManagementApi(operator, async (url, options) => {
    count++;
    assert.equal(url, `https://api.supabase.com/v1/projects/${staging.supabaseProjectRef}`);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ id: staging.supabaseProjectRef, name: staging.supabaseProjectName, status: "ACTIVE_HEALTHY" }) };
  });
  await verifyStagingProject(api);
  await assert.rejects(api("/../../production"));
  assert.equal(count, 1);
  const denied = createManagementApi(operator, async () => ({ ok: false, status: 403, json: async () => ({ password: "private-error-body" }) }));
  await assert.rejects(denied(""), (error) => error.message.includes("403") && !error.message.includes("private-error-body"));
});
test("staging migration plan detects edits, unknown history and out-of-order changes", async () => {
  const migrations = await loadMigrations();
  assert.equal(migrations.length, 20);
  assert.equal(planMigrations(migrations, []).length, 20);
  const first = { version: migrations[0].version, checksum: migrations[0].checksum };
  assert.equal(planMigrations(migrations, [first]).length, 19);
  assert.throws(() => planMigrations(migrations, [{ ...first, checksum: "wrong" }]), /drift/);
  assert.throws(() => planMigrations(migrations, [{ version: "19000101000000", checksum: "a" }]), /drift/);
  assert.throws(() => planMigrations(migrations, [migrations[1]]), /Out-of-order/);
});
test("every staging migration records its original SQL and checksum inside its transaction", async () => {
  for (const item of await loadMigrations()) {
    const sql = migrationQuery(item);
    assert.match(sql, /schema_migrations \(version,name,statements\)/);
    assert.match(sql, /uc_staging_checksums/);
    assert.ok(sql.includes(item.checksum));
    assert.match(sql, /commit;$/);
    assert.ok(sql.indexOf("insert into supabase_migrations.schema_migrations") > sql.indexOf("begin;"));
  }
});
test("staging fixtures require unique private input and always use reserved synthetic email addresses", () => {
  assert.throws(() => validateFixtureCredentials({}));
  const creds = Object.fromEntries(["admin", "pending", "seller", "buyer", "suspended"].map((role) => [role, `Test9!${role}${"x".repeat(30)}`]));
  assert.ok(validateFixtureCredentials(creds).every((fixture) => fixture.email.endsWith("@example.test")));
  assert.throws(() => validateFixtureCredentials({ ...creds, admin: creds.buyer }), /unique/);
});
test("synthetic Storage filenames obey existing verification and publication policies", () => {
  const owner = "10000000-0000-4000-8000-000000000001";
  const record = "20000000-0000-4000-8000-000000000002";
  assert.equal(fixtureStoragePaths(owner, record).verification, `${owner}/${record}/student-id.png`);
  assert.equal(fixtureStoragePaths(owner, record).listing, `${owner}/${record}/${record}.png`);
  assert.throws(() => fixtureStoragePaths("other/owner", record));
});
