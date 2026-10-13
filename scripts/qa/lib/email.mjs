import { randomBytes } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { assertRunEmail, createMailpitCapture, validateLocalEmailOrigin } from "./mailpit.mjs";

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const check = (condition, message) => { if (!condition) throw new Error(message); };

export function isExpectedEmailAuthDenial(result, code) {
  return result?.error?.code === code && [400, 401, 403, 422].includes(result.error.status)
    && !result?.data?.session && !result?.data?.user;
}

function safeAuthCode(error) {
  return typeof error?.code === "string" && /^[a-z_]{1,40}$/.test(error.code) ? error.code : "service_error";
}

export async function callEmailAuth(operation, label) {
  let result;
  try { result = await operation(); }
  catch { throw new Error(`${label} failed (service_error).`); }
  return result;
}

function requireAuth(result, label) {
  if (result?.error) throw new Error(`${label} failed (${safeAuthCode(result.error)}).`);
  check(result?.error === null, `${label} returned no valid Auth result.`);
  // signOut returns { error }, while the other SDK operations include data.
  return result.data ?? {};
}

function decodeHtml(value) {
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, digits) => {
    const point = digits[0].toLowerCase() === "x" ? Number.parseInt(digits.slice(1), 16) : Number(digits);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  }).replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ");
}

