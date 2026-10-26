import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect as baseExpect, devices } from "@playwright/test";
import axe from "axe-core";
import { staging } from "./lib.mjs";
import { protectedRequestHeaders } from "../deployment/staging-smoke.mjs";
import { QA_IMAGE, requireResult } from "../qa/lib/fixtures.mjs";
import { isInvisibleDataResult, isExpectedStorageDenial, isExpectedDataDenial } from "../qa/lib/api-results.mjs";
import { accessibilityCounts } from "./e2e-policy.mjs";

const image = { name: "synthetic.png", mimeType: "image/png", buffer: QA_IMAGE };
const largeImage = { ...image, name: "synthetic-5mb.png", buffer: Buffer.concat([QA_IMAGE, Buffer.alloc(5 * 1024 * 1024 - QA_IMAGE.length)]) };
const origin = staging.appOrigin;
const database = `https://${staging.supabaseProjectRef}.supabase.co`;
const expect = baseExpect.configure({ timeout: 30_000 });

export async function runHostedBrowsers(context, bypassSecret, evidence, phase, signal) {
  const browser = await chromium.launch({ headless: true });
  const sessions = [];
  const check = (value) => { assert.ok(value); evidence.browserChecks++; };
  const expectChecked = async (assertion) => { await assertion; evidence.browserChecks++; };
  const abort = () => { void browser.close().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  async function open(role, mobile = false) {
    const account = context.accounts[role];
    const browserContext = await browser.newContext({ ...(mobile ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } }), baseURL: origin, serviceWorkers: "block" });
    const session = { account, context: browserContext, page: null };
    sessions.push(session);
    await browserContext.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname.endsWith(".supabase.co") && url.origin !== database) {
        evidence.failures.crossEnvironment++; await route.abort();
      } else await route.continue({ headers: protectedRequestHeaders(request.url(), request.headers(), bypassSecret) });
    });
    browserContext.on("page", (page) => {
      page.setDefaultTimeout(25_000); page.setDefaultNavigationTimeout(60_000);
      page.on("pageerror", () => { evidence.failures.browser++; });
      page.on("console", (message) => { if (/hydration|hydrating|did not match/i.test(message.text())) evidence.failures.hydration++; });
      page.on("response", (response) => { if (new URL(response.url()).origin === origin && response.status() >= 500) evidence.failures.server++; });
    });
    session.page = await browserContext.newPage();
    evidence.activeIdentity = role;
    await login(session.page, account);
    return session;
  }
  async function login(page, account) {
    await page.goto("/login");
    await page.getByLabel("Email address", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Log In", exact: true }).click();
    try {
      await page.waitForURL((url) => url.origin === origin && url.pathname !== "/login", { timeout: 60_000 });
    } catch {
      const message = await page.locator("#login-error").textContent().catch(() => "");
      evidence.loginFailure = /Too many login attempts/.test(message ?? "") ? "rate_limited"
        : /Unable to log in with those details/.test(message ?? "") ? "credentials_or_confirmation"
        : /account permissions|account profile/.test(message ?? "") ? "profile_check"
        : /login service|session could not be verified/.test(message ?? "") ? "auth_service"
        : "navigation_timeout";
      throw new Error("Hosted login did not reach its authorized destination.");
    }
    evidence.browserChecks++;
    check((await page.context().cookies()).some((cookie) => cookie.name.startsWith(`sb-${staging.supabaseProjectRef}-auth-token`) && cookie.secure && cookie.sameSite === "Lax"));
  }
  async function visit(page, route) {
    const response = await page.goto(route);
    check(response?.status() === 200);
    check(new URL(page.url()).origin === origin);
    check(new URL(page.url()).pathname === new URL(route, origin).pathname);
    check((response.headers()["cache-control"] ?? "").includes("no-store"));
    await expectChecked(expect(page.locator("main h1").first()).toBeVisible());
  }
  async function moderate(page, trigger, name, field, note) {
    await page.getByRole("button", { name: trigger, exact: true }).click();
    const dialog = page.getByRole("dialog", { name });
    await expectChecked(expect(dialog).toBeVisible());
    if (field) await dialog.getByLabel(field, { exact: true }).fill(note);
    const confirmation = trigger === "Approve verification" ? "Approve" : trigger === "Reject" ? "Reject verification" : trigger;
    await dialog.getByRole("button", { name: confirmation, exact: true }).click();
    await expectChecked(expect(dialog).not.toBeVisible());
  }
  async function confirm(page, name) {
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name, exact: true }).click();
  }
  async function scan(page, label) {
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.evaluate(axe.source);
    const results = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }));
    evidence.accessibility.push({ page: label, ...accessibilityCounts(results) });
    const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      smallTargets: [...document.querySelectorAll("button")].filter((element) => { const b = element.getBoundingClientRect(); return b.width > 0 && b.height > 0 && (b.width < 24 || b.height < 24); }).length }));
    check(geometry.scroll <= geometry.width + 1);
    evidence.touchTargetReview += geometry.smallTargets;
    for (const button of await page.getByRole("button").all()) await expectChecked(expect(button).toHaveAccessibleName(/.+/));
  }
  let admin, seller, buyer, outsider, rejected, pending, suspended;
  let listingId, conversationId, reservationId, verificationId;
  const run = context.runId.slice(0, 8), title = `QA Hosted ${run}`, descriptionWord = `hosteddescription${run}`;
  try {
    phase("accounts");
    const opened = [];
    for (const role of ["admin", "seller", "buyer", "competitor", "rejected", "pending", "suspended"]) opened.push(await open(role));
    [admin, seller, buyer, outsider, rejected, pending, suspended] = opened;
    evidence.phases.accounts = "passed";

    phase("security");
    for (const [session, destination] of [[pending, "/verification"], [suspended, "/account-status"]]) {
      for (const route of ["/marketplace", "/sell", "/messages", "/reservations", "/admin"]) {
        await session.page.goto(route);
        await expectChecked(expect(session.page).toHaveURL(new RegExp(`${destination}$`)));
      }
    }
    for (const route of ["/admin", "/admin/users", "/admin/listings", "/admin/reports"]) {
      await buyer.page.goto(route);
      await expectChecked(expect(buyer.page).toHaveURL(/\/marketplace$/));
    }

    phase("verification");
    await visit(rejected.page, "/verification");
    await expectChecked(expect(rejected.page.getByRole("button", { name: "Submit for verification", exact: true })).toBeDisabled());
    await rejected.page.locator("#school-id-image").setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic invalid evidence") });
    await expectChecked(expect(rejected.page.locator("#school-id-error")).toContainText("Choose a JPEG"));
    for (const decision of ["rejected", "approved"]) {
      await rejected.page.locator("#school-id-image").setInputFiles(largeImage);
      await rejected.page.getByRole("checkbox", { name: /I understand that my school ID/ }).check();
      await rejected.page.getByRole("button", { name: "Submit for verification", exact: true }).click();
      await expectChecked(expect(rejected.page.getByRole("heading", { name: "Verification pending" })).toBeVisible());
      const record = requireResult(await rejected.account.client.from("verifications").select("id,document_path").eq("user_id", rejected.account.id).eq("status", "pending").single(), "Hosted own verification");
      verificationId = record.id;
      check(isExpectedStorageDenial(await buyer.account.client.storage.from("student-verifications").download(record.document_path)));
      check(isExpectedDataDenial(await rejected.account.client.rpc("review_verification", { p_verification_id: verificationId, p_decision: "approved" })));
      check(requireResult(await rejected.account.client.from("verifications").select("status").eq("id", verificationId).single(), "Hosted self-approval unchanged state").status === "pending");
      await visit(admin.page, `/admin/verifications/${verificationId}`);
      if (decision === "rejected") {
        await moderate(admin.page, "Reject", "Reject verification", "Reason for rejection", "Synthetic hosted rejection; resubmit a placeholder.");
        await rejected.page.reload();
        await expectChecked(expect(rejected.page.getByRole("heading", { name: "Verification rejected" })).toBeVisible());
      } else await moderate(admin.page, "Approve verification", "Approve this student?");
    }
    await rejected.page.goto("/marketplace");
    await expectChecked(expect(rejected.page).toHaveURL(/\/marketplace$/));
    evidence.phases.verification = "passed";

    phase("selling");
    await seller.page.setViewportSize({ width: 390, height: 844 });
    await visit(seller.page, "/sell");
    await seller.page.getByRole("button", { name: "Publish Listing", exact: true }).click();
    await expectChecked(expect(seller.page.locator("#listing-title-error")).not.toBeEmpty());
    await expectChecked(expect(seller.page.locator("#listing-images-error")).not.toBeEmpty());
    await seller.page.getByLabel("Product Title").fill(title);
    await seller.page.getByRole("textbox", { name: "Description", exact: true }).fill(`Synthetic hosted marketplace test. ${descriptionWord}. Not for sale.`);
    const category = seller.page.getByRole("combobox", { name: "Category", exact: true });
    const categoryId = await category.locator("option").evaluateAll((options) => options.map((option) => option.value).find(Boolean)); check(categoryId);
    await category.selectOption(categoryId);
    await seller.page.getByRole("radio", { name: /^Good/ }).check();
    await seller.page.getByLabel("Price (PHP)").fill("650");
    await seller.page.locator("#listing-images").setInputFiles([largeImage, ...Array.from({ length: 4 }, (_, index) => ({ ...image, name: `synthetic-${index}.png` }))]);
    await expectChecked(expect(seller.page.getByRole("img", { name: /^Preview \d:/ })).toHaveCount(5));
    await seller.page.getByRole("button", { name: "Publish Listing", exact: true }).click();
    try {
      await seller.page.waitForURL((url) => url.origin === origin && /^\/listing\/[a-f0-9-]{36}$/.test(url.pathname), { timeout: 90_000 }); evidence.browserChecks++;
    } catch {
      const persisted = await seller.account.client.from("listings").select("status").eq("seller_id", seller.account.id).eq("title", title).maybeSingle();
      evidence.publicationFailure = { busy: await seller.page.locator("form[aria-busy=true]").count() > 0,
        storedState: persisted.error ? "unavailable" : persisted.data?.status ?? "missing",
        validationErrors: await seller.page.locator("main [aria-invalid=true]").count() };
      throw new Error("Hosted publication did not reach its persisted listing.");
    }
    listingId = new URL(seller.page.url()).pathname.split("/")[2];
    let images = requireResult(await seller.account.client.from("listing_images").select("storage_path").eq("listing_id", listingId), "Hosted persisted images"); check(images.length === 5);
    await seller.page.goto("/my-listings");
    await expectChecked(expect(seller.page.getByRole("link", { name: title, exact: true })).toBeVisible());
    await seller.page.goto(`/listing/${listingId}/edit`);
    await seller.page.getByRole("textbox", { name: "Description", exact: true }).fill(`Edited synthetic hosted test. ${descriptionWord}. Not for sale.`);
    await seller.page.getByRole("button", { name: "Remove image 5", exact: true }).click();
    await seller.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await seller.page.waitForURL((url) => url.origin === origin && url.pathname === `/listing/${listingId}`, { timeout: 90_000 }); evidence.browserChecks++;
    images = requireResult(await seller.account.client.from("listing_images").select("storage_path").eq("listing_id", listingId), "Hosted edited images"); check(images.length === 4);
    evidence.phases.selling = "passed";

    phase("buying");
    await visit(buyer.page, "/marketplace");
    await buyer.page.getByRole("searchbox", { name: "Search listings" }).fill(descriptionWord);
    await buyer.page.getByRole("button", { name: "Search listings", exact: true }).click();
    await expectChecked(expect(buyer.page.getByRole("link", { name: title, exact: true })).toBeVisible());
    const categoryRow = requireResult(await buyer.account.client.from("categories").select("slug").eq("id", categoryId).single(), "Hosted category");
    await buyer.page.getByLabel("Category", { exact: true }).selectOption(categoryRow.slug);
    await buyer.page.getByLabel("Condition", { exact: true }).selectOption("good");
    await buyer.page.getByLabel("Minimum price").fill("500"); await buyer.page.getByLabel("Maximum price").fill("700");
    await buyer.page.getByRole("button", { name: "Apply Filters", exact: true }).click();
    await expectChecked(expect(buyer.page).toHaveURL((url) => url.searchParams.get("category") === categoryRow.slug && url.searchParams.get("minPrice") === "500" && url.searchParams.get("condition") === "good"));
    await buyer.page.locator("summary[aria-label^='Sort listings']").click();
    await buyer.page.getByRole("link", { name: "Lowest Price", exact: true }).click();
    await expectChecked(expect(buyer.page).toHaveURL((url) => url.searchParams.get("sort") === "price-asc"));
    await buyer.page.reload();
    await buyer.page.getByRole("link", { name: title, exact: true }).click();
    await buyer.page.getByRole("button", { name: `Save ${title} to favorites`, exact: true }).click();
    await expectChecked(expect(buyer.page.getByRole("button", { name: `Remove ${title} from favorites`, exact: true })).toHaveAttribute("aria-pressed", "true"));
    await visit(buyer.page, "/favorites");
    await expectChecked(expect(buyer.page.getByRole("link", { name: title, exact: true })).toBeVisible());
    await buyer.page.goto(`/listing/${listingId}`);
    await buyer.page.getByRole("button", { name: `Remove ${title} from favorites`, exact: true }).click();
    await expectChecked(expect(buyer.page.getByRole("button", { name: `Save ${title} to favorites`, exact: true })).toHaveAttribute("aria-pressed", "false"));
    await buyer.page.getByRole("button", { name: "Message Seller", exact: true }).click();
    await expectChecked(expect(buyer.page).toHaveURL(/\/messages\/[a-f0-9-]{36}$/));
    conversationId = new URL(buyer.page.url()).pathname.split("/")[2];
    const message = `Synthetic question ${run}`, reply = `Synthetic reply ${run}`;
    await buyer.page.locator("#message-body").fill(message); await buyer.page.locator("#message-body").press("Enter");
    await expectChecked(expect(buyer.page.getByRole("log").getByText(message, { exact: true })).toBeVisible());
    await seller.page.goto(`/messages/${conversationId}`);
    await expectChecked(expect(seller.page.getByRole("log").getByText(message, { exact: true })).toBeVisible());
    await seller.page.locator("#message-body").fill(reply); await seller.page.getByRole("button", { name: "Send", exact: true }).click();
    await expectChecked(expect(buyer.page.getByRole("log").getByText(reply, { exact: true })).toBeVisible({ timeout: 45_000 }));
    evidence.phases.buying = "passed";

    phase("transaction");
    await buyer.page.goto(`/listing/${listingId}`);
    const trigger = buyer.page.getByRole("button", { name: "Request Reservation", exact: true });
    await trigger.focus(); await trigger.press("Enter");
    const request = buyer.page.getByRole("dialog", { name: "Request this item", exact: true });
    await expectChecked(expect(request.getByRole("button", { name: "Close reservation dialog", exact: true })).toBeFocused());
    await buyer.page.keyboard.press("Escape"); await expectChecked(expect(trigger).toBeFocused()); await trigger.press("Space");
    await request.getByLabel(/Message to seller/).fill("Synthetic campus meetup; no physical exchange.");
    await request.getByRole("button", { name: "Send Request", exact: true }).click(); await expectChecked(expect(request).not.toBeVisible());
    await buyer.page.reload(); await buyer.page.getByRole("link", { name: "View Reservation", exact: true }).click();
    await expectChecked(expect(buyer.page).toHaveURL(/\/reservations\/[a-f0-9-]{36}$/)); reservationId = new URL(buyer.page.url()).pathname.split("/")[2];
    await seller.page.goto(`/reservations/${reservationId}`); await confirm(seller.page, "Accept");
    await expectChecked(expect(seller.page.getByRole("button", { name: "Arrange Meetup", exact: true })).toBeVisible());
    check(requireResult(await seller.account.client.from("listings").select("status").eq("id", listingId).single(), "Hosted reserved listing").status === "reserved");
    await buyer.page.reload(); await buyer.page.getByRole("button", { name: "Arrange Meetup", exact: true }).click();
    const meetup = buyer.page.getByRole("dialog", { name: "Arrange a meetup", exact: true });
    await meetup.getByLabel("Public campus location").fill("SYNTHETIC UC campus lobby - no actual meeting");
    await meetup.getByLabel(/Meeting point details/).fill("Synthetic test near security desk");
    await meetup.getByLabel("Date and time").fill(new Date(Date.now() + 32 * 3600000).toISOString().slice(0, 16));
    await meetup.getByLabel(/Notes/).fill("Synthetic owned accounts only; do not attend.");
    await meetup.getByRole("button", { name: "Save Meetup", exact: true }).click(); await expectChecked(expect(meetup).not.toBeVisible());
    await seller.page.reload(); await confirm(seller.page, "Mark Sold");
    await expectChecked(expect(seller.page.getByText("Sold", { exact: true }).first()).toBeVisible());
    check(requireResult(await seller.account.client.from("listings").select("status").eq("id", listingId).single(), "Hosted sold listing").status === "sold");
    check(requireResult(await buyer.account.client.from("reservations").select("status").eq("id", reservationId).single(), "Hosted completed reservation").status === "completed");
    check(requireResult(await buyer.account.client.from("meetups").select("status").eq("reservation_id", reservationId).single(), "Hosted completed meetup").status === "completed");
    await buyer.page.reload(); await expectChecked(expect(buyer.page.getByText("Completed", { exact: true }).first()).toBeVisible());
    evidence.phases.transaction = "passed";

    phase("security");
    await outsider.page.goto(`/messages/${conversationId}`); await expectChecked(expect(outsider.page.getByRole("log")).toHaveCount(0));
    check(isInvisibleDataResult(await outsider.account.client.from("messages").select("id").eq("conversation_id", conversationId)));
    await outsider.page.goto(`/reservations/${reservationId}`); await expectChecked(expect(outsider.page.getByText("SYNTHETIC UC campus lobby - no actual meeting", { exact: true })).toHaveCount(0));
    await buyer.page.goto(`/listing/${listingId}/edit`); await expectChecked(expect(buyer.page.getByLabel("Title", { exact: true })).toHaveCount(0));
    for (const session of [buyer, outsider]) {
      const response = await session.page.request.get(`/admin/verifications/${verificationId}/document`, { headers: { "x-vercel-protection-bypass": bypassSecret }, maxRedirects: 0 });
      check([401, 403, 307, 308].includes(response.status())); check(!(response.headers()["content-type"] ?? "").startsWith("image/"));
    }
    await admin.page.goto(`/admin/users/${buyer.account.id}`);
    await moderate(admin.page, "Suspend account", /Suspend this account/, "Reason for suspension", "Temporary synthetic hosted active-session test.");
    await buyer.page.goto("/messages"); await expectChecked(expect(buyer.page).toHaveURL(/\/account-status$/));
    await admin.page.reload(); await moderate(admin.page, "Reactivate account", /Reactivate this account/, "Reason for reactivation", "Restore only this run-owned synthetic student.");
    await buyer.page.goto("/marketplace"); await expectChecked(expect(buyer.page).toHaveURL(/\/marketplace$/));
    evidence.phases.security = "passed";

    phase("accessibility");
    const second = await open("buyer", true);
    for (const [label, page, routes] of [["desktop", buyer.page, ["/marketplace", `/listing/${listingId}`, "/sell", "/favorites", `/messages/${conversationId}`, `/reservations/${reservationId}`, "/profile"]],
      ["touch-emulated", second.page, ["/marketplace", `/listing/${listingId}`, "/sell", `/messages/${conversationId}`, `/reservations/${reservationId}`]],
      ["admin", admin.page, ["/admin", "/admin/users", "/admin/reports"]]]) {
      for (const route of routes) { await visit(page, route); await scan(page, `${label}:${route.replace(/[a-f0-9-]{36}/g, ":id")}`); }
    }
    for (const width of [375, 390, 430, 640]) { await buyer.page.setViewportSize({ width, height: 900 }); await visit(buyer.page, "/marketplace");
      const dimensions = await buyer.page.evaluate(() => ({ w: innerWidth, s: document.documentElement.scrollWidth })); check(dimensions.s <= dimensions.w + 1); }
    await buyer.page.setViewportSize({ width: 640, height: 450 }); await scan(buyer.page, "desktop-200-percent-reflow");
    // Collect session evidence as well if axe finds a blocker; the final gate
    // still fails on any serious/critical finding. No rule is excluded.
    evidence.phases.accessibility = evidence.accessibility.some((scan) => scan.violations.some((rule) => ["serious", "critical"].includes(rule.impact))) ? "failed" : "passed";
    await buyer.page.setViewportSize({ width: 1280, height: 900 });

    phase("sessions");
    await visit(second.page, `/messages/${conversationId}`);
    const tab = await buyer.context.newPage(); await visit(tab, "/profile");
    await buyer.page.goto("/profile"); await buyer.page.getByRole("button", { name: /^Log out$/i }).first().click();
    // The toast consumes authNotice with history.replaceState. Assert the stable
    // route plus actual private-access denial, not a transient query string.
    await buyer.page.waitForURL((url) => url.origin === origin && url.pathname === "/login"); evidence.browserChecks++;
    await tab.goto("/messages"); await expectChecked(expect(tab).toHaveURL(/\/login(?:\?|$)/));
    await second.page.reload(); await expectChecked(expect(second.page.getByRole("log").getByText(reply, { exact: true })).toBeVisible());
    await login(buyer.page, buyer.account);
    const cookieName = `sb-${staging.supabaseProjectRef}-auth-token`, cookies = (await buyer.context.cookies()).filter((cookie) => cookie.name === cookieName || cookie.name.startsWith(`${cookieName}.`));
    const serialized = cookies.find((cookie) => cookie.name === cookieName)?.value ?? cookies.sort((a, b) => Number(a.name.slice(cookieName.length + 1)) - Number(b.name.slice(cookieName.length + 1))).map((cookie) => cookie.value).join("");
    check(serialized.startsWith("base64-")); const expired = JSON.parse(Buffer.from(serialized.slice(7), "base64url").toString());
    expired.expires_at = 1; expired.refresh_token = `invalid-owned-${randomUUID()}`;
    await buyer.context.clearCookies(); const chunks = `base64-${Buffer.from(JSON.stringify(expired)).toString("base64url")}`.match(/.{1,3180}/g);
    await buyer.context.addCookies(chunks.map((value, index) => ({ name: chunks.length === 1 ? cookieName : `${cookieName}.${index}`, value, url: origin, secure: true, sameSite: "Lax" })));
    await buyer.page.goto("/profile"); await expectChecked(expect(buyer.page).toHaveURL(/\/login(?:\?|$)/)); await login(buyer.page, buyer.account);
    for (const route of ["/auth/recovery?error=access_denied", "/auth/recovery?token_hash=invalid&type=recovery", "/auth/confirm?type=email&type=recovery"]) {
      const response = await buyer.page.request.get(route, { headers: { "x-vercel-protection-bypass": bypassSecret }, maxRedirects: 0 });
      check(response.status() === 307); check((response.headers()["cache-control"] ?? "").includes("no-store"));
    }
    evidence.phases.sessions = "passed";

  } finally {
    signal?.removeEventListener("abort", abort);
    // Fixture deletion in the parent revokes every browser session for ONLY
    // this run's temporary users, even if the browser closed during failure.
    const closed = await Promise.allSettled(sessions.map((session) => session.context.close()));
    await browser.close();
    assert.ok(closed.every((result) => result.status === "fulfilled"), "Every owned browser context must close.");
  }
}
