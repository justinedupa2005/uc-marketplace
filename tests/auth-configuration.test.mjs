import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertPreservedAuthSettings, authPolicy, authTemplates, configureAuth, contact, createAuthApi, planAuthSettings, registry, summarizeAuth, validateAuthTarget } from "../scripts/auth/configure.mjs";
import { PASSWORD_SYMBOLS, SUPABASE_PASSWORD_CHARACTERS } from "../src/lib/auth/password-policy.mjs";

const environment = (mode, apply = false) => ({ [`${mode.toUpperCase()}_PROJECT_REF`]: registry[mode].supabaseProjectRef,
  [`${mode.toUpperCase()}_MANAGEMENT_TOKEN`]: `sbp_${"fixture".repeat(8)}`,
  ...(apply && { AUTH_SETTINGS_CONFIRM: `${mode}:${registry[mode].supabaseProjectRef}` }) });
const response = (value) => new Response(JSON.stringify(value), { status: 200 });

test("Auth settings require exact environment/project confirmation before network or writes", () => {
  for (const mode of ["staging", "production"]) {
    assert.equal(validateAuthTarget(mode, environment(mode)).ref, registry[mode].supabaseProjectRef);
    assert.throws(() => validateAuthTarget(mode, environment(mode), { apply: true }));
    assert.doesNotThrow(() => validateAuthTarget(mode, environment(mode, true), { apply: true }));
    assert.throws(() => validateAuthTarget(mode, { ...environment(mode), [`${mode.toUpperCase()}_PROJECT_REF`]: registry[mode === "staging" ? "production" : "staging"].supabaseProjectRef }));
  }
  for (const mode of ["local", "preview", "staging/../../production", undefined]) assert.throws(() => validateAuthTarget(mode, {}));
});

test("provider policy enforces twelve characters, four character classes and confirmation", () => {
  for (const mode of ["staging", "production"]) {
    const policy = authPolicy(mode);
    assert.equal(policy.password_min_length, 12);
    assert.equal(policy.password_required_characters, SUPABASE_PASSWORD_CHARACTERS);
    assert.ok(SUPABASE_PASSWORD_CHARACTERS.startsWith("abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:"));
    assert.ok(SUPABASE_PASSWORD_CHARACTERS.includes("\\:"));
    assert.ok(!PASSWORD_SYMBOLS.includes(" "));
    assert.equal(policy.mailer_autoconfirm, false);
    assert.equal(policy.mailer_allow_unverified_email_sign_ins, false);
    assert.equal(policy.mailer_secure_email_change_enabled, true);
    assert.equal(policy.security_update_password_require_reauthentication, true);
    assert.equal(policy.refresh_token_rotation_enabled, true);
    assert.equal(policy.mailer_otp_exp, mode === "staging" ? 60 : 900);
    assert.equal(policy.uri_allow_list, `${registry[mode].appOrigin}/auth/confirm,${registry[mode].appOrigin}/auth/recovery`);
    assert.doesNotMatch(policy.uri_allow_list, /\*|localhost|127\.0\.0\.1/);
    for (const field of ["smtp_pass", "smtp_user", "smtp_host", "disable_signup", "password_hibp_enabled", "sessions_timebox"]) assert.equal(field in policy, false);
  }
});

test("plans preserve stronger existing numeric controls and reject arbitrary credential fields", () => {
  const desired = authPolicy("production");
  const current = { ...desired, password_min_length: 16, rate_limit_email_sent: 10, smtp_max_frequency: 120, mailer_otp_exp: 300, jwt_exp: 900 };
  assert.deepEqual(planAuthSettings(current, desired), {});
  for (const name of ["smtp_pass", "disable_signup", "external_google_enabled", "jwt_secret"]) assert.throws(() => planAuthSettings({}, { ...desired, [name]: "not-allowed" }));
});

