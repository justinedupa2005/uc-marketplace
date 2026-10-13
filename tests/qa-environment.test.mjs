import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertQaDotenvSafety, getPrivilegedDotenvNames, getQaAppEnvironment, getQaBrowserEnvironment, isQaPublishableKey, validateQaEnvironment } from "../scripts/qa/lib/environment.mjs";

const local = { QA_ALLOW_MUTATIONS: "1", QA_SUPABASE_URL: "http://127.0.0.1:54321", QA_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_fixture", QA_SUPABASE_SERVICE_ROLE_KEY: "private-test-config", QA_DATABASE_URL: "postgresql://postgres:test@127.0.0.1:54322/postgres" };
const remote = { ...local, QA_SUPABASE_URL: "https://disposableqa.supabase.co", QA_ALLOW_REMOTE: "1", QA_ALLOWED_PROJECT_REF: "disposableqa", QA_DATABASE_URL: "postgresql://postgres:test@db.disposableqa.supabase.co:5432/postgres?sslmode=require" };

test("full email acceptance requires an explicitly isolated local capture origin", () => {
  assert.throws(() => validateQaEnvironment(local, { requireMailpit: true }), /QA_MAILPIT_URL/);
  for (const url of ["https://mail.example.test", "http://localhost:54324/path", "http://user:secret@localhost:54324", "http://localhost:54324?redirect=remote", "http://localhost"]) {
    assert.throws(() => validateQaEnvironment({ ...local, QA_MAILPIT_URL: url }));
  }
  assert.throws(() => validateQaEnvironment({ ...remote, QA_MAILPIT_URL: "http://127.0.0.1:54324" }), /local disposable/);
  assert.equal(validateQaEnvironment({ ...local, QA_MAILPIT_URL: "http://127.0.0.1:54324" }, { requireMailpit: true }).mailpitUrl, "http://127.0.0.1:54324");
});

test("ephemeral recovery signing keys reach app processes but never browser workers", () => {
  const config = { ...validateQaEnvironment(local), recoverySecret: "ab".repeat(32), emailConfirmationMode: "code" };
  assert.equal(getQaAppEnvironment(config, {}).AUTH_RECOVERY_SECRET, config.recoverySecret);
  assert.equal(getQaBrowserEnvironment(config, {}).AUTH_RECOVERY_SECRET, undefined);
  assert.equal(getQaAppEnvironment(config, {}).EMAIL_CONFIRMATION_MODE, "code");
  assert.throws(() => validateQaEnvironment({ ...local, QA_EMAIL_CONFIRMATION_MODE: "unknown" }), /code or link/);
});

test("QA fails closed without an explicit mutation opt-in and isolated configuration", () => {
  assert.throws(() => validateQaEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://production.supabase.co" }), /QA_ALLOW_MUTATIONS/);
  assert.throws(() => validateQaEnvironment({ QA_ALLOW_MUTATIONS: "1" }), /required/);
  assert.equal(validateQaEnvironment(local, { requireDatabase: true }).local, true);
});

test("QA public key validation rejects privileged and malformed keys before any work", () => {
  // Syntactic claims-only fixtures, not real signed project credentials.
  const jwt = (role) => `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.test-signature`;
  assert.equal(isQaPublishableKey(local.QA_SUPABASE_PUBLISHABLE_KEY), true);
  assert.equal(isQaPublishableKey(jwt("anon")), true);
  assert.equal(validateQaEnvironment({ ...local, QA_SUPABASE_PUBLISHABLE_KEY: jwt("anon") }).local, true);
  for (const key of ["sb_secret_test_fixture", jwt("service_role"), jwt("supabase_admin"), jwt("authenticated"), "not-a-key", "header.invalid-json.signature", "sb_publishable_", "sb_publishable_bad key"]) {
    assert.equal(isQaPublishableKey(key), false);
    assert.throws(() => validateQaEnvironment({ ...local, QA_SUPABASE_PUBLISHABLE_KEY: key }), (error) => {
      assert.match(error.message, /publishable key or legacy anon JWT/);
      assert.equal(error.message.includes(key), false);
      return true;
    });
  }
});
test("QA refuses remote targets without exact allowed-project confirmation", () => {
  assert.throws(() => validateQaEnvironment({ ...remote, QA_ALLOW_REMOTE: "0" }), /Remote QA/);
  assert.throws(() => validateQaEnvironment({ ...remote, QA_ALLOWED_PROJECT_REF: "different" }), /Remote QA/);
  assert.throws(() => validateQaEnvironment(remote, { linkedProjectRef: "disposableqa" }), /linked/);
  assert.equal(validateQaEnvironment(remote).local, false);
});
test("full browser QA refuses remote targets before provisioning or starting the app", () => {
  assert.throws(() => validateQaEnvironment(remote, { requireDatabase: true, requireLocal: true }), /--api-only/);
  assert.equal(validateQaEnvironment(local, { requireDatabase: true, requireLocal: true }).local, true);
});
test("QA rejects deceptive origins, credentials, alternate remote domains and non-loopback apps", () => {
  for (const url of ["http://user:pass@localhost:54321", "http://localhost:54321/path", "http://localhost:54321?target=production", "https://disposableqa.supabase.co.evil.test"]) {
    assert.throws(() => validateQaEnvironment({ ...remote, QA_SUPABASE_URL: url }));
  }
  assert.throws(() => validateQaEnvironment({ ...local, QA_APP_BASE_URL: "https://marketplace.example.com" }), /loopback/);
  assert.throws(() => validateQaEnvironment({ ...local, QA_SUPABASE_SERVICE_ROLE_KEY: local.QA_SUPABASE_PUBLISHABLE_KEY }), /different/);
});
test("real concurrency requires an explicitly matched PostgreSQL connection", () => {
  assert.throws(() => validateQaEnvironment({ ...local, QA_DATABASE_URL: undefined }, { requireDatabase: true }), /QA_DATABASE_URL/);
  assert.throws(() => validateQaEnvironment({ ...local, QA_DATABASE_URL: remote.QA_DATABASE_URL }), /loopback database/);
  assert.throws(() => validateQaEnvironment({ ...remote, QA_DATABASE_URL: "postgresql://postgres:test@db.production.supabase.co/postgres?sslmode=require" }), /match/);
  assert.throws(() => validateQaEnvironment({ ...remote, QA_DATABASE_URL: remote.QA_DATABASE_URL.replace("sslmode=require", "sslmode=disable") }), /TLS/);
});

test("QA database query parameters cannot override the checked connection target", () => {
  for (const parameter of ["host=db.production.supabase.co", "user=postgres.production", "port=9999", "database=production", "ssl=true", "options=-csearch_path=private", "sslmode=require&sslmode=disable"]) {
    assert.throws(() => validateQaEnvironment({ ...local, QA_DATABASE_URL: `${local.QA_DATABASE_URL}?${parameter}` }), /only one sslmode/);
  }
  assert.throws(() => validateQaEnvironment({ ...remote, QA_DATABASE_URL: `${remote.QA_DATABASE_URL}&host=db.production.supabase.co` }), /only one sslmode/);
  assert.throws(() => validateQaEnvironment({ ...local, QA_DATABASE_URL: `${local.QA_DATABASE_URL}?sslmode=invalid` }), /disable, prefer, or require/);
  for (const mode of ["disable", "prefer", "require"]) {
    assert.equal(validateQaEnvironment({ ...local, QA_DATABASE_URL: `${local.QA_DATABASE_URL}?sslmode=${mode}` }).local, true);
  }
});
test("privileged QA secrets are excluded from Next.js build and server environment", () => {
  const env = getQaAppEnvironment(validateQaEnvironment(local), { ...local, QA_BUYER_PASSWORD: "test-only", SUPABASE_SERVICE_ROLE_KEY: "test-only", DATABASE_PASSWORD: "test-only", AUTH_SECRET: "test-only", DB_PASS: "test-only", PGUSER: "test-only", SUPABASE_ACCESS_TOKEN: "test-only", OPENAI_API_KEY: "test-only", NEXT_PUBLIC_APP_URL: "https://production.example.test", NODE_ENV: "development", PATH: "retained" });
  assert.equal(env.PATH, "retained");
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, local.QA_SUPABASE_URL);
  assert.equal(env.NEXT_PUBLIC_APP_URL, "http://127.0.0.1:3106");
  for (const name of ["QA_SUPABASE_SERVICE_ROLE_KEY", "QA_BUYER_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_PASSWORD", "AUTH_SECRET", "DB_PASS", "PGUSER", "SUPABASE_ACCESS_TOKEN", "OPENAI_API_KEY", "QA_DATABASE_URL"]) assert.equal(env[name], undefined);
});

test("dotenv preflight finds privileged assignment names without returning values", () => {
  const value = "secret-value-that-must-not-appear";
  const names = getPrivilegedDotenvNames([
    "# SUPABASE_SERVICE_ROLE_KEY=comment-not-an-assignment",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=public-safe-value",
    "NEXT_PUBLIC_APP_URL=http://127.0.0.1:3106",
    ` export SUPABASE_SERVICE_ROLE_KEY = ${value}`,
    `SUPABASE_SERVICE_ROLE_KEY=${value}`,
    `AUTH_SECRET: ${value}`,
    `DB_PASS=${value}`,
    `SUPABASE_ACCESS_TOKEN=${value}`,
    `OPENAI_API_KEY=${value}`,
    `POSTGRES_CONNECTION_STRING=${value}`,
    `PRIVATE_KEY="${value}`,
    "multiline-key-material\"",
  ].join("\r\n"));
  assert.deepEqual(names, ["SUPABASE_SERVICE_ROLE_KEY", "AUTH_SECRET", "DB_PASS", "SUPABASE_ACCESS_TOKEN", "OPENAI_API_KEY", "POSTGRES_CONNECTION_STRING", "PRIVATE_KEY"]);
  assert.equal(JSON.stringify(names).includes(value), false);
});

test("dotenv preflight rejects all production-loaded files with credential-safe diagnostics", async () => {
  const temporaryRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, "uc-qa-env-"));
  try {
    await assertQaDotenvSafety(directory);
    await writeFile(path.join(directory, ".env.local"), "NEXT_PUBLIC_APP_URL=http://127.0.0.1:3106\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=public-only");
    await assertQaDotenvSafety(directory);
    await rm(path.join(directory, ".env.local"));
    for (const filename of [".env.production.local", ".env.local", ".env.production", ".env"]) {
      await writeFile(path.join(directory, filename), "SUPABASE_SERVICE_ROLE_KEY=credential-value-not-for-diagnostics");
      await assert.rejects(assertQaDotenvSafety(directory), (error) => {
        assert.ok(error.message.includes(filename));
        assert.equal(error.message.includes("credential-value-not-for-diagnostics"), false);
        return true;
      });
      await rm(path.join(directory, filename));
    }
  } finally {
    const resolvedDirectory = path.resolve(directory);
    assert.ok(resolvedDirectory.startsWith(`${temporaryRoot}${path.sep}`) && path.basename(resolvedDirectory).startsWith("uc-qa-env-"), "Cleanup must stay inside its newly created temporary fixture directory.");
    await rm(resolvedDirectory, { recursive: true, force: true });
  }
});
