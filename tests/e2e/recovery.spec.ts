import { randomBytes } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { combineChunks, stringFromBase64URL } from "@supabase/ssr";

import { callEmailAuth, extractEmailCredential, isExpectedEmailAuthDenial } from "../../scripts/qa/lib/email.mjs";
import { createMailpitCapture } from "../../scripts/qa/lib/mailpit.mjs";
import { closeQaSessions, openQaSession, qaEnvironment } from "./qa-helpers";

const recoveryCookieName = "uc-marketplace-recovery";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}; browser SMTP recovery acceptance was not run.`);
  return value;
}

function recoveryFixture() {
  const environment = qaEnvironment();
  const email = required("QA_EMAILSIGNUP_EMAIL");
  const id = required("QA_EMAILSIGNUP_ID");
  const password = required("QA_EMAILSIGNUP_PASSWORD");
  const match = /^qa-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-email-signup@example\.test$/.exec(email);
  if (!match || !uuid.test(id) || Object.values(environment.accounts).some((account) => account.id === id)) {
    throw new Error("Browser recovery requires the separate run-owned SMTP signup fixture.");
  }
  expect(process.env.AUTH_RECOVERY_SECRET === undefined, "Browser workers must not receive the application's recovery signing secret").toBe(true);
  return { environment, email, id, password, runId: match[1], mailpitURL: required("QA_MAILPIT_URL") };
}

function publicClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
  });
}

test("a forged legacy recovery cookie cannot authorize an ordinary signed-in browser session", async ({ browser }) => {
  qaEnvironment();
  // The earlier workflow changes the seller's password. The buyer's original
  // credential is unchanged, so this is still a fresh ordinary password login.
  const session = await openQaSession(browser, "BUYER");
  try {
    const environment = qaEnvironment();
    const project = new URL(environment.supabaseURL).hostname.split(".")[0];
    const authCookieName = `sb-${project}-auth-token`;
    const cookies = await session.context.cookies();
    const serialized = await combineChunks(authCookieName, (name) => cookies.find((cookie) => cookie.name === name)?.value);
    expect(Boolean(serialized?.startsWith("base64-")), "The negative test must begin with the application's real password login session").toBe(true);
    const stored = JSON.parse(stringFromBase64URL(serialized!.slice(7)));
    const verified = await callEmailAuth(() => session.api.auth.getClaims(stored.access_token), "Browser password session claims");
    expect(!verified.error && verified.data?.claims?.sub === session.account.id, "The ordinary browser session must belong to the buyer fixture").toBe(true);
    const claims = verified.data?.claims;
    expect(typeof claims?.session_id === "string" && uuid.test(claims.session_id), "The forged negative marker must use the actual browser session identity").toBe(true);
    expect(Array.isArray(claims?.amr) && claims.amr.some((entry: { method?: string }) => entry.method === "password"), "The browser session must have authenticated with a password").toBe(true);
    // This is a deliberately invalid cookie, never a positive recovery grant.
    await session.context.addCookies([{ name: recoveryCookieName, value: `${session.account.id}:${claims.session_id}`, url: environment.appURL, httpOnly: true, sameSite: "Lax" }]);
    await session.page.goto("/reset-password");
    await expect(session.page.getByRole("heading", { name: "Reset link unavailable", exact: true })).toBeVisible();
    await expect(session.page.getByRole("button", { name: "Update Password", exact: true })).toHaveCount(0);
    await session.page.goto("/profile");
    await expect(session.page).toHaveURL(/\/profile(?:\?|$)/);
    expect(session.errors.length, "Forged recovery state must not cause uncaught browser errors").toBe(0);
  } finally {
    await closeQaSessions([session]);
  }
});

test("a real captured SMTP recovery link grants the reset UI and changes the fixture password once", async ({ browser }) => {
  test.setTimeout(240_000);
  const fixture = recoveryFixture();
  const { environment, email, id, password, runId, mailpitURL } = fixture;
  const api = publicClient(environment.supabaseURL, environment.key);
  const inbox = createMailpitCapture({ url: mailpitURL, runId });
  const context = await browser.newContext({ baseURL: environment.appURL, viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  let pageErrors = 0;
  page.on("pageerror", () => { pageErrors += 1; });
  try {
    const initialLogin = await callEmailAuth(() => api.auth.signInWithPassword({ email, password }), "Browser recovery fixture login");
    expect(!initialLogin.error && initialLogin.data?.user?.id === id && initialLogin.data.user.app_metadata.qa_run_id === runId,
      "The SMTP fixture must be confirmed and carry its trusted QA run ownership marker").toBe(true);
    const initialSignOut = await callEmailAuth(() => api.auth.signOut({ scope: "local" }), "Browser recovery fixture sign-out");
    expect(initialSignOut.error === null, "Initial fixture login must end before requesting recovery").toBe(true);
    const beforeRecovery = await inbox.snapshot(email);
    const deadline = Date.now() + 65_000;
    while (true) {
      const reset = await callEmailAuth(() => api.auth.resetPasswordForEmail(email, { redirectTo: `${environment.appURL}/auth/recovery` }), "Browser SMTP recovery request");
      if (!reset.error) break;
      if (reset.error.code !== "over_email_send_rate_limit" || reset.error.status !== 429 || Date.now() >= deadline) {
        throw new Error("The real browser SMTP recovery request failed; acceptance was not obtained.");
      }
      // Only the known per-address email throttle is retried. Auth outages and
      // other errors fail instead of being treated as expected recovery state.
      await pause(Math.min(15_000, deadline - Date.now()));
    }
    const message = await inbox.waitForMessage({ email, afterIds: beforeRecovery });
    const credential = extractEmailCredential(message, { purpose: "recovery", email, supabaseUrl: environment.supabaseURL, appBaseUrl: environment.appURL, confirmationMode: "code" });
    if (!("token_hash" in credential) || credential.type !== "recovery") throw new Error("The captured recovery message did not contain the expected typed recovery link.");
    const recoveryURL = new URL("/auth/recovery", environment.appURL);
    recoveryURL.searchParams.set("token_hash", credential.token_hash);
    recoveryURL.searchParams.set("type", "recovery");
    // The credential came from the real message; the application redeems it.
    await page.goto(recoveryURL.href);
    await expect(page).toHaveURL(/\/reset-password$/);
    expect(new URL(page.url()).origin, "Auth callbacks must preserve the browser origin and host-only cookies").toBe(environment.appURL);
    await expect(page.getByRole("heading", { name: "Choose a new password", exact: true })).toBeVisible();
    const marker = (await context.cookies()).find((cookie) => cookie.name === recoveryCookieName);
    expect(Boolean(marker && marker.httpOnly && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(marker.value)),
      "The actual application must issue its signed HTTP-only recovery grant").toBe(true);
    for (const route of ["/profile", "/marketplace", "/admin/verifications"]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/reset-password$/);
      await expect(page.getByRole("button", { name: "Update Password", exact: true })).toBeVisible();
    }

    const replay = await browser.newContext({ baseURL: environment.appURL, serviceWorkers: "block" });
    try {
      const replayPage = await replay.newPage();
      await replayPage.goto(recoveryURL.href);
      await expect(replayPage).toHaveURL(/\/reset-password\?error=invalid$/);
      expect(new URL(replayPage.url()).origin, "Invalid callbacks must also preserve the browser origin").toBe(environment.appURL);
      await expect(replayPage.getByRole("heading", { name: "Reset link unavailable", exact: true })).toBeVisible();
      expect((await replay.cookies()).some((cookie) => cookie.name === recoveryCookieName), "A consumed recovery link must not issue another app grant").toBe(false);
    } finally { await replay.close(); }

    const newPassword = `Qa!${randomBytes(24).toString("base64url")}9Zz`;
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Update Password", exact: true }).click();
    await expect(page).toHaveURL(/\/login\?passwordUpdated=success$/);
    expect((await context.cookies()).some((cookie) => cookie.name === recoveryCookieName), "Password completion must remove the application recovery grant").toBe(false);
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "Reset link unavailable", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Update Password", exact: true })).toHaveCount(0);

    const oldLogin = await callEmailAuth(() => api.auth.signInWithPassword({ email, password }), "Browser recovery old password login");
    expect(isExpectedEmailAuthDenial(oldLogin, "invalid_credentials"), "The old password must specifically fail as invalid credentials").toBe(true);
    const newLogin = await callEmailAuth(() => api.auth.signInWithPassword({ email, password: newPassword }), "Browser recovery new password login");
    expect(!newLogin.error && newLogin.data?.user?.id === id && Boolean(newLogin.data.session), "The password submitted through the reset UI must allow real Auth login").toBe(true);
    expect(pageErrors, "The real recovery browser flow must not produce uncaught page errors").toBe(0);
  } finally {
    await context.close();
    await callEmailAuth(() => api.auth.signOut({ scope: "local" }), "Browser recovery cleanup sign-out");
    await inbox.deleteCapturedMessages();
  }
});
