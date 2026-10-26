import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { registry, vercelApi } from "./vercel.mjs";
import { assertStagingProject } from "./staging.mjs";
import { testStagingPrivateUploads } from "./staging-uploads.mjs";

const origin = registry.staging.appOrigin;
const database = `https://${registry.staging.supabaseProjectRef}.supabase.co`;
const roles = ["admin", "pending", "seller", "buyer", "suspended"];
const root = fileURLToPath(new URL("../../", import.meta.url));

export function validateSmokeInput(input) {
  assert.deepEqual(Object.keys(input).sort(), ["accounts", "bypassSecret", "deploymentId", "publishableKey", "sha"].sort());
  assert.match(input.sha, /^[a-f0-9]{40}$/);
  assert.match(input.deploymentId, /^dpl_[a-zA-Z0-9]+$/);
  assert.ok(typeof input.bypassSecret === "string" && input.bypassSecret.length >= 16);
  assert.deepEqual(Object.keys(input.accounts).sort(), [...roles].sort());
  for (const role of roles) assert.ok(typeof input.accounts[role] === "string" && input.accounts[role].length >= 24);
  assert.equal(new Set(Object.values(input.accounts)).size, roles.length);
  assert.ok(/^sb_publishable_[\w-]{20,}$/.test(input.publishableKey) || (() => {
    try {
      const claims = JSON.parse(Buffer.from(input.publishableKey.split(".")[1], "base64url").toString("utf8"));
      return claims.role === "anon" && claims.ref === registry.staging.supabaseProjectRef;
    } catch { return false; }
  })());
}

export function protectedRequestHeaders(url, headers, bypassSecret) {
  const safe = { ...headers };
  delete safe["x-vercel-protection-bypass"];
  if (new URL(url).origin === origin) safe["x-vercel-protection-bypass"] = bypassSecret;
  return safe;
}