/** Extract only the credential delivered by SMTP; never manufacture a link. */
export function extractEmailCredential(message, { purpose, email, supabaseUrl, appBaseUrl, confirmationMode = "code", otpLength = 8 }) {
  const authOrigin = validateLocalEmailOrigin(supabaseUrl, "Email Auth");
  const appOrigin = validateLocalEmailOrigin(appBaseUrl, "Email application");
  check(["signup", "recovery"].includes(purpose) && ["code", "link"].includes(confirmationMode), "Email acceptance requires a supported workflow and confirmation mode.");
  const text = [message?.Text, typeof message?.HTML === "string" ? message.HTML.replace(/<[^>]*>/g, " ") : ""]
    .filter((value) => typeof value === "string").map(decodeHtml).join("\n");
  if (purpose === "signup" && confirmationMode === "code") {
    check(otpLength === 8, "The application requires eight-digit signup codes.");
    const codes = [...new Set([...text.matchAll(/(?<!\d)\d{8}(?!\d)/g)].map((match) => match[0]))];
    check(codes.length === 1, "The captured signup message must contain exactly one eight-digit code.");
    return { email, token: codes[0], type: "email" };
  }
  const contents = decodeHtml([message?.Text, message?.HTML].filter((value) => typeof value === "string").join("\n"));
  const urls = [...new Set([...contents.matchAll(/https?:\/\/[^\s<>"']+/g)].map((match) => match[0]))];
  const credentials = [];
  for (const value of urls) {
    let url;
    try { url = new URL(value); } catch { continue; }
    const type = url.searchParams.get("type");
    if (purpose === "recovery" ? type !== "recovery" : !["email", "signup"].includes(type)) continue;
    const token = url.searchParams.get("token_hash") ?? url.searchParams.get("token");
    if (!token) continue;
    check(["type", "token", "token_hash", "redirect_to"].every((key) => url.searchParams.getAll(key).length <= 1)
      && !(url.searchParams.has("token_hash") && url.searchParams.has("token")), "Captured Auth links must contain unambiguous verification parameters.");
    const callbackPath = purpose === "recovery" ? "/auth/recovery" : "/auth/confirm";
    const authLink = url.origin === authOrigin && url.pathname === "/auth/v1/verify";
    const appLink = url.origin === appOrigin && url.pathname === callbackPath && url.searchParams.has("token_hash");
    check(!url.username && !url.password && !url.hash && (authLink || appLink), "Captured Auth links must point to the explicit local QA Auth or application callback.");
    check(/^[A-Za-z0-9_-]{20,4096}$/.test(token), "Captured Auth links require a bounded opaque token hash.");
    if (authLink) {
      const redirect = url.searchParams.get("redirect_to");
      check(redirect === `${appOrigin}${callbackPath}`, "Captured Auth links must redirect to the explicit QA application callback.");
    }
    credentials.push({ token_hash: token, type });
  }
  const distinct = [...new Map(credentials.map((credential) => [JSON.stringify(credential), credential])).values()];
  check(distinct.length === 1, "The captured message must contain exactly one matching local Auth link.");
  return distinct[0];
}

/** API acceptance of real local SMTP signup and recovery, separate from UI QA. */
export async function runEmailChecks(context, {
  createSignupFixture,
  mailpitUrl = context.config.mailpitUrl,
  confirmationMode = context.config.emailConfirmationMode ?? "code",
  testCodeExpiry = confirmationMode === "code",
  otpExpirySeconds = 60,
  wait = pause,
  capture = null,
  createPublicClient = () => createClient(context.config.supabaseUrl, context.config.publishableKey, clientOptions),
} = {}) {
  validateLocalEmailOrigin(context.config.supabaseUrl, "Email Auth");
  validateLocalEmailOrigin(context.config.appBaseUrl, "Email application");
  validateLocalEmailOrigin(mailpitUrl, "Mailpit");
  check(typeof createSignupFixture === "function", "Email acceptance requires the run-owned normal signup fixture helper.");
  check(["code", "link"].includes(confirmationMode), "Email acceptance requires an explicit signup confirmation mode.");
  check(!testCodeExpiry || (confirmationMode === "code" && Number.isInteger(otpExpirySeconds) && otpExpirySeconds >= 1 && otpExpirySeconds <= 60), "Code expiry acceptance requires code mode and an explicit local OTP expiry of at most 60 seconds.");
  const inbox = capture ?? createMailpitCapture({ url: mailpitUrl, runId: context.runId });
  let account;
  let count = 0;
  try {
    const created = await callEmailAuth(() => createSignupFixture(context, { confirmationMode }), "Email signup fixture");
    account = created?.account;
    const signupData = created?.signupData;
    check(Boolean(account?.id && account?.client && Object.values(context.accounts).includes(account)), "Email signup fixture must be recorded for run-scoped cleanup before acceptance.");
    assertRunEmail(account.email, context.runId);
    check(signupData?.user?.id === account.id && !signupData.session && !signupData.user.email_confirmed_at, "Normal signup must remain unconfirmed without an authenticated session.");
    count += 1;
    const pending = await callEmailAuth(() => account.client.auth.signInWithPassword({ email: account.email, password: account.password }), "Pending signup login");
    check(isExpectedEmailAuthDenial(pending, "email_not_confirmed"), "Pending signup must be denied specifically because email is unconfirmed.");
    count += 1;
    let signupMessage = await inbox.waitForMessage({ email: account.email });
    const credentialOptions = { purpose: "signup", email: account.email, supabaseUrl: context.config.supabaseUrl, appBaseUrl: context.config.appBaseUrl, confirmationMode };
    let signupCredential = extractEmailCredential(signupMessage, credentialOptions);
    if (testCodeExpiry) {
      console.log("Email QA is waiting for the local signup OTP to expire before testing denial and resend.");
      // The local config also throttles resend for 60 seconds. Split waits so a
      // caller can report progress while the real server clock advances.
      let remaining = Math.max(otpExpirySeconds * 1000 + 2000, 62000);
      while (remaining > 0) {
        const duration = Math.min(remaining, 30000);
        await wait(duration);
        remaining -= duration;
      }
      const expired = await callEmailAuth(() => createPublicClient().auth.verifyOtp(signupCredential), "Expired signup code");
      check(isExpectedEmailAuthDenial(expired, "otp_expired"), "An expired signup code must be denied specifically as an expired or invalid OTP.");
      count += 1;
      const beforeResend = await inbox.snapshot(account.email);
      requireAuth(await callEmailAuth(() => account.client.auth.resend({ type: "signup", email: account.email }), "SMTP signup resend"), "SMTP signup resend");
      signupMessage = await inbox.waitForMessage({ email: account.email, afterIds: beforeResend });
      signupCredential = extractEmailCredential(signupMessage, credentialOptions);
      count += 1;
    }
    const confirmation = requireAuth(await callEmailAuth(() => account.client.auth.verifyOtp(signupCredential), "SMTP signup confirmation"), "SMTP signup confirmation");
    check(confirmation.user?.id === account.id && confirmation.user.email_confirmed_at && confirmation.session, "SMTP signup confirmation must confirm this fixture and establish its session.");
    requireAuth(await callEmailAuth(() => account.client.auth.signOut({ scope: "local" }), "Confirmation sign-out"), "Confirmation sign-out");
    count += 1;
    const replayClient = createPublicClient();
    const replay = await callEmailAuth(() => replayClient.auth.verifyOtp(signupCredential), "Signup confirmation replay");
    check(isExpectedEmailAuthDenial(replay, "otp_expired"), "A consumed signup confirmation must be rejected as an expired or invalid OTP.");
    count += 1;
    const login = requireAuth(await callEmailAuth(() => account.client.auth.signInWithPassword({ email: account.email, password: account.password }), "Confirmed signup login"), "Confirmed signup login");
    check(login.user?.id === account.id && login.session, "Confirmed signup must allow password login for this fixture.");
    requireAuth(await callEmailAuth(() => account.client.auth.signOut({ scope: "local" }), "Signup login sign-out"), "Signup login sign-out");
    count += 1;

    const beforeRecovery = await inbox.snapshot(account.email);
    const recoveryClient = createPublicClient();
    requireAuth(await callEmailAuth(() => recoveryClient.auth.resetPasswordForEmail(account.email, { redirectTo: `${context.config.appBaseUrl}/auth/recovery` }), "SMTP recovery request"), "SMTP recovery request");
    const recoveryMessage = await inbox.waitForMessage({ email: account.email, afterIds: beforeRecovery });
    const recoveryCredential = extractEmailCredential(recoveryMessage, { purpose: "recovery", email: account.email, supabaseUrl: context.config.supabaseUrl, appBaseUrl: context.config.appBaseUrl, confirmationMode });
    const recovery = requireAuth(await callEmailAuth(() => recoveryClient.auth.verifyOtp(recoveryCredential), "SMTP recovery verification"), "SMTP recovery verification");
    check(recovery.user?.id === account.id && recovery.session, "SMTP recovery must establish this fixture's session.");
    const claims = requireAuth(await callEmailAuth(() => recoveryClient.auth.getClaims(), "Recovery claims"), "Recovery claims");
    // Direct verifyOtp records the OTP authentication method, including when
    // the delivered token is explicitly typed recovery. This API check does
    // not establish the application's HTTP-only recovery marker or PKCE flow.
    check(claims.claims?.sub === account.id && Array.isArray(claims.claims.amr) && claims.claims.amr.some((method) => method?.method === "otp"), "SMTP recovery token verification must establish this fixture's OTP session.");
    count += 1;
    const recoveryReplay = await callEmailAuth(() => createPublicClient().auth.verifyOtp(recoveryCredential), "Recovery link replay");
    check(isExpectedEmailAuthDenial(recoveryReplay, "otp_expired"), "A consumed password recovery link must be rejected as an expired or invalid OTP.");
    count += 1;
    const oldPassword = account.password;
    const newPassword = `Qa!${randomBytes(24).toString("base64url")}9Zz`;
    const updated = requireAuth(await callEmailAuth(() => recoveryClient.auth.updateUser({ password: newPassword }), "Recovery password change"), "Recovery password change");
    check(updated.user?.id === account.id, "Recovery password update must affect only this fixture.");
    account.password = newPassword;
    requireAuth(await callEmailAuth(() => recoveryClient.auth.signOut({ scope: "local" }), "Recovery sign-out"), "Recovery sign-out");
    count += 1;
    const oldLogin = await callEmailAuth(() => createPublicClient().auth.signInWithPassword({ email: account.email, password: oldPassword }), "Old password login");
    check(isExpectedEmailAuthDenial(oldLogin, "invalid_credentials"), "The old password must be denied specifically as invalid credentials after recovery.");
    count += 1;
    const newLogin = requireAuth(await callEmailAuth(() => account.client.auth.signInWithPassword({ email: account.email, password: newPassword }), "New password login"), "New password login");
    check(newLogin.user?.id === account.id && newLogin.session, "The new recovered password must allow login for this fixture.");
    count += 1;
    console.log(capture
      ? `Email QA orchestration passed ${count} Auth checks with an injected test capture. Live SMTP and external delivery were not tested.`
      : `Email QA passed ${count} Auth checks using real messages captured by local SMTP. External email delivery was not tested.`);
    return count;
  } finally {
    await inbox.deleteCapturedMessages();
  }
}
