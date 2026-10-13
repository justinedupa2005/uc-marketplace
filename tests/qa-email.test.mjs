import assert from "node:assert/strict";
import test from "node:test";
import { callEmailAuth, extractEmailCredential, isExpectedEmailAuthDenial, runEmailChecks } from "../scripts/qa/lib/email.mjs";
import { assertRunEmail, createMailpitCapture, isExactMailRecipient, validateLocalEmailOrigin } from "../scripts/qa/lib/mailpit.mjs";

const runId = "22222222-2222-4222-8222-222222222222";
const email = `qa-${runId}-email-signup@example.test`;
const id = "11111111-1111-4111-8111-111111111111";
const tokenHash = "a".repeat(64);
const origin = "http://127.0.0.1:54324";
const authOrigin = "http://127.0.0.1:54321";
const appOrigin = "http://127.0.0.1:3106";
const message = (ID, Text, recipient = email) => ({ ID, Text, To: [{ Address: recipient }], Cc: [], Bcc: [] });
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const credentialOptions = (purpose = "signup", confirmationMode = "code") => ({ purpose, confirmationMode, email, supabaseUrl: authOrigin, appBaseUrl: appOrigin });
const denial = (code, status = 403) => ({ data: { user: null, session: null }, error: { code, status, message: "sensitive-service-response" } });

test("email capture permits only explicit loopback origins and current fixture identities", () => {
  assert.equal(validateLocalEmailOrigin(origin), origin);
  assert.equal(assertRunEmail(email, runId), email);
  for (const url of ["https://hosted.supabase.co", "http://127.0.0.1", `${origin}/api/v1`, `${origin}?token=secret`, "http://secret@127.0.0.1:54324", "http://127.0.0.1:54324#secret", "file:///tmp/email"]) {
    assert.throws(() => validateLocalEmailOrigin(url), /local origin|loopback/);
  }
  for (const recipient of ["existing@example.test", email.replace(runId, id), `${email}.attacker.test`, `qa-${runId}-" OR all@example.test`]) {
    assert.throws(() => assertRunEmail(recipient, runId), /owned by this QA run/);
  }
});

test("SMTP messages require all envelope recipients to equal the exact fixture address", () => {
  assert.equal(isExactMailRecipient(message("one", "code"), email), true);
  assert.equal(isExactMailRecipient({ ...message("one", "code"), Cc: [{ Address: "existing@example.test" }] }, email), false);
  assert.equal(isExactMailRecipient({ ...message("one", "code"), Bcc: [{ Address: "existing@example.test" }] }, email), false);
  assert.equal(isExactMailRecipient({ To: [{ Name: email }] }, email), false);
  assert.equal(isExactMailRecipient({ To: [] }, email), false);
});

test("Mailpit polls the current v1 JSON API and ignores previous IDs and substring matches", async () => {
  const calls = [];
  let poll = 0;
  let elapsed = 0;
  const capture = createMailpitCapture({ url: origin, runId, now: () => elapsed, wait: async (duration) => { elapsed += duration; },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("/api/v1/search?")) {
        poll += 1;
        const messages = [message("previous", "12345678"), message("other", "87654321", `${email}.attacker.test`)];
        if (poll > 1) messages.unshift(message("new-message", "87654321"));
        return jsonResponse({ messages });
      }
      return jsonResponse(message("new-message", "87654321"));
    },
  });
  const captured = await capture.waitForMessage({ email, afterIds: new Set(["previous"]), timeoutMs: 500 });
  assert.equal(captured.ID, "new-message");
  assert.equal(calls.some((call) => /message\/(previous|other)$/.test(call.url)), false);
  assert.equal(new URL(calls[0].url).searchParams.get("query"), `to:"${email}"`);
  assert.equal(calls.every((call) => call.options.redirect === "error" && call.url.startsWith(origin)), true);
});

