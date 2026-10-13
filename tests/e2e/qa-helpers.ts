import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Browser, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";

import type { Database } from "@/types/database";

export const qaRoles = ["ADMIN", "SELLER", "BUYER", "SUSPENDED", "PENDING", "REJECTED", "COMPETITOR"] as const;
export type QaRole = typeof qaRoles[number];
export type QaAccount = { role: QaRole; email: string; password: string; id: string };
export type QaSession = { account: QaAccount; api: SupabaseClient<Database>; context: BrowserContext; page: Page; errors: string[] };

// A real, decodable PNG fixture; not school ID evidence or production content.
export const qaImage = {
  name: "isolated-qa-image.png",
  mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgsFjxHwAC/AHgoLvpmAAAAABJRU5ErkJggg==", "base64"),
};

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Authenticated QA is unrun, not a passing release gate.`);
  return value;
}

export function qaEnvironment() {
  if (process.env.QA_BROWSER_ALLOW_MUTATIONS !== "1") {
    throw new Error("Set QA_BROWSER_ALLOW_MUTATIONS=1 only for disposable accounts in an isolated QA database.");
  }
  const appURL = required("QA_APP_BASE_URL");
  const supabaseURL = required("QA_SUPABASE_URL");
  for (const [name, value] of [["QA_APP_BASE_URL", appURL], ["QA_SUPABASE_URL", supabaseURL]]) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      throw new Error(`${name} must be a dedicated loopback QA target; hosted-project mutations are not supported.`);
    }
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error(`${name} must contain only an origin.`);
    }
  }
  const key = required("QA_SUPABASE_PUBLISHABLE_KEY");
  if (!key.startsWith("sb_publishable_")) {
    let role: unknown;
    try { role = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role; } catch { /* Invalid keys are rejected below. */ }
    if (role !== "anon") throw new Error("QA_SUPABASE_PUBLISHABLE_KEY must be a publishable/anon key, never a service-role key.");
  }
  const accounts = Object.fromEntries(qaRoles.map((role) => {
    const account = {
      role, email: required(`QA_${role}_EMAIL`), password: required(`QA_${role}_PASSWORD`), id: required(`QA_${role}_ID`),
    };
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(account.id)) {
      throw new Error(`QA_${role}_ID must identify a dedicated QA account.`);
    }
    return [role, account];
  })) as Record<QaRole, QaAccount>;
  if (new Set(qaRoles.map((role) => accounts[role].id)).size !== qaRoles.length) {
    throw new Error("Each QA permission state needs a separate account and browser context.");
  }
  return { appURL, supabaseURL, key, accounts };
}

export async function openQaSession(browser: Browser, role: QaRole): Promise<QaSession> {
  const environment = qaEnvironment();
  const account = environment.accounts[role];
  const api = createClient<Database>(environment.supabaseURL, environment.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await api.auth.signInWithPassword({ email: account.email, password: account.password });
  expect(Boolean(result.error), `${role} fixture Auth login must succeed`).toBe(false);
  expect(result.data.user?.id, `${role} login must match its dedicated fixture`).toBe(account.id);
  const profile = await api.from("profiles").select("id,role,verification_status,account_status").eq("id", account.id).single();
  expect(Boolean(profile.error), `${role} own profile must be readable`).toBe(false);
  expect(profile.data?.role).toBe(role === "ADMIN" ? "admin" : "student");
  expect(profile.data?.account_status).toBe(role === "SUSPENDED" ? "suspended" : "active");
  expect(profile.data?.verification_status).toBe(role === "PENDING" ? "pending" : role === "REJECTED" ? "rejected" : "verified");

  const context = await browser.newContext({ baseURL: environment.appURL, viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(redactQaSecrets(error.message)));
  try {
    await loginQaSession(page, account);
    return { account, api, context, page, errors };
  } catch (error) {
    await context.close();
    await api.auth.signOut({ scope: "local" });
    throw error;
  }
}

export async function loginQaSession(page: Page, account: QaAccount) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  // This catches a stale build wired to a different project before any workflow
  // mutation. No credentials are stored in browser state files.
  const project = new URL(required("QA_SUPABASE_URL")).hostname.split(".")[0];
  const cookies = await page.context().cookies();
  expect(cookies.some((cookie) => cookie.name.startsWith(`sb-${project}-auth-token`)), "Application must use the explicitly configured QA Auth project").toBe(true);
}

export async function closeQaSessions(sessions: QaSession[]) {
  for (const session of sessions) {
    await session.context.close();
    await session.api.auth.signOut({ scope: "local" });
  }
}

export async function confirmAction(page: Page, name: string) {
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name, exact: true }).click();
}

export async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
}

export async function expectDialogWithinViewport(dialog: Locator) {
  const dimensions = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
    };
  });
  expect(dimensions.top, "Dialog must remain inside the visible viewport").toBeGreaterThanOrEqual(0);
  expect(dimensions.left).toBeGreaterThanOrEqual(0);
  expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.viewportHeight + 1);
  expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

// Hold a real, identified mutation before forwarding it to the real application.
// Auth, reads, and unrelated Server Actions continue normally; no response is
// fabricated and no request bodies or credentials are retained in artifacts.
export async function holdQaMutation(page: Page, pathname: string, marker: string) {
  const appOrigin = new URL(qaEnvironment().appURL).origin;
  const matchURL = (url: URL) => url.origin === appOrigin && url.pathname === pathname;
  let requestCount = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const handler = async (route: Route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"] || !request.postData()?.includes(marker)) {
      await route.continue();
      return;
    }
    requestCount += 1;
    await released;
    await route.continue();
  };
  await page.context().route(matchURL, handler);
  return {
    get requestCount() { return requestCount; },
    release,
    async dispose() {
      release();
      await page.context().unroute(matchURL, handler);
    },
  };
}

export async function moderate(page: Page, trigger: string, dialogName: RegExp, fieldLabel: string, note: string) {
  await page.getByRole("button", { name: trigger, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(fieldLabel, { exact: true }).fill(note);
  await dialog.getByRole("button", { name: trigger, exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

function redactQaSecrets(message: string) {
  let safe = message;
  for (const [name, value] of Object.entries(process.env)) {
    if (value && /(?:PASSWORD|SECRET|TOKEN|KEY)/.test(name)) safe = safe.replaceAll(value, "[redacted]");
  }
  return safe;
}
