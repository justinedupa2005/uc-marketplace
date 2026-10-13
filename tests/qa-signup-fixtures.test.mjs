import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const fixtureKey = Symbol.for("uc-marketplace.qa-signup-fixtures.fixture");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@supabase/supabase-js") {
      const code = `export function createClient(url, key, options) {
        const fixture = globalThis[Symbol.for("uc-marketplace.qa-signup-fixtures.fixture")];
        fixture.calls.push({ operation: "createClient", url, key, options });
        return fixture.client;
      }`;
      return { url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { accountEnvironment, cleanupFixtures, createSignupFixture } = await import("../scripts/qa/lib/fixtures.mjs");
const id = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const email = `qa-${runId}-email-signup@example.test`;

function installFixture(options = {}) {
  const calls = [];
  let request;
  let tagged = false;
  const success = (data) => ({ data, error: null });
  const actualUser = () => ({
    id, email,
    app_metadata: { provider: "email", ...(tagged && { qa_run_id: runId }), ...options.appMetadata },
    user_metadata: { ...request?.options.data, ...options.userMetadata },
    ...options.actualUser,
  });
  const client = { auth: {
    async signUp(parameters) {
      calls.push({ operation: "signUp", parameters });
      request = parameters;
      return options.signupError ? { data: { user: null, session: null }, error: options.signupError }
        : success({ user: { id, ...options.signupUser }, session: options.signupSession ?? null });
    },
    async signOut(parameters) { calls.push({ operation: "signOut", parameters }); return { error: null }; },
  } };
  const databaseResult = () => ({ rowCount: options.databaseMissing ? 0 : 1,
    rows: options.databaseMissing ? [] : [{ id, profile_id: id, qa_run_id: options.databaseRunId ?? runId }],
  });
  const transaction = {
    async query(sql, parameters) {
      calls.push({ operation: "transaction.query", sql, parameters });
      if (sql.startsWith("select account.id")) return databaseResult();
      return { rowCount: 0, rows: [] };
    },
    release() { calls.push({ operation: "release" }); },
  };
  const context = {
    runId, accounts: {}, config: { local: true, supabaseUrl: "http://127.0.0.1:54321", appBaseUrl: "http://127.0.0.1:3106", publishableKey: "sb_publishable_mock_fixture" },
    admin: {
      auth: { admin: {
        async getUserById(value) {
          calls.push({ operation: "getUserById", id: value });
          return options.inspectionError ? { data: { user: null }, error: options.inspectionError } : success({ user: actualUser() });
        },
        async updateUserById(value, attributes) {
          calls.push({ operation: "updateUserById", id: value, attributes });
          if (options.tagError) return { data: null, error: options.tagError };
          tagged = true;
          return success({ user: actualUser() });
        },
        async deleteUser(value) { calls.push({ operation: "deleteUser", id: value }); return success({}); },
      } },
      from(table) {
        calls.push({ operation: "from", table });
        return { select(columns) { return { eq(column, value) { return { async single() {
          calls.push({ operation: "profileRead", columns, column, value });
          return success({ id, role: "student", verification_status: "unverified", account_status: "active", ...options.profile });
        } }; } }; } };
      },
      storage: { from() { return { async remove() { assert.fail("A new signup fixture owns no Storage files."); } }; } },
    },
    pool: {
      async query(sql, parameters) { calls.push({ operation: "pool.query", sql, parameters }); return databaseResult(); },
      async connect() { calls.push({ operation: "connect" }); return transaction; },
    },
  };
  globalThis[fixtureKey] = { calls, client };
  return { calls, context, client };
}

test("signup fixtures use normal unconfirmed Auth and tag only an inspected exact identity", async () => {
  const { context, calls, client } = installFixture();
  const created = await createSignupFixture(context);
  assert.equal(created.account, context.accounts.emailSignup);
  assert.equal(created.account.client, client);
  assert.equal(created.account.id, id);
  assert.equal(created.account.email, email);
  assert.equal(created.signupData.session, null);
  const signup = calls.find((call) => call.operation === "signUp").parameters;
  assert.equal(signup.email, email);
  assert.equal(signup.options.emailRedirectTo, `${context.config.appBaseUrl}/auth/confirm`);
  assert.ok(signup.options.data.qa_signup_nonce && signup.options.data.student_id_number.startsWith("QA-"));
  assert.equal(signup.options.data.role, "admin");
  const mutation = calls.find((call) => call.operation === "updateUserById");
  assert.deepEqual(mutation, { operation: "updateUserById", id, attributes: { app_metadata: { provider: "email", qa_run_id: runId } } });
  assert.ok(calls.findIndex((call) => call.operation === "getUserById") < calls.indexOf(mutation));
  const database = calls.find((call) => call.operation === "pool.query");
  assert.deepEqual(database.parameters, [[id]]);
  assert.ok(database.sql.includes("for update of account"));
  assert.equal(calls.filter((call) => call.operation === "createClient").length, 1);
});

test("signup fixture preflight refuses remote, unsupported mode, or already recorded identity before Auth", async () => {
  for (const patch of ["remote", "mode", "existing"]) {
    const { context, calls } = installFixture();
    if (patch === "remote") context.config.local = false;
    if (patch === "existing") context.accounts.emailSignup = { id: otherId };
    await assert.rejects(createSignupFixture(context, { confirmationMode: patch === "mode" ? "unsupported" : "code" }));
    assert.deepEqual(calls, []);
  }
});

test("signup Auth errors retain no invented identity and expose only a bounded code", async () => {
  const { context, calls } = installFixture({ signupError: { code: "https://private:secret@hosted.test/token", message: "private SMTP response" } });
  await assert.rejects(createSignupFixture(context), /^Error: Normal SMTP signup failed \(service_error\)\.$/);
  assert.equal(context.accounts.emailSignup, undefined);
  assert.equal(calls.some((call) => ["getUserById", "updateUserById", "pool.query"].includes(call.operation)), false);
});

test("accidental signup confirmation retains the exact cleanup identity without tagging or automatic deletion", async () => {
  for (const patch of [{ signupSession: {} }, { signupUser: { email_confirmed_at: "2026-10-12T00:00:00Z" } }]) {
    const { context, calls } = installFixture(patch);
    await assert.rejects(createSignupFixture(context), /must wait for SMTP confirmation/);
    assert.equal(context.accounts.emailSignup.id, id);
    assert.equal(context.accounts.emailSignup.email, email);
    assert.equal(calls.some((call) => ["getUserById", "updateUserById", "pool.query", "profileRead"].includes(call.operation)), false);
    await assert.rejects(cleanupFixtures(context), /another run/);
    assert.equal(calls.some((call) => ["connect", "deleteUser"].includes(call.operation)), false);
  }
});

test("obfuscated duplicates, mismatched identities, and prior run markers never receive a QA tag", async () => {
  for (const patch of [
    { actualUser: { id: otherId } }, { actualUser: { email: "existing@example.test" } },
    { userMetadata: { qa_signup_nonce: "a-different-signup" } },
    { appMetadata: { qa_run_id: "a-prior-qa-run" } }, { actualUser: { email_confirmed_at: "2026-10-12T00:00:00Z" } },
  ]) {
    const { context, calls } = installFixture(patch);
    await assert.rejects(createSignupFixture(context));
    assert.equal(context.accounts.emailSignup.id, id);
    assert.equal(calls.some((call) => ["updateUserById", "pool.query", "profileRead", "deleteUser"].includes(call.operation)), false);
  }
});

test("an obfuscated duplicate signup ID cannot resolve through Admin or cause tagging/deletion", async () => {
  const { context, calls } = installFixture({ signupUser: { id: otherId }, inspectionError: { code: "user_not_found", status: 404, message: "private identity diagnostic" } });
  await assert.rejects(createSignupFixture(context), /^Error: SMTP signup identity inspection failed \(user_not_found\)\.$/);
  assert.equal(context.accounts.emailSignup.id, otherId);
  assert.deepEqual(calls.filter((call) => call.operation === "getUserById"), [{ operation: "getUserById", id: otherId }]);
  assert.equal(calls.some((call) => ["updateUserById", "pool.query", "deleteUser"].includes(call.operation)), false);
});

test("failed ownership tagging keeps the exact returned identity and cleanup fails before deletion", async () => {
  const { context, calls } = installFixture({ tagError: { code: "unexpected_failure", message: "private Auth diagnostic" } });
  await assert.rejects(createSignupFixture(context), /SMTP fixture ownership tag failed/);
  assert.equal(context.accounts.emailSignup.id, id);
  assert.equal(context.accounts.emailSignup.email, email);
  await assert.rejects(cleanupFixtures(context), /another run/);
  assert.equal(calls.some((call) => ["connect", "pool.query", "deleteUser"].includes(call.operation)), false);
});

test("wrong SQL ownership or elevated signup profiles fail with a recorded tagged fixture", async () => {
  for (const patch of [{ databaseMissing: true }, { databaseRunId: "another-run" }, { profile: { role: "admin" } }, { profile: { verification_status: "verified" } }, { profile: { account_status: "disabled" } }]) {
    const { context, calls } = installFixture(patch);
    await assert.rejects(createSignupFixture(context));
    assert.equal(context.accounts.emailSignup.id, id);
    assert.equal(calls.filter((call) => call.operation === "updateUserById").length, 1);
    assert.equal(calls.some((call) => call.operation === "deleteUser"), false);
  }
});

test("fixture export reads the recovered in-memory password while scoped cleanup needs only identity", async () => {
  const { context, calls } = installFixture();
  const { account } = await createSignupFixture(context);
  const recoveredPassword = "Qa!Synthetic-recovered-password9Zz";
  account.password = recoveredPassword;
  const exported = accountEnvironment(context.accounts);
  assert.equal(exported.QA_EMAILSIGNUP_ID, id);
  assert.equal(exported.QA_EMAILSIGNUP_EMAIL, email);
  assert.equal(exported.QA_EMAILSIGNUP_PASSWORD, recoveredPassword);
  await cleanupFixtures(context);
  assert.deepEqual(calls.filter((call) => call.operation === "deleteUser"), [{ operation: "deleteUser", id }]);
  assert.equal(calls.some((call) => call.operation === "signUp" && call.parameters.password === recoveredPassword), false);
});