test("Mailpit errors redact bodies, credentials, fetch diagnostics, and invalid JSON", async () => {
  const secret = "sensitive-password-and-token";
  for (const fetchImpl of [
    async () => { throw new Error(secret); },
    async () => new Response(secret, { status: 401 }),
    async () => new Response(secret, { status: 200 }),
    async () => jsonResponse({ messages: [{ ID: `../../${secret}` }] }),
  ]) {
    const capture = createMailpitCapture({ url: origin, runId, fetchImpl });
    await assert.rejects(capture.snapshot(email), (error) => !error.message.includes(secret) && /Mailpit/.test(error.message));
  }
});

test("Mailpit polling fails on its deadline and never deletes an empty capture", async () => {
  let elapsed = 0;
  const methods = [];
  const capture = createMailpitCapture({ url: origin, runId, now: () => elapsed, wait: async (duration) => { elapsed += duration; },
    fetchImpl: async (_url, options) => { methods.push(options.method); return jsonResponse({ messages: [] }); },
  });
  await assert.rejects(capture.waitForMessage({ email, timeoutMs: 300, intervalMs: 100 }), /deadline/);
  assert.equal(elapsed, 300);
  await capture.deleteCapturedMessages();
  assert.equal(methods.includes("DELETE"), false);
});

test("Mailpit cleanup rechecks ownership and deletes deduplicated explicit IDs only", async () => {
  const mutations = [];
  const capture = createMailpitCapture({ url: origin, runId, fetchImpl: async (url, options) => {
    if (options.method === "DELETE") { mutations.push({ url, body: JSON.parse(options.body) }); return new Response("ok"); }
    if (url.includes("/search?")) return jsonResponse({ messages: [message("owned", "12345678")] });
    return jsonResponse(message("owned", "12345678"));
  } });
  await capture.waitForMessage({ email });
  await capture.waitForMessage({ email });
  await capture.deleteCapturedMessages();
  await capture.deleteCapturedMessages();
  assert.deepEqual(mutations, [{ url: `${origin}/api/v1/messages`, body: { IDs: ["owned"] } }]);
});

test("Mailpit cleanup refuses changed message ownership before the delete request", async () => {
  let changed = false;
  let deletes = 0;
  const capture = createMailpitCapture({ url: origin, runId, fetchImpl: async (url, options) => {
    if (options.method === "DELETE") { deletes += 1; return new Response("ok"); }
    if (url.includes("/search?")) return jsonResponse({ messages: [message("owned", "12345678")] });
    return jsonResponse(message("owned", "12345678", changed ? "existing@example.test" : email));
  } });
  await capture.waitForMessage({ email });
  changed = true;
  await assert.rejects(capture.deleteCapturedMessages(), /does not match/);
  assert.equal(deletes, 0);
});

test("signup extraction follows the application's eight-digit email OTP mode", () => {
  assert.deepEqual(extractEmailCredential({ HTML: "<p>Enter &#49;2345678</p>", Text: "Enter 12345678" }, credentialOptions()), { email, token: "12345678", type: "email" });
  for (const Text of ["123456", "123456789", "12345678 or 87654321", "no code"]) {
    assert.throws(() => extractEmailCredential({ Text }, credentialOptions()), /exactly one eight-digit/);
  }
  assert.throws(() => extractEmailCredential({ Text: "123456" }, { ...credentialOptions(), otpLength: 6 }), /eight-digit signup/);
});

test("link extraction supports default Auth links and direct application token hash callbacks", () => {
  const recovery = `${appOrigin}/auth/recovery?token_hash=${tokenHash}&type=recovery`;
  assert.deepEqual(extractEmailCredential({ HTML: `<a href="${recovery.replace("&", "&amp;")}">Reset</a>` }, credentialOptions("recovery")), { token_hash: tokenHash, type: "recovery" });
  const signup = `${authOrigin}/auth/v1/verify?token=${tokenHash}&type=email&redirect_to=${encodeURIComponent(`${appOrigin}/auth/confirm`)}`;
  assert.deepEqual(extractEmailCredential({ Text: signup }, credentialOptions("signup", "link")), { token_hash: tokenHash, type: "email" });
  assert.throws(() => extractEmailCredential({ Text: signup }, credentialOptions()), /eight-digit/);
});

