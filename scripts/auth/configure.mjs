import { readFile, mkdir, lstat, realpath, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PASSWORD_MIN_LENGTH, SUPABASE_PASSWORD_CHARACTERS } from "../../src/lib/auth/password-policy.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const registry = JSON.parse(await readFile(path.join(root, "config/environments.json"), "utf8"));
export const contact = JSON.parse(await readFile(path.join(root, "config/authentication.json"), "utf8"));
export const templateFiles = Object.freeze({ confirmation: "confirmation-link.html", recovery: "recovery.html",
  email_change: "email-change.html", reauthentication: "reauthentication.html" });
const subjects = { confirmation: "Confirm your UC Online Shop account", recovery: "Reset your UC Online Shop password",
  email_change: "Confirm your UC Online Shop email change", reauthentication: "Verify your UC Online Shop password change" };

export function validateAuthTarget(mode, env, { apply = false } = {}) {
  if (!["staging", "production"].includes(mode) || registry.production.deploymentEnabled !== false
    || registry.staging.supabaseProjectRef === registry.production.supabaseProjectRef) throw new Error("Invalid pre-release Auth target.");
  const ref = registry[mode].supabaseProjectRef;
  const prefix = mode.toUpperCase();
  if (!/^[a-z]{20}$/.test(ref) || env[`${prefix}_PROJECT_REF`] !== ref
    || typeof env[`${prefix}_MANAGEMENT_TOKEN`] !== "string"
    || !/^sbp_[A-Za-z0-9_-]{20,}$/.test(env[`${prefix}_MANAGEMENT_TOKEN`])) throw new Error("Explicit registered Auth project and private Management token required.");
  if (apply && env.AUTH_SETTINGS_CONFIRM !== `${mode}:${ref}`) throw new Error("Explicit environment-bound Auth settings write confirmation required.");
  return { ref, token: env[`${prefix}_MANAGEMENT_TOKEN`] };
}

export function authPolicy(mode) {
  if (!["staging", "production"].includes(mode)) throw new Error("Invalid Auth environment.");
  const origin = registry[mode].appOrigin;
  return {
    site_url: origin,
    uri_allow_list: `${origin}/auth/confirm,${origin}/auth/recovery`,
    external_email_enabled: true,
    mailer_autoconfirm: false,
    mailer_allow_unverified_email_sign_ins: false,
    mailer_secure_email_change_enabled: true,
    password_min_length: PASSWORD_MIN_LENGTH,
    password_required_characters: SUPABASE_PASSWORD_CHARACTERS,
    security_update_password_require_reauthentication: true,
    refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10,
    jwt_exp: 3600,
    smtp_max_frequency: 60,
    rate_limit_email_sent: 30,
    rate_limit_otp: 30,
    rate_limit_verify: 30,
    rate_limit_token_refresh: 150,
    mailer_otp_length: 8,
    mailer_otp_exp: mode === "staging" ? 60 : 900,
  };
}