test("branded templates use typed application callbacks and approved support without user metadata", async () => {
  const production = await authTemplates("production");
  const staging = await authTemplates("staging");
  assert.match(production.mailer_templates_confirmation_content, /\/auth\/confirm\?token_hash={{ \.TokenHash }}&amp;type=email/);
  assert.match(production.mailer_templates_recovery_content, /\/auth\/recovery\?token_hash={{ \.TokenHash }}&amp;type=recovery/);
  assert.match(production.mailer_templates_email_change_content, /type=email_change/);
  assert.match(staging.mailer_templates_confirmation_content, /{{ \.Token }}/);
  assert.doesNotMatch(staging.mailer_templates_confirmation_content, /TokenHash/);
  for (const [name, value] of Object.entries(production)) {
    assert.match(value, /UC Online Shop/);
    if (name.endsWith("_content")) {
      assert.ok(value.includes(`mailto:${contact.supportEmail}`));
      assert.match(value, /viewport/);
      assert.doesNotMatch(value, /{{\s*\.Data|{{\s*\.Email|<script|<img|__SUPPORT/);
    }
  }
  assert.equal(contact.smtpDeferred, true);
  assert.equal(contact.adminInvitationsEnabled, false);
  assert.equal("mailer_templates_invite_content" in production, false);
  const draft = await readFile(new URL("../supabase/templates/invitation.html", import.meta.url), "utf8");
  assert.match(draft, /{{ \.ConfirmationURL }}/);
});

test("read-only plan pins API origin, rejects redirects and reveals no current credential values", async () => {
  const calls = [];
  const current = { ...authPolicy("staging"), smtp_pass: "private-provider-password", jwt_secret: "private-signing-secret" };
  const result = await configureAuth({ mode: "staging", env: environment("staging"), fetcher: async (url, options) => {
    calls.push([url, options]);
    return response(url.endsWith("/config/auth") ? current : { id: registry.staging.supabaseProjectRef, status: "ACTIVE_HEALTHY" });
  } });
  assert.equal(calls.length, 2);
  for (const [url, options] of calls) {
    assert.ok(url.startsWith(`https://api.supabase.com/v1/projects/${registry.staging.supabaseProjectRef}`));
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.body, undefined);
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(result.applied, false);
  assert.equal(result.externalEmailDelivery, "not_verified");
  assert.doesNotMatch(JSON.stringify(result), /private-|sbp_|jwt_secret|smtp_pass/);
});

test("apply backs up only changed fields, patches once and preserves SMTP/signup/paid settings", async () => {
  const before = { ...authPolicy("production"), password_min_length: 6, disable_signup: true,
    smtp_pass: "private-password", smtp_user: "private-login", password_hibp_enabled: false };
  const calls = [];
  let changed;
  let backedUp = false;
  const result = await configureAuth({ mode: "production", apply: true, env: environment("production", true),
    retainSnapshot: async (mode, current, names) => {
      assert.equal(mode, "production");
      assert.deepEqual(current, before);
      assert.ok(!names.includes("smtp_pass") && !names.includes("smtp_user"));
      backedUp = true;
    },
    fetcher: async (url, options) => {
      calls.push(options.method);
      if (!url.endsWith("/config/auth")) return response({ id: registry.production.supabaseProjectRef, status: "ACTIVE_HEALTHY" });
      if (options.method === "PATCH") {
        assert.equal(backedUp, true);
        changed = JSON.parse(options.body);
        for (const name of ["smtp_pass", "smtp_user", "disable_signup", "password_hibp_enabled"]) assert.equal(name in changed, false);
        return response({ ...before, ...changed });
      }
      return response(changed ? { ...before, ...changed } : before);
    },
  });
  assert.deepEqual(calls, ["GET", "GET", "PATCH", "GET"]);
  assert.equal(result.applied, true);
  assert.equal(result.signupDisabled, true);
  assert.equal(result.deploymentEnabled, false);
  assert.equal(result.emailSent, false);
  assert.doesNotMatch(JSON.stringify(result), /private-/);
});

test("transport failures are redacted and an ambiguous settings write is never retried", async () => {
  let writes = 0;
  await assert.rejects(configureAuth({ mode: "production", apply: true, env: environment("production", true), retainSnapshot: async () => {},
    fetcher: async (url, options) => {
      if (options.method === "PATCH") { writes++; throw new Error("private-token-response"); }
      return response(url.endsWith("/config/auth") ? {} : { id: registry.production.supabaseProjectRef, status: "ACTIVE_HEALTHY" });
    },
  }), (error) => !error.message.includes("private-token-response"));
  assert.equal(writes, 1);
  const api = createAuthApi("staging", environment("staging"), async () => { assert.fail("No network call permitted"); });
  await assert.rejects(api("update", {}));
  await assert.rejects(api("/database/query"));
});

test("Auth summaries report production as blocked and never treat configured SMTP as delivered", () => {
  const summary = summarizeAuth({ ...authPolicy("production"), smtp_host: "smtp.example.test", smtp_port: "587",
    smtp_user: "private-user", smtp_pass: "private-password", smtp_admin_email: "sender@example.test" }, "production");
  assert.equal(summary.customSmtpConfigured, true);
  assert.equal(summary.externalEmailDelivery, "not_verified");
  assert.equal(summary.deploymentEnabled, false);
  assert.equal(summary.smtpDeferred, true);
  assert.doesNotMatch(JSON.stringify(summary), /private-|sender@|smtp\.example/);
});

test("empty successful PATCH responses require read-back rather than an automatic retry", async () => {
  const api = createAuthApi("staging", environment("staging", true), async () => new Response(null, { status: 204 }), { apply: true });
  assert.deepEqual(await api("update", { mailer_autoconfirm: false }), {});
});

test("derived custom-template flags may change only for the exact fields written", () => {
  const before = { smtp_pass: "private-password", disable_signup: true,
    mailer_subjects_custom_contents: { MAILER_SUBJECTS_CONFIRMATION: false, MAILER_SUBJECTS_INVITE: false },
    mailer_templates_custom_contents: { MAILER_TEMPLATES_CONFIRMATION_CONTENT: false, MAILER_TEMPLATES_INVITE_CONTENT: false } };
  const after = { ...before,
    mailer_subjects_custom_contents: { ...before.mailer_subjects_custom_contents, MAILER_SUBJECTS_CONFIRMATION: true },
    mailer_templates_custom_contents: { ...before.mailer_templates_custom_contents, MAILER_TEMPLATES_CONFIRMATION_CONTENT: true } };
  const changes = { mailer_subjects_confirmation: "Confirm", mailer_templates_confirmation_content: "Reviewed template" };
  assert.doesNotThrow(() => assertPreservedAuthSettings(before, after, changes));
  for (const patch of [{ smtp_pass: "different" }, { disable_signup: false },
    { mailer_subjects_custom_contents: { ...after.mailer_subjects_custom_contents, MAILER_SUBJECTS_INVITE: true } },
    { mailer_templates_custom_contents: { ...after.mailer_templates_custom_contents, MAILER_TEMPLATES_INVITE_CONTENT: true } }]) {
    assert.throws(() => assertPreservedAuthSettings(before, { ...after, ...patch }, changes), /AUTH_UNRELATED_CHANGE/);
  }
});

test("a failed read-back cannot be reported as successful or trigger another PATCH", async () => {
  let writes = 0;
  await assert.rejects(configureAuth({ mode: "staging", apply: true, env: environment("staging", true), retainSnapshot: async () => {},
    fetcher: async (url, options) => {
      if (options.method === "PATCH") { writes++; return new Response(null, { status: 204 }); }
      return response(url.endsWith("/config/auth") ? {} : { id: registry.staging.supabaseProjectRef, status: "ACTIVE_HEALTHY" });
    },
  }), /AUTH_READBACK_MISMATCH/);
  assert.equal(writes, 1);
});