test("captured links refuse hosted, foreign-port, wrong callback, or credential-bearing destinations", () => {
  for (const url of [
    `https://hosted.supabase.co/auth/v1/verify?token=${tokenHash}&type=recovery`,
    `${authOrigin}/auth/v1/verify?token=${tokenHash}&type=recovery&redirect_to=https://hosted.test/auth/recovery`,
    `${appOrigin}/auth/confirm?token_hash=${tokenHash}&type=recovery`,
    `http://127.0.0.1:9999/auth/recovery?token_hash=${tokenHash}&type=recovery`,
    `http://secret@127.0.0.1:3106/auth/recovery?token_hash=${tokenHash}&type=recovery`,
  ]) assert.throws(() => extractEmailCredential({ Text: url }, credentialOptions("recovery")), (error) => /local QA|explicit QA/.test(error.message) && !error.message.includes(tokenHash));
});

test("captured links refuse ambiguous verification query parameters", () => {
  for (const query of [
    `token_hash=${tokenHash}&type=recovery&type=recovery`,
    `token_hash=${tokenHash}&token=${tokenHash}&type=recovery`,
    `token_hash=${tokenHash}&token_hash=${tokenHash}&type=recovery`,
  ]) assert.throws(() => extractEmailCredential({ Text: `${appOrigin}/auth/recovery?${query}` }, credentialOptions("recovery")), /unambiguous verification/);
});

test("expected Auth denials reject rate limits, wrong codes, server errors, and successful sessions", () => {
  assert.equal(isExpectedEmailAuthDenial(denial("otp_expired"), "otp_expired"), true);
  for (const result of [denial("over_request_rate_limit", 429), denial("otp_expired", 503), denial("otp_expired", 0), denial("invalid_credentials"), { ...denial("otp_expired"), data: { session: { access_token: "secret" } } }]) {
    assert.equal(isExpectedEmailAuthDenial(result, "otp_expired"), false);
  }
});

test("thrown Auth diagnostics are reduced to a fixed operation label", async () => {
  await assert.rejects(callEmailAuth(async () => { throw new Error("private-password token URL"); }, "Recovery"), /^Error: Recovery failed \(service_error\)\.$/);
});