async function main() {
  assert.equal(process.argv.length, 2);
  let raw = "";
  for await (const chunk of process.stdin) { raw += chunk; assert.ok(raw.length < 20_000); }
  const input = JSON.parse(raw);
  validateSmokeInput(input);
  const team = `teamId=${registry.staging.vercelTeamId}`;
  const project = vercelApi(`/v9/projects/${registry.staging.vercelProjectId}?${team}`);
  assertStagingProject(project, { linked: true });
  const deployment = vercelApi(`/v13/deployments/${input.deploymentId}?${team}`);
  assert.equal(deployment.projectId, project.id);
  assert.equal(deployment.readyState, "READY");
  assert.equal(deployment.meta?.githubCommitSha, input.sha);
  assert.equal(project.targets?.production?.id, deployment.id, "Smoke must test the canonical deployment, not an older alias.");
  let checks = 0, phase = "HTTPS and hosting protection", browser, client, summary, uploads;
  const contexts = [];
  const failureCounts = { browserErrors: 0, hydrationErrors: 0, serverErrors: 0, productionRequests: 0 };
  const check = (condition) => { assert.ok(condition); checks += 1; };
  try {
    for (const target of [origin, `https://${deployment.url}`]) {
      const response = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
      check([401, 403].includes(response.status) || (response.status >= 300 && response.status < 400
        && /vercel\.com/.test(response.headers.get("location") ?? "")));
      await response.body?.cancel();
    }
    client = createClient(database, input.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const signIn = await client.auth.signInWithPassword({ email: "staging-buyer@example.test", password: input.accounts.buyer });
    check(!signIn.error && Boolean(signIn.data.session));
    check(signIn.data.user?.app_metadata?.staging_fixture === "uc-marketplace-staging-v1");
    const listing = await client.from("listings").select("id,title").eq("title", "STAGING TEST calculator").single();
    const conversation = await client.from("conversations").select("id").eq("listing_id", listing.data?.id ?? "").single();
    const reservation = await client.from("reservations").select("id").eq("listing_id", listing.data?.id ?? "").eq("buyer_id", signIn.data.user.id).single();
    check(!listing.error && !conversation.error && !reservation.error);
    const fixtureId = listing.data.id;
    browser = await chromium.launch({ headless: true });
    async function session() {
      const context = await browser.newContext({ baseURL: origin, serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
      contexts.push(context);
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.hostname.endsWith(".supabase.co") && url.origin !== database) {
          failureCounts.productionRequests += 1;
          await route.abort();
        } else await route.continue({ headers: protectedRequestHeaders(request.url(), request.headers(), input.bypassSecret) });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
      page.setDefaultNavigationTimeout(45_000);
      page.on("pageerror", () => { failureCounts.browserErrors += 1; });
      page.on("console", (message) => { if (/hydration|hydrating|did not match/i.test(message.text())) failureCounts.hydrationErrors += 1; });
      page.on("response", (response) => { if (new URL(response.url()).origin === origin && response.status() >= 500) failureCounts.serverErrors += 1; });
      return page;
    }
    async function visit(page, route, expectedPath = new URL(route, origin).pathname) {
      const response = await page.goto(route);
      check(response?.status() === 200);
      check(new URL(page.url()).origin === origin && new URL(page.url()).pathname === expectedPath);
      check((response.headers()["x-robots-tag"] ?? "").includes("noindex"));
      check(await page.locator("h1").first().isVisible());
      check(await page.locator("main [role=alert]").count() === 0);
      if (route !== "/") check((response.headers()["cache-control"] ?? "").includes("no-store"));
    }
    phase = "anonymous pages and callback handlers";
    const anonymous = await session();
    for (const route of ["/", "/login", "/register", "/forgot-password"]) await visit(anonymous, route);
    for (const route of ["/marketplace", "/sell", "/favorites", "/messages", "/reservations", "/profile", "/verification", "/admin", "/admin/users", "/admin/listings", "/admin/reports"]) {
      await visit(anonymous, route, "/login");
    }
    for (const route of ["/auth/confirm", "/auth/recovery"]) {
      const response = await anonymous.request.head(route, { headers: { "x-vercel-protection-bypass": input.bypassSecret }, maxRedirects: 0 });
      check(response.status() === 405);
      check(response.headers()["referrer-policy"] === "no-referrer");
    }
    for (const [route, destination] of [["/auth/confirm?type=email&type=recovery", "/login?confirmation=failed"],
      ["/auth/recovery?error=access_denied", "/reset-password?error=invalid"]]) {
      const response = await anonymous.request.get(route, { headers: { "x-vercel-protection-bypass": input.bypassSecret }, maxRedirects: 0 });
      check(response.status() === 307 && response.headers().location === destination);
      check((response.headers()["cache-control"] ?? "").includes("no-store"));
    }
    phase = "authenticated SSR, Server Actions and role isolation";
    for (const role of roles) {
      const page = await session();
      await page.goto("/login");
      await page.getByLabel("Email address", { exact: true }).fill(`staging-${role}@example.test`);
      await page.getByLabel("Password", { exact: true }).fill(input.accounts[role]);
      await page.getByRole("button", { name: "Log In", exact: true }).click();
      const destination = role === "admin" ? "/admin/verifications" : role === "pending" ? "/verification"
        : role === "suspended" ? "/account-status" : "/marketplace";
      await page.waitForURL((url) => url.origin === origin && url.pathname === destination);
      check((await page.context().cookies()).some((cookie) => cookie.name.startsWith(`sb-${registry.staging.supabaseProjectRef}-auth-token`)
        && cookie.secure && cookie.sameSite === "Lax"));
      await visit(page, "/profile");
      check(await page.locator("h1").filter({ hasText: `STAGING TEST ${role}` }).count() === 1);
      await page.reload();
      check(await page.locator("h1").filter({ hasText: `STAGING TEST ${role}` }).count() === 1);
      if (role === "admin") {
        for (const route of ["/admin", "/admin/users", "/admin/listings", "/admin/reports", "/admin/verifications"]) await visit(page, route);
      } else if (["seller", "buyer"].includes(role)) {
        for (const route of ["/marketplace", "/marketplace?search=STAGING&condition=good&sort=price-asc", "/sell", "/my-listings",
          "/favorites", "/messages", `/messages/${conversation.data.id}`, "/reservations", `/reservations/${reservation.data.id}`,
          "/profile/edit", "/notifications", `/listing/${fixtureId}`]) await visit(page, route);
        const image = page.locator("main img").first();
        await image.waitFor({ state: "visible" });
        await page.waitForFunction(() => [...document.querySelectorAll("main img")].some((image) => image.complete && image.naturalWidth > 0));
        checks += 1;
        for (const route of ["/admin", "/admin/users", "/admin/listings", "/admin/reports"]) await visit(page, route, "/marketplace");
      } else {
        for (const route of ["/marketplace", "/sell", "/messages", "/reservations", "/admin"]) await visit(page, route, destination);
      }
      if (role === "seller") {
        phase = "synthetic private 5 MiB uploads and listing edit";
        uploads = await testStagingPrivateUploads(page, input, check);
        phase = "authenticated SSR, Server Actions and role isolation";
      }
      await page.getByRole("button", { name: "Log Out", exact: true }).first().click();
      await page.waitForURL((url) => url.origin === origin && url.pathname === "/login");
      await visit(page, "/profile", "/login");
    }
    check(Object.values(failureCounts).every((count) => count === 0));
    summary = { status: "passed", sha: input.sha, deploymentId: input.deploymentId, origin,
      checks, roles: roles.length, failureCounts, uploads, executedAt: new Date().toISOString(), externalEmailDelivery: "not_run", productionDeploymentEnabled: false };
  } catch {
    console.log(JSON.stringify({ status: "failed", phase, checks, failureCounts, privateDetailsWithheld: true, productionDeploymentEnabled: false }));
    process.exitCode = 1;
  } finally {
    const result = await client?.auth.signOut({ scope: "local" });
    if (result?.error) process.exitCode = 1;
    for (const context of contexts) {
      // An assertion may interrupt a role before its UI logout. Revoke only
      // that browser's own staging session; never global/admin sign-out.
      const name = `sb-${registry.staging.supabaseProjectRef}-auth-token`;
      const cookies = (await context.cookies(origin)).filter((cookie) => cookie.name === name || cookie.name.startsWith(`${name}.`));
      const serialized = cookies.find((cookie) => cookie.name === name)?.value
        ?? cookies.sort((a, b) => Number(a.name.slice(name.length + 1)) - Number(b.name.slice(name.length + 1))).map((cookie) => cookie.value).join("");
      if (serialized.startsWith("base64-")) {
        const session = JSON.parse(Buffer.from(serialized.slice(7), "base64url").toString("utf8"));
        if (typeof session.access_token === "string") {
          const response = await fetch(`${database}/auth/v1/logout?scope=local`, { method: "POST", redirect: "error",
            signal: AbortSignal.timeout(20_000), headers: { apikey: input.publishableKey, Authorization: `Bearer ${session.access_token}` } });
          if (!response.ok && response.status !== 401) process.exitCode = 1;
          await response.body?.cancel();
        }
      }
      await context.close();
    }
    await browser?.close();
  }
  if (summary && !process.exitCode) {
    await mkdir(path.join(root, ".qa"), { recursive: true });
    await writeFile(path.join(root, ".qa", `staging-hosted-smoke-${input.sha}.json`), JSON.stringify(summary));
    console.log(JSON.stringify(summary));
  } else if (summary) {
    console.log("Hosted checks passed but owned-session cleanup did not; acceptance is incomplete.");
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch {
    console.log("Hosted staging smoke could not start; private details withheld. No production or email test was requested.");
    process.exitCode = 1;
  }
}