export async function authTemplates(mode) {
  if (!["staging", "production"].includes(mode)
    || !/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,63}$/.test(contact.supportEmail)) throw new Error("Approved support contact required.");
  const result = {};
  for (const [purpose, filename] of Object.entries(templateFiles)) {
    const content = await readFile(path.join(root, "supabase/templates", mode === "staging" && purpose === "confirmation" ? "confirmation.html" : filename), "utf8");
    if (!content.includes(`mailto:${contact.supportEmail}`) || !content.includes("UC Online Shop")
      || /__SUPPORT_EMAIL__|{{\s*\.Data|<script\b|<img\b/i.test(content)) throw new Error("Auth template requires review.");
    result[`mailer_subjects_${purpose}`] = subjects[purpose];
    result[`mailer_templates_${purpose}_content`] = content;
  }
  // Invitations are not implemented by the admin UI; keep their draft inactive.
  if (contact.adminInvitationsEnabled !== false) throw new Error("Invitation activation requires a separately reviewed account-onboarding flow.");
  return result;
}

/** Only reviewed fields; preserve already stricter numeric controls. */
export function planAuthSettings(current, desired) {
  const target = { ...desired };
  if (Number.isInteger(current.password_min_length)) target.password_min_length = Math.max(current.password_min_length, target.password_min_length);
  for (const name of ["smtp_max_frequency"]) {
    if (Number.isInteger(current[name]) && current[name] > 0) target[name] = Math.max(current[name], target[name]);
  }
  for (const name of ["jwt_exp", "rate_limit_email_sent", "rate_limit_otp", "rate_limit_verify", "rate_limit_token_refresh", "mailer_otp_exp", "security_refresh_token_reuse_interval"]) {
    if (Number.isInteger(current[name]) && current[name] > 0) target[name] = Math.min(current[name], target[name]);
  }
  // Never permit arbitrary keys even if called by a future operator wrapper.
  const allowed = new Set([...Object.keys(authPolicy("staging")),
    ...Object.keys(templateFiles).flatMap((purpose) => [`mailer_subjects_${purpose}`, `mailer_templates_${purpose}_content`])]);
  if (Object.keys(target).some((name) => !allowed.has(name))) throw new Error("Unreviewed Auth configuration field.");
  return Object.fromEntries(Object.entries(target).filter(([name, value]) => current[name] !== value));
}

export function summarizeAuth(current, mode) {
  const policy = authPolicy(mode);
  const redirects = typeof current.uri_allow_list === "string" ? current.uri_allow_list.split(",").map((item) => item.trim()).sort() : [];
  return {
    mode,
    siteUrlMatches: current.site_url === policy.site_url,
    exactCallbacksOnly: JSON.stringify(redirects) === JSON.stringify(policy.uri_allow_list.split(",").sort()),
    emailPasswordEnabled: current.external_email_enabled === true,
    confirmationsRequired: current.mailer_autoconfirm === false && current.mailer_allow_unverified_email_sign_ins !== true,
    secureEmailChange: current.mailer_secure_email_change_enabled === true,
    passwordMinimumEnforced: Number.isInteger(current.password_min_length) && current.password_min_length >= PASSWORD_MIN_LENGTH,
    passwordCharacterClassesMatch: current.password_required_characters === policy.password_required_characters,
    passwordReauthenticationRequired: current.security_update_password_require_reauthentication === true,
    refreshRotationEnabled: current.refresh_token_rotation_enabled === true,
    signupDisabled: current.disable_signup === true,
    leakedPasswordProtectionEnabled: current.password_hibp_enabled === true,
    extraAuthProvidersEnabled: Object.entries(current).some(([name, value]) => /^external_.*_enabled$/.test(name) && name !== "external_email_enabled" && value === true),
    customSmtpConfigured: ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_admin_email"].every((name) => Boolean(current[name])),
    externalEmailDelivery: "not_verified",
    smtpDeferred: contact.smtpDeferred,
    deploymentEnabled: registry.production.deploymentEnabled,
  };
}

export function createAuthApi(mode, env, fetcher = fetch, { apply = false } = {}) {
  const { ref, token } = validateAuthTarget(mode, env, { apply });
  return async (operation, body) => {
    if (!["project", "read", "update"].includes(operation) || (operation === "update" && !apply)) throw new Error("Auth API operation not authorized.");
    if (operation === "update") {
      const allowed = new Set([...Object.keys(authPolicy(mode)), ...Object.keys(templateFiles).flatMap((purpose) => [`mailer_subjects_${purpose}`, `mailer_templates_${purpose}_content`])]);
      if (!body || Object.keys(body).some((name) => !allowed.has(name))) throw new Error("Auth write contains an unreviewed field.");
    }
    let response;
    try {
      response = await fetcher(`https://api.supabase.com/v1/projects/${ref}${operation === "project" ? "" : "/config/auth"}`, {
        method: operation === "update" ? "PATCH" : "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(operation === "update" ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error();
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error();
      // Some successful settings writes have no response body. Read-back, not
      // a PATCH response payload, decides whether the requested state exists.
      if (operation === "update" && !text.trim()) return {};
      const value = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      return value;
    } catch { throw new Error("Auth management request failed; private responses withheld. Do not retry an ambiguous write automatically."); }
  };
}

/** Supabase exposes derived boolean flags for customized email content. */
export function assertPreservedAuthSettings(before, after, changes) {
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (name in changes || JSON.stringify(before[name]) === JSON.stringify(after[name])) continue;
    if (["mailer_subjects_custom_contents", "mailer_templates_custom_contents"].includes(name)) {
      const previous = before[name];
      const current = after[name];
      if (previous && current && typeof previous === "object" && typeof current === "object"
        && !Array.isArray(previous) && !Array.isArray(current)) {
        const flags = new Set([...Object.keys(previous), ...Object.keys(current)]);
        if ([...flags].every((flag) => typeof current[flag] === "boolean"
          && (previous[flag] === current[flag]
            || (Object.hasOwn(changes, flag.toLowerCase()) && current[flag] === true)))) continue;
      }
    }
    const error = new Error("AUTH_UNRELATED_CHANGE");
    error.changedField = /^[a-z][a-z0-9_]{0,80}$/.test(name) ? name : "unrecognized";
    throw error;
  }
}

export async function retainAuthSnapshot(mode, before, names) {
  const directory = path.join(root, ".qa");
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()
    || await realpath(directory) !== path.join(await realpath(root), ".qa")) throw new Error("Private Auth backup directory must remain in the workspace.");
  const selected = [...names, "mailer_subjects_custom_contents", "mailer_templates_custom_contents"];
  const values = Object.fromEntries(selected.filter((name) => Object.hasOwn(before, name)).map((name) => [name, before[name]]));
  await writeFile(path.join(directory, `auth-settings-before-${mode}-${randomUUID()}.json`), JSON.stringify(values), { flag: "wx", mode: 0o600 });
}

export async function configureAuth({ mode, apply = false, env = process.env, fetcher = fetch, retainSnapshot = retainAuthSnapshot }) {
  const api = createAuthApi(mode, env, fetcher, { apply });
  const project = await api("project");
  if ((project.id ?? project.ref) !== registry[mode].supabaseProjectRef || project.status !== "ACTIVE_HEALTHY") throw new Error("Auth project identity or health check failed.");
  const before = await api("read");
  const desired = { ...authPolicy(mode), ...await authTemplates(mode) };
  const changes = planAuthSettings(before, desired);
  if (apply && Object.keys(changes).length) {
    await retainSnapshot(mode, before, Object.keys(changes));
    // One PATCH, no retry. No SMTP credentials, signup activation, paid feature,
    // provider activation, account changes or deployment settings are written.
    await api("update", changes);
    const after = await api("read");
    if (Object.keys(changes).some((name) => after[name] !== changes[name])) throw new Error("AUTH_READBACK_MISMATCH");
    assertPreservedAuthSettings(before, after, changes);
    return { ...summarizeAuth(after, mode), applied: true, configurationMatches: true, changedFields: Object.keys(changes), emailSent: false };
  }
  return { ...summarizeAuth(before, mode), applied: false, configurationMatches: !Object.keys(changes).length, pendingFields: Object.keys(changes), emailSent: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [operation, mode] = process.argv.slice(2);
    if (process.argv.length !== 4 || !["plan", "apply"].includes(operation)) throw new Error();
    console.log(JSON.stringify(await configureAuth({ mode, apply: operation === "apply" })));
  } catch (error) {
    const code = ["AUTH_READBACK_MISMATCH", "AUTH_UNRELATED_CHANGE"].includes(error?.message) ? error.message : "AUTH_CONFIGURATION_FAILED";
    console.log(JSON.stringify({ failed: true, code, ...(code === "AUTH_UNRELATED_CHANGE" && { changedField: error.changedField }),
      privateDetailsWithheld: true, automaticRetry: false, emailSent: false, deploymentEnabled: false }));
    process.exitCode = 1;
  }
}