function mockedAcceptance({ pendingError = "email_not_confirmed", recoveryMethod = "otp" } = {}) {
  const calls = [];
  const oldPassword = "Qa!old-password-fixture9Zz";
  let password = oldPassword;
  let confirmed = false;
  let expired = false;
  let code = "12345678";
  const consumed = new Set();
  const messages = [message("signup", code)];
  const success = (data = {}) => ({ data, error: null });
  const user = () => ({ id, ...(confirmed && { email_confirmed_at: "2026-10-12T00:00:00Z" }) });
  const createPublicClient = () => ({ auth: {
    async signInWithPassword(credentials) {
      calls.push("signInWithPassword");
      if (!confirmed) return denial(pendingError, pendingError === "email_not_confirmed" ? 400 : 503);
      if (credentials.password !== password) return denial("invalid_credentials", 400);
      return success({ user: user(), session: {} });
    },
    async verifyOtp(credential) {
      calls.push(`verifyOtp:${credential.type}`);
      const token = credential.token ?? credential.token_hash;
      if (consumed.has(token) || (expired && token === "12345678")) return denial("otp_expired");
      consumed.add(token);
      if (credential.type === "email") confirmed = true;
      return success({ user: user(), session: {} });
    },
    async signOut() { calls.push("signOut"); return { error: null }; },
    async resend(parameters) { calls.push(`resend:${parameters.type}`); code = "87654321"; messages.push(message("resend", code)); return success(); },
    async resetPasswordForEmail(_email, options) { calls.push("resetPasswordForEmail"); assert.equal(options.redirectTo, `${appOrigin}/auth/recovery`); messages.push(message("recovery", `${appOrigin}/auth/recovery?token_hash=${tokenHash}&type=recovery`)); return success(); },
    async getClaims() { calls.push("getClaims"); return success({ claims: { sub: id, amr: [{ method: recoveryMethod }] } }); },
    async updateUser(attributes) { calls.push("updateUser"); password = attributes.password; return success({ user: user() }); },
  } });
  const account = { id, email, password: oldPassword, client: createPublicClient() };
  const context = { runId, accounts: {}, config: { supabaseUrl: authOrigin, appBaseUrl: appOrigin, mailpitUrl: origin } };
  const capture = {
    async waitForMessage({ afterIds = new Set() }) { return messages.find((item) => !afterIds.has(item.ID)); },
    async snapshot() { return new Set(messages.map((item) => item.ID)); },
    async deleteCapturedMessages() { calls.push("captureCleanup"); },
  };
  const options = { capture, createPublicClient, wait: async () => { calls.push("expiryWait"); expired = true; },
    async createSignupFixture() { calls.push("signUp"); context.accounts.emailSignup = account; return { account, signupData: { user: { id }, session: null } }; },
  };
  return { context, options, account, calls, oldPassword };
}

test("email orchestrator verifies expiry, resend, single use, recovery, and both password outcomes", async () => {
  const { context, options, account, calls, oldPassword } = mockedAcceptance();
  assert.equal(await runEmailChecks(context, options), 12);
  assert.notEqual(account.password, oldPassword);
  assert.equal(calls.filter((call) => call === "expiryWait").length, 3);
  assert.ok(calls.indexOf("resend:signup") > calls.indexOf("expiryWait"));
  assert.ok(calls.indexOf("resetPasswordForEmail") > calls.indexOf("resend:signup"));
  assert.ok(calls.includes("verifyOtp:recovery") && calls.includes("getClaims") && calls.includes("updateUser"));
  assert.equal(calls.at(-1), "captureCleanup");
});

test("email orchestrator fails closed on hosted targets before provisioning or capture mutation", async () => {
  const { context, options, calls } = mockedAcceptance();
  context.config.supabaseUrl = "https://hosted.supabase.co";
  await assert.rejects(runEmailChecks(context, options), /loopback/);
  assert.deepEqual(calls, []);
});

test("email orchestrator treats Auth outages as failures and still cleans captured messages", async () => {
  const { context, options, calls } = mockedAcceptance({ pendingError: "unexpected_failure" });
  await assert.rejects(runEmailChecks(context, options), /specifically because email is unconfirmed/);
  assert.equal(calls.includes("resetPasswordForEmail"), false);
  assert.equal(calls.at(-1), "captureCleanup");
});

test("direct recovery OTP acceptance rejects a password-only session before changing the password", async () => {
  const { context, options, calls } = mockedAcceptance({ recoveryMethod: "password" });
  await assert.rejects(runEmailChecks(context, options), /must establish this fixture's OTP session/);
  assert.equal(calls.includes("updateUser"), false);
  assert.equal(calls.at(-1), "captureCleanup");
});

test("email orchestrator redacts raw error codes and responses from failed normal recovery requests", async () => {
  const { context, options } = mockedAcceptance();
  const createClient = options.createPublicClient;
  options.createPublicClient = () => {
    const client = createClient();
    client.auth.resetPasswordForEmail = async () => ({ data: null, error: { code: "https://private:credential@hosted.test/token", message: "private recovery response" } });
    return client;
  };
  await assert.rejects(runEmailChecks(context, options), /^Error: SMTP recovery request failed \(service_error\)\.$/);
});
