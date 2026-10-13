import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { isExpectedStorageDenial, isInvisibleDataResult, isSuccessfulApiResult } from "../../scripts/qa/lib/api-results.mjs";

import {
  closeQaSessions, confirmAction, expectDialogWithinViewport, expectNoHorizontalOverflow, holdQaMutation, loginQaSession,
  moderate, openQaSession, qaEnvironment, qaImage, qaRoles, type QaSession,
} from "./qa-helpers";

const adminRoutes = ["/admin", "/admin/users", "/admin/listings", "/admin/reports", "/admin/verifications"];

test("separate real sessions enforce admin, verification, suspension, and logout boundaries", async ({ browser }) => {
  qaEnvironment(); // Missing isolated credentials fail loudly; no skipped gate.
  const sessions: QaSession[] = [];
  try {
    for (const role of qaRoles) sessions.push(await openQaSession(browser, role));
    for (const session of sessions) {
      const { page, account } = session;
      const expectedDestination = account.role === "ADMIN" ? "/admin/verifications"
        : account.role === "SUSPENDED" ? "/account-status"
        : account.role === "PENDING" || account.role === "REJECTED" ? "/verification" : "/marketplace";
      for (const route of ["/login", "/register"]) {
        await page.goto(route);
        await expect(page).toHaveURL(new RegExp(`${expectedDestination}(?:\\?|$)`));
      }
      for (const route of adminRoutes) {
        await page.goto(route);
        if (account.role === "ADMIN") {
          await expect(page).toHaveURL(new RegExp(`${route}(?:\\?|$)`));
          await expect(page.locator("h1")).toBeVisible();
          await expect(page.getByRole("alert")).toHaveCount(0);
        } else {
          await expect(page).not.toHaveURL(/\/admin(?:\/|\?|$)/);
          await expect(page.getByRole("heading", { name: "Account details" })).toHaveCount(0);
        }
      }
      if (["SUSPENDED", "PENDING", "REJECTED"].includes(account.role)) {
        for (const route of ["/marketplace", "/sell", "/favorites", "/messages", "/reservations", "/my-listings"]) {
          await page.goto(route);
          await expect(page).toHaveURL(new RegExp(`${expectedDestination}(?:\\?|$)`));
          await expect(page.getByRole("button", { name: /Publish Listing|Send Request|Mark Sold/ })).toHaveCount(0);
        }
      }
      // Restricted accounts still retain explicitly allowed private account tools.
      await page.goto("/profile");
      await expect(page).toHaveURL(/\/profile$/);
      if (account.role === "BUYER") {
        // Exercise real Auth's denial of an expired session's invalid refresh
        // credential. Unlike the baseline malformed-cookie test, this starts
        // from a real QA sign-in and reaches the isolated Auth service.
        const project = new URL(qaEnvironment().supabaseURL).hostname.split(".")[0];
        const cookieName = `sb-${project}-auth-token`;
        const stored = (await session.context.cookies()).filter((cookie) => cookie.name === cookieName || cookie.name.startsWith(`${cookieName}.`));
        const serialized = stored.find((cookie) => cookie.name === cookieName)?.value
          ?? stored.sort((left, right) => Number(left.name.slice(cookieName.length + 1)) - Number(right.name.slice(cookieName.length + 1))).map((cookie) => cookie.value).join("");
        expect(serialized.startsWith("base64-"), "Real QA Auth session must exist before the expiration test").toBe(true);
        const expired = JSON.parse(Buffer.from(serialized.slice(7), "base64url").toString());
        expired.expires_at = 1;
        expired.refresh_token = "invalid-isolated-qa-refresh-token";
        await session.context.clearCookies();
        const expiredValue = `base64-${Buffer.from(JSON.stringify(expired)).toString("base64url")}`;
        const chunks = expiredValue.match(/.{1,3180}/g)!;
        await session.context.addCookies(chunks.map((value, index) => ({
          name: chunks.length === 1 ? cookieName : `${cookieName}.${index}`,
          value, url: qaEnvironment().appURL, sameSite: "Lax" as const,
        })));
        await page.goto("/profile");
        await expect(page).toHaveURL(/\/login(?:\?|$)/);
        await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
        await loginQaSession(page, account);
        await page.goto("/profile");
      }
      await expect(page.getByRole("button", { name: "Log Out", exact: true }).first()).toBeVisible();
      await page.getByRole("button", { name: "Log Out", exact: true }).first().click();
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
      await page.goBack();
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
      for (const route of ["/profile", "/messages", "/favorites", "/reservations", "/my-listings"]) {
        await page.goto(route);
        await expect(page).toHaveURL(/\/login(?:\?|$)/);
      }
      expect(session.errors, `${account.role} must not produce uncaught browser errors`).toEqual([]);
    }
  } finally {
    await closeQaSessions(sessions);
  }
});

test("real authenticated mutations recover from offline networks, suppress duplicates, and keep mobile dialogs keyboard usable", async ({ browser }) => {
  test.setTimeout(240_000);
  qaEnvironment();
  const sessions: QaSession[] = [];
  const runId = randomUUID().slice(0, 8);
  const title = `QA Network Calculator ${runId}`;
  let listingId = "";
  let conversationId = "";
  try {
    for (const role of ["SELLER", "BUYER"] as const) sessions.push(await openQaSession(browser, role));
    const [seller, buyer] = sessions;

    await test.step("delayed publication disables controls and creates one listing despite repeated Enter", async () => {
      await seller.page.goto("/sell");
      await seller.page.getByLabel("Product Title").fill(title);
      await seller.page.getByLabel("Description", { exact: true }).fill(`Synthetic network recovery fixture ${runId}. No real sale or exchange.`);
      const category = seller.page.getByLabel("Category", { exact: true });
      const categoryValue = await category.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value).find(Boolean));
      expect(categoryValue, "QA database must have an active marketplace category").toBeTruthy();
      await category.selectOption(categoryValue!);
      await seller.page.getByRole("radio", { name: /^Good/ }).check();
      await seller.page.getByLabel("Price (PHP)").fill("650");
      await seller.page.locator("#listing-images").setInputFiles(qaImage);
      await expect(seller.page.getByRole("img", { name: /Preview 1/ })).toBeVisible();
      const delayed = await holdQaMutation(seller.page, "/sell", title);
      try {
        await seller.page.getByRole("button", { name: "Publish Listing", exact: true }).press("Enter");
        await expect.poll(() => delayed.requestCount, { message: "A real publication request must reach the network gate" }).toBe(1);
        await expect(seller.page.locator("form[aria-busy=true]")).toBeVisible();
        await expect(seller.page.getByRole("button", { name: "Publishing Listing...", exact: true })).toBeDisabled();
        await expect(seller.page.getByLabel("Product Title")).toBeDisabled();
        await seller.page.keyboard.press("Enter");
        await seller.page.keyboard.press("Enter");
        delayed.release();
        await expect(seller.page).toHaveURL(/\/listing\/[0-9a-f-]{36}(?:\?|$)/);
        listingId = new URL(seller.page.url()).pathname.split("/")[2];
        const listings = await seller.api.from("listings").select("id,status").eq("seller_id", seller.account.id).eq("title", title);
        expect(isSuccessfulApiResult(listings), "Publication persistence must be confirmed by a successful API read").toBe(true);
        expect(listings.data).toEqual([{ id: listingId, status: "available" }]);
        expect(delayed.requestCount, "Repeated activation while pending must send only one publication request").toBe(1);
      } finally {
        await delayed.dispose();
      }
    });

    await test.step("actual offline favorite failure rolls back and keyboard retry persists once", async () => {
      await buyer.page.goto(`/listing/${listingId}`);
      const save = buyer.page.getByRole("button", { name: `Save ${title} to favorites`, exact: true });
      await buyer.context.setOffline(true);
      try {
        expect(await buyer.page.evaluate(() => navigator.onLine), "The browser context must actually be offline").toBe(false);
        await save.press("Space");
        await expect(buyer.page.getByRole("alert")).toHaveText("Unable to save this listing. Please try again.");
        await expect(save).toBeEnabled();
        await expect(save).toHaveAttribute("aria-pressed", "false");
        const failedSave = await buyer.api.from("favorites").select("listing_id").eq("listing_id", listingId).eq("user_id", buyer.account.id);
        expect(isSuccessfulApiResult(failedSave), "A network failure must leave readable persisted state unchanged").toBe(true);
        expect(failedSave.data).toEqual([]);
      } finally {
        await buyer.context.setOffline(false);
      }
      await save.press("Space");
      const saved = buyer.page.getByRole("button", { name: `Remove ${title} from favorites`, exact: true });
      await expect(saved).toBeEnabled();
      await expect(saved).toHaveAttribute("aria-pressed", "true");
      const retriedSave = await buyer.api.from("favorites").select("listing_id").eq("listing_id", listingId).eq("user_id", buyer.account.id);
      expect(isSuccessfulApiResult(retriedSave)).toBe(true);
      expect(retriedSave.data).toEqual([{ listing_id: listingId }]);
      await buyer.page.reload();
      await expect(saved).toHaveAttribute("aria-pressed", "true");
    });

    await test.step("phone and desktop dialogs contain focus, scroll within the viewport, and restore the trigger", async () => {
      const dialogs = [
        { trigger: "Report", name: "Report listing", close: "Close report dialog", submit: "Submit Report", report: true },
        { trigger: "Report Student", name: "Report student", close: "Close student report dialog", submit: "Submit Report", report: true },
        { trigger: "Request Reservation", name: "Request this item", close: "Close reservation dialog", submit: "Send Request", report: false },
      ];
      for (const width of [375, 390, 430, 1280, 1440, 1920]) {
        await buyer.page.setViewportSize({ width, height: width < 500 ? 667 : 900 });
        for (const contract of dialogs) {
          const trigger = buyer.page.getByRole("button", { name: contract.trigger, exact: true });
          await trigger.focus();
          await trigger.press("Enter");
          const dialog = buyer.page.getByRole("dialog", { name: contract.name, exact: true });
          await expect(dialog).toBeVisible();
          const first = dialog.getByRole("button", { name: contract.close, exact: true });
          await expect(first).toBeFocused();
          if (contract.report) await dialog.getByLabel("Reason", { exact: true }).selectOption("scam");
          await expectDialogWithinViewport(dialog);
          await expectNoHorizontalOverflow(buyer.page);
          const last = dialog.getByRole("button", { name: contract.submit, exact: true });
          await expect(last).toBeEnabled();
          await last.focus();
          await last.press("Tab");
          // Chromium's native modal traversal may use body as a neutral tab
          // stop before wrapping. Background interactive controls are never
          // accepted as a valid intermediate or final focus destination.
          if (await buyer.page.evaluate(() => document.activeElement === document.body)) await buyer.page.keyboard.press("Tab");
          await expect(first).toBeFocused();
          await first.press("Shift+Tab");
          if (await buyer.page.evaluate(() => document.activeElement === document.body)) await buyer.page.keyboard.press("Shift+Tab");
          await expect(last).toBeFocused();
          await buyer.page.keyboard.press("Escape");
          await expect(dialog).not.toBeVisible();
          await expect(trigger).toBeFocused();
          await trigger.press("Space");
          await expect(dialog).toBeVisible();
          await dialog.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
          await expect(dialog).not.toBeVisible();
          await expect(trigger).toBeFocused();
        }
      }
      await buyer.page.setViewportSize({ width: 1280, height: 900 });
    });

    await test.step("Shift+Enter preserves a draft; slow send blocks duplicate Enter and persists one message", async () => {
      await buyer.page.getByRole("button", { name: "Message Seller", exact: true }).click();
      await expect(buyer.page).toHaveURL(/\/messages\/[0-9a-f-]{36}$/);
      conversationId = new URL(buyer.page.url()).pathname.split("/")[2];
      const composer = buyer.page.locator("#message-body");
      const firstLine = `QA ${runId} slow message`;
      const body = `${firstLine}\nSynthetic second line.`;
      await composer.fill(firstLine);
      await composer.press("Shift+Enter");
      await buyer.page.keyboard.insertText("Synthetic second line.");
      await expect(composer).toHaveValue(body);
      await expect(buyer.page.getByRole("log").getByText(body, { exact: true })).toHaveCount(0);
      await composer.press("Tab");
      await expect(buyer.page.getByRole("button", { name: "Send", exact: true })).toBeFocused();
      await buyer.page.keyboard.press("Shift+Tab");
      await expect(composer).toBeFocused();
      const delayed = await holdQaMutation(buyer.page, `/messages/${conversationId}`, firstLine);
      try {
        await composer.press("Enter");
        await expect.poll(() => delayed.requestCount, { message: "A real message request must reach the network gate" }).toBe(1);
        await expect(composer).toBeDisabled();
        await expect(buyer.page.getByRole("button", { name: /^Sending/ })).toBeDisabled();
        await buyer.page.keyboard.press("Enter");
        await buyer.page.keyboard.press("Enter");
        delayed.release();
        await expect(buyer.page.getByRole("log").getByText(body, { exact: true })).toHaveCount(1);
        await expect(composer).toBeEnabled();
        await expect(composer).toHaveValue("");
        const messages = await buyer.api.from("messages").select("id,body").eq("conversation_id", conversationId).eq("sender_id", buyer.account.id).eq("body", body);
        expect(isSuccessfulApiResult(messages)).toBe(true);
        expect(messages.data).toHaveLength(1);
        expect(delayed.requestCount, "Repeated Enter while pending must send only one message request").toBe(1);
      } finally {
        await delayed.dispose();
      }
      await seller.page.goto(`/messages/${conversationId}`);
      await expect(seller.page.getByRole("log").getByText(body, { exact: true })).toHaveCount(1);
    });

    await test.step("offline send retains the draft and an online retry delivers exactly once", async () => {
      const draft = `QA ${runId}: Retain this synthetic offline draft.`;
      const composer = buyer.page.locator("#message-body");
      await composer.fill(draft);
      await buyer.context.setOffline(true);
      try {
        await composer.press("Enter");
        await expect(buyer.page.locator("#message-composer-feedback")).toHaveText("Message could not be sent. Please try again.");
        await expect(composer).toBeEnabled();
        await expect(composer).toHaveValue(draft);
        await expect(buyer.page.getByRole("log").getByText(draft, { exact: true })).toHaveCount(0);
        const unsent = await buyer.api.from("messages").select("id").eq("conversation_id", conversationId).eq("body", draft);
        expect(isSuccessfulApiResult(unsent), "Offline UI feedback must be backed by a successful read of unchanged database state").toBe(true);
        expect(unsent.data).toEqual([]);
      } finally {
        await buyer.context.setOffline(false);
      }
      await composer.press("Enter");
      await expect(buyer.page.getByRole("log").getByText(draft, { exact: true })).toHaveCount(1);
      await expect(buyer.page.locator("#message-composer-feedback")).toBeEmpty();
      await expect(seller.page.getByRole("log").getByText(draft, { exact: true })).toHaveCount(1, { timeout: 40_000 });
      await buyer.page.reload();
      await expect(buyer.page.getByRole("log").getByText(draft, { exact: true })).toHaveCount(1);
      const sent = await buyer.api.from("messages").select("id").eq("conversation_id", conversationId).eq("body", draft);
      expect(isSuccessfulApiResult(sent)).toBe(true);
      expect(sent.data).toHaveLength(1);
    });

    for (const session of sessions) expect(session.errors, `${session.account.role} network recovery must not produce uncaught browser errors`).toEqual([]);
  } finally {
    // The isolated runner owns cleanup for these run-owned users and listings.
    for (const session of sessions) await session.context.setOffline(false);
    await closeQaSessions(sessions);
  }
});

test("isolated verification, buyer/seller transaction, persistence, privacy, and moderation workflow", async ({ browser }) => {
  test.setTimeout(600_000);
  qaEnvironment();
  const sessions: QaSession[] = [];
  const runId = randomUUID().slice(0, 8);
  const title = `QA Calculator ${runId}`;
  const descriptionWord = `descriptiononly${runId}`;
  const message = `QA ${runId}: Is this calculator available?`;
  const reply = `QA ${runId}: Yes, this is available.`;
  const requestNote = `QA ${runId}: Campus exchange requested.`;
  const campus = `QA ${runId} UC Main Campus Lobby`;
  let listingId = "";
  let reservationId = "";
  let conversationId = "";
  let privateVerificationId = "";
  try {
    for (const role of ["ADMIN", "SELLER", "BUYER", "REJECTED", "COMPETITOR"] as const) {
      sessions.push(await openQaSession(browser, role));
    }
    const [admin, seller, buyer, rejected, outsider] = sessions;

    await test.step("rejected student submits private evidence; admin rejects, resubmission is approved", async () => {
      await submitVerification(rejected.page);
      const submission = await rejected.api.from("verifications").select("id,status,document_path").eq("user_id", rejected.account.id).order("submitted_at", { ascending: false }).limit(1).single();
      expect(Boolean(submission.error)).toBe(false);
      expect(submission.data?.status).toBe("pending");
      const verificationId = submission.data!.id;
      privateVerificationId = verificationId;
      await admin.page.goto(`/admin/verifications/${verificationId}`);
      await admin.page.getByRole("button", { name: "Reject", exact: true }).click();
      const rejectDialog = admin.page.getByRole("dialog", { name: "Reject verification" });
      await rejectDialog.getByLabel("Reason for rejection").fill(`QA ${runId}: Please provide a clearer synthetic image.`);
      await rejectDialog.getByRole("button", { name: "Reject verification", exact: true }).click();
      await expect(rejectDialog).not.toBeVisible();
      await rejected.page.reload();
      await expect(rejected.page.getByRole("heading", { name: "Verification rejected" })).toBeVisible();
      await expect(rejected.page.getByText(`QA ${runId}: Please provide a clearer synthetic image.`, { exact: true })).toBeVisible();
      await submitVerification(rejected.page);
      const resubmission = await rejected.api.from("verifications").select("id,status").eq("user_id", rejected.account.id).order("submitted_at", { ascending: false }).limit(1).single();
      expect(Boolean(resubmission.error)).toBe(false);
      expect(resubmission.data!.id).not.toBe(verificationId);
      await admin.page.goto(`/admin/verifications/${resubmission.data!.id}`);
      await admin.page.getByRole("button", { name: "Approve verification", exact: true }).click();
      const approveDialog = admin.page.getByRole("dialog", { name: "Approve this student?" });
      await approveDialog.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(approveDialog).not.toBeVisible();
      await rejected.page.goto("/marketplace");
      await expect(rejected.page).toHaveURL(/\/marketplace$/);
      const result = await rejected.api.from("profiles").select("verification_status").eq("id", rejected.account.id).single();
      expect(result.data?.verification_status).toBe("verified");

      const evidence = await admin.page.request.get(`/admin/verifications/${verificationId}/document`);
      expect(evidence.status()).toBe(200);
      expect(evidence.headers()["cache-control"]).toContain("no-store");
      const forbidden = await buyer.page.request.get(`/admin/verifications/${verificationId}/document`, { maxRedirects: 0 });
      expect([401, 403, 307, 308]).toContain(forbidden.status());
      expect(forbidden.headers()["content-type"] ?? "").not.toMatch(/^image\//);
      const storageAttempt = await buyer.api.storage.from("student-verifications").download(submission.data!.document_path);
      expect(isExpectedStorageDenial(storageAttempt), "Private Storage must return an authorization/hidden-object denial, not an outage").toBe(true);
    });

    await test.step("seller creates a valid listing, image, and owner-only edit", async () => {
      await seller.page.goto("/sell");
      await seller.page.getByRole("button", { name: "Publish Listing", exact: true }).click();
      await expect(seller.page.locator("#listing-title-error")).not.toBeEmpty();
      await expect(seller.page.locator("#listing-images-error")).not.toBeEmpty();
      await seller.page.getByLabel("Product Title").fill(title);
      await seller.page.getByLabel("Description", { exact: true }).fill(`A working synthetic test calculator. ${descriptionWord}. Not a real sale.`);
      const category = seller.page.getByLabel("Category", { exact: true });
      const categoryValue = await category.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value).find(Boolean));
      expect(categoryValue, "QA database must have an active marketplace category").toBeTruthy();
      await category.selectOption(categoryValue!);
      await seller.page.getByRole("radio", { name: /^Good/ }).check();
      await seller.page.getByLabel("Price (PHP)").fill("650");
      await seller.page.locator("#listing-images").setInputFiles(qaImage);
      await expect(seller.page.getByRole("img", { name: /Preview 1/ })).toBeVisible();
      await seller.page.getByRole("button", { name: "Publish Listing", exact: true }).click();
      await expect(seller.page).toHaveURL(/\/listing\/[0-9a-f-]{36}(?:\?|$)/);
      listingId = new URL(seller.page.url()).pathname.split("/")[2];
      const persisted = await seller.api.from("listings").select("id,seller_id,status,title").eq("id", listingId).single();
      expect(Boolean(persisted.error)).toBe(false);
      expect(persisted.data).toMatchObject({ seller_id: seller.account.id, status: "available", title });
      const images = await seller.api.from("listing_images").select("id,listing_id,storage_path").eq("listing_id", listingId);
      expect(Boolean(images.error)).toBe(false);
      expect(images.data).toHaveLength(1);
      await seller.page.getByRole("link", { name: "Edit", exact: true }).click();
      await expect(seller.page.getByLabel("Title", { exact: true })).toHaveValue(title);
      await seller.page.getByLabel("Description", { exact: true }).fill(`Edited synthetic calculator. ${descriptionWord}. Not a real sale.`);
      await seller.page.getByRole("button", { name: "Save Changes", exact: true }).click();
      await expect(seller.page).toHaveURL(new RegExp(`/listing/${listingId}(?:\\?|$)`));
      await seller.page.reload();
      await expect(seller.page.getByText(`Edited synthetic calculator. ${descriptionWord}. Not a real sale.`, { exact: true })).toBeVisible();
    });

    await test.step("buyer searches description, combines filters, sorts, and preserves URL state", async () => {
      await buyer.page.goto("/marketplace");
      await buyer.page.getByRole("searchbox", { name: "Search listings" }).fill(descriptionWord.toUpperCase());
      await buyer.page.getByRole("button", { name: "Search listings", exact: true }).click();
      await expect(buyer.page.getByRole("link", { name: title, exact: true })).toBeVisible();
      await buyer.page.getByLabel("Condition", { exact: true }).selectOption("good");
      await buyer.page.getByLabel("Minimum price").fill("500");
      await buyer.page.getByLabel("Maximum price").fill("700");
      await buyer.page.getByRole("button", { name: "Apply Filters", exact: true }).click();
      await buyer.page.locator("summary[aria-label^='Sort listings']").click();
      await buyer.page.getByRole("link", { name: "Lowest Price", exact: true }).click();
      const filteredURL = buyer.page.url();
      await buyer.page.reload();
      await expect(buyer.page.getByLabel("Condition", { exact: true })).toHaveValue("good");
      await expect(buyer.page.getByLabel("Minimum price")).toHaveValue("500");
      await expect(buyer.page.getByLabel("Maximum price")).toHaveValue("700");
      expect(new URL(filteredURL).searchParams.get("sort")).toBe("price-asc");
      await outsider.page.goto(filteredURL);
      await expect(outsider.page.getByRole("link", { name: title, exact: true })).toBeVisible();
      await buyer.page.getByRole("link", { name: title, exact: true }).click();
      await expect(buyer.page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(buyer.page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
      await buyer.page.goto(`/listing/${listingId}/edit`);
      await expect(buyer.page.getByLabel("Title", { exact: true })).toHaveCount(0);
      await buyer.page.goto(`/listing/${listingId}`);
    });

    await test.step("favorite persists; private listing and student reports reach only moderators", async () => {
      await buyer.page.getByRole("button", { name: `Save ${title} to favorites`, exact: true }).click();
      await expect(buyer.page.getByRole("button", { name: `Remove ${title} from favorites`, exact: true })).toHaveAttribute("aria-pressed", "true");
      await buyer.page.goto("/favorites");
      await buyer.page.reload();
      await expect(buyer.page.getByRole("link", { name: title, exact: true })).toBeVisible();
      const favorites = await buyer.api.from("favorites").select("user_id,listing_id").eq("listing_id", listingId);
      expect(favorites.data).toHaveLength(1);
      expect(favorites.data![0].user_id).toBe(buyer.account.id);
      const otherFavorites = await seller.api.from("favorites").select("user_id").eq("listing_id", listingId).eq("user_id", buyer.account.id);
      expect(isInvisibleDataResult(otherFavorites), "Another user's favorites must be hidden by permissions, not a transport error").toBe(true);
      await buyer.page.goto(`/listing/${listingId}`);

      await buyer.page.getByRole("button", { name: "Report", exact: true }).click();
      const listingReport = buyer.page.getByRole("dialog", { name: "Report listing", exact: true });
      await listingReport.getByLabel("Reason", { exact: true }).selectOption("other");
      await listingReport.getByLabel(/Additional details/).fill(`QA ${runId}: Synthetic report for isolated testing.`);
      await listingReport.getByRole("button", { name: "Submit Report", exact: true }).click();
      await expect(listingReport).not.toBeVisible();
      await buyer.page.getByRole("button", { name: "Report Student", exact: true }).click();
      const studentReport = buyer.page.getByRole("dialog", { name: "Report student", exact: true });
      await studentReport.getByLabel("Reason", { exact: true }).selectOption("other");
      await studentReport.getByLabel(/Additional details/).fill(`QA ${runId}: Separate synthetic student report.`);
      await studentReport.getByRole("button", { name: "Submit Report", exact: true }).click();
      await expect(studentReport).not.toBeVisible();
      const reports = await admin.api.from("listing_reports").select("id,status").eq("listing_id", listingId).eq("reporter_id", buyer.account.id).single();
      expect(reports.data?.status).toBe("pending");
      const privateReports = await seller.api.from("listing_reports").select("id").eq("listing_id", listingId);
      expect(isInvisibleDataResult(privateReports), "Reports must be hidden from the subject by permissions, not a transport error").toBe(true);
      await admin.page.goto(`/admin/reports/listing/${reports.data!.id}`);
      await moderate(admin.page, "Resolve report", /Resolve this report/, "Private resolution note", `QA ${runId}: Isolated report reviewed and resolved.`);
      const userReport = await admin.api.from("student_reports").select("id,status").eq("subject_id", seller.account.id).eq("reporter_id", buyer.account.id).single();
      expect(userReport.data?.status).toBe("pending");
      await admin.page.goto(`/admin/reports/student/${userReport.data!.id}`);
      await moderate(admin.page, "Dismiss report", /Dismiss this report/, "Private dismissal note", `QA ${runId}: Isolated student report dismissed.`);
    });

    await test.step("message seller reuses one conversation; two isolated browser contexts receive persisted replies", async () => {
      await buyer.page.getByRole("button", { name: "Message Seller", exact: true }).click();
      await expect(buyer.page).toHaveURL(/\/messages\/[0-9a-f-]{36}$/);
      conversationId = new URL(buyer.page.url()).pathname.split("/")[2];
      await buyer.page.locator("#message-body").fill(message);
      await buyer.page.locator("#message-body").press("Enter");
      await expect(buyer.page.getByRole("log").getByText(message, { exact: true })).toBeVisible();
      await seller.page.goto(`/messages/${conversationId}`);
      await expect(seller.page.getByRole("log").getByText(message, { exact: true })).toBeVisible();
      await seller.page.locator("#message-body").fill(reply);
      await seller.page.getByRole("button", { name: "Send", exact: true }).click();
      // The live subscriber/catch-up must deliver it without a manual reload.
      await expect(buyer.page.getByRole("log").getByText(reply, { exact: true })).toBeVisible({ timeout: 40_000 });
      await buyer.page.reload();
      await expect(buyer.page.getByRole("log").getByText(reply, { exact: true })).toBeVisible();
      await buyer.page.goto(`/listing/${listingId}`);
      await buyer.page.getByRole("button", { name: "Message Seller", exact: true }).click();
      await expect(buyer.page).toHaveURL(new RegExp(`/messages/${conversationId}$`));
      const conversations = await buyer.api.from("conversations").select("id").eq("listing_id", listingId).eq("buyer_id", buyer.account.id);
      expect(conversations.data).toHaveLength(1);
      await outsider.page.goto(`/messages/${conversationId}`);
      await expect(outsider.page.getByRole("log")).toHaveCount(0);
      await expect(outsider.page.getByText(message, { exact: true })).toHaveCount(0);
      const deniedMessages = await outsider.api.from("messages").select("id").eq("conversation_id", conversationId);
      expect(isInvisibleDataResult(deniedMessages), "An unrelated conversation must be hidden by permissions, not a transport error").toBe(true);
    });

    await test.step("buyer requests, seller atomically accepts, and participants arrange an editable meetup", async () => {
      await buyer.page.goto(`/listing/${listingId}`);
      const requestButton = buyer.page.getByRole("button", { name: "Request Reservation", exact: true });
      await requestButton.focus();
      await requestButton.press("Enter");
      const requestDialog = buyer.page.getByRole("dialog", { name: "Request this item" });
      await expect(requestDialog).toBeVisible();
      await buyer.page.keyboard.press("Escape");
      await expect(requestDialog).not.toBeVisible();
      await expect(requestButton).toBeFocused();
      await requestButton.press("Space");
      await requestDialog.getByLabel(/Message to seller/).fill(requestNote);
      await requestDialog.getByRole("button", { name: "Send Request", exact: true }).click();
      await expect(requestDialog).not.toBeVisible();
      await expect(buyer.page.getByText("Reservation request pending", { exact: true })).toBeVisible();
      await buyer.page.reload();
      await buyer.page.getByRole("link", { name: "View Reservation", exact: true }).click();
      reservationId = new URL(buyer.page.url()).pathname.split("/")[2];
      const request = await buyer.api.from("reservations").select("id,buyer_id,seller_id,status").eq("id", reservationId).single();
      expect(request.data).toMatchObject({ buyer_id: buyer.account.id, seller_id: seller.account.id, status: "pending" });
      await seller.page.goto(`/reservations/${reservationId}`);
      await confirmAction(seller.page, "Accept");
      await expect(seller.page.getByRole("button", { name: "Arrange Meetup", exact: true })).toBeVisible();
      await buyer.page.reload();
      await expect(buyer.page.getByText("Accepted", { exact: true })).toBeVisible();
      const listing = await seller.api.from("listings").select("status").eq("id", listingId).single();
      expect(listing.data?.status).toBe("reserved");
      await buyer.page.getByRole("button", { name: "Arrange Meetup", exact: true }).click();
      const meetupDialog = buyer.page.getByRole("dialog", { name: "Arrange a meetup", exact: true });
      await meetupDialog.getByLabel("Public campus location").fill(campus);
      await meetupDialog.getByLabel(/Meeting point details/).fill("Synthetic test near the guard desk.");
      const tomorrowManila = new Date(Date.now() + 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
      await meetupDialog.getByLabel("Date and time").fill(tomorrowManila);
      await meetupDialog.getByLabel(/Notes/).fill(`QA ${runId}: No real exchange will occur.`);
      await meetupDialog.getByRole("button", { name: "Save Meetup", exact: true }).click();
      await expect(meetupDialog).not.toBeVisible();
      await buyer.page.reload();
      await expect(buyer.page.getByText(campus, { exact: true })).toBeVisible();
      await seller.page.reload();
      await expect(seller.page.getByText(campus, { exact: true })).toBeVisible();
      await seller.page.getByRole("button", { name: "Edit Meetup", exact: true }).click();
      const editMeetup = seller.page.getByRole("dialog", { name: "Edit meetup", exact: true });
      await editMeetup.getByLabel(/Meeting point details/).fill(`QA ${runId}: Updated meeting point.`);
      await editMeetup.getByRole("button", { name: "Save Meetup", exact: true }).click();
      await expect(editMeetup).not.toBeVisible();
      await buyer.page.reload();
      await expect(buyer.page.getByText(`QA ${runId}: Updated meeting point.`, { exact: true })).toBeVisible();
      await outsider.page.goto(`/reservations/${reservationId}`);
      await expect(outsider.page.getByText(campus, { exact: true })).toHaveCount(0);
      await expect(outsider.page.getByRole("heading", { name: "Reservation details" })).toHaveCount(0);
      const deniedMeetup = await outsider.api.from("meetups").select("id").eq("reservation_id", reservationId);
      expect(isInvisibleDataResult(deniedMeetup), "An unrelated meetup must be hidden by permissions, not a transport error").toBe(true);
      await expect(buyer.page.getByRole("button", { name: "Mark Sold", exact: true })).toHaveCount(0);
    });

    await test.step("seller completes exchange atomically; notifications and completed history survive refresh/logout/login", async () => {
      await confirmAction(seller.page, "Mark Sold");
      await expect(seller.page.getByText("Sold", { exact: true })).toBeVisible();
      await buyer.page.reload();
      await expect(buyer.page.getByText("Completed", { exact: true }).first()).toBeVisible();
      const [listing, reservation, meetup] = await Promise.all([
        seller.api.from("listings").select("status").eq("id", listingId).single(),
        buyer.api.from("reservations").select("status,completed_at").eq("id", reservationId).single(),
        buyer.api.from("meetups").select("status").eq("reservation_id", reservationId).single(),
      ]);
      expect(listing.data?.status).toBe("sold");
      expect(reservation.data?.status).toBe("completed");
      expect(reservation.data?.completed_at).toBeTruthy();
      expect(meetup.data?.status).toBe("completed");
      for (const session of [seller, buyer]) {
        await session.page.goto("/profile");
        await session.page.getByRole("button", { name: "Log Out", exact: true }).first().click();
        await expect(session.page).toHaveURL(/\/login(?:\?|$)/);
        await loginQaSession(session.page, session.account);
        await session.page.goto(`/reservations/${reservationId}`);
        await expect(session.page.getByText("Completed", { exact: true }).first()).toBeVisible();
        await session.page.goto(`/messages/${conversationId}`);
        await expect(session.page.getByRole("log").getByText(reply, { exact: true })).toBeVisible();
      }
      await buyer.page.goto(`/listing/${listingId}`);
      await expect(buyer.page.getByText("Sold", { exact: true })).toBeVisible();
      await expect(buyer.page.getByRole("button", { name: "Request Reservation", exact: true })).toHaveCount(0);
      await buyer.page.goto("/notifications");
      await expect(buyer.page.getByRole("list", { name: "Your notifications" })).toBeVisible();
      await buyer.page.getByRole("button", { name: "Mark all as read", exact: true }).click();
      await expect(buyer.page.getByRole("button", { name: "Mark all as read", exact: true })).toBeDisabled();
      await buyer.page.reload();
      await expect(buyer.page.getByRole("button", { name: "Mark all as read", exact: true })).toBeDisabled();
    });

    await test.step("private profile edits and avatar persist; public seller profile exposes no identity evidence", async () => {
      await seller.page.goto("/profile/edit");
      const year = seller.page.getByLabel("Year level", { exact: true });
      await expect(year).toBeVisible();
      const currentYear = await year.inputValue();
      const nextYear = currentYear === "2" ? "3" : "2";
      await year.selectOption(nextYear);
      await seller.page.getByRole("button", { name: "Save Profile", exact: true }).click();
      await expect(seller.page.getByText("Profile updated successfully.", { exact: true })).toBeVisible();
      await seller.page.reload();
      await expect(seller.page.getByLabel("Year level", { exact: true })).toHaveValue(nextYear);
      await seller.page.getByLabel("Choose profile photo").setInputFiles(qaImage);
      await seller.page.getByRole("button", { name: /^(Save Photo|Replace Photo)$/ }).click();
      await expect(seller.page.getByRole("button", { name: "Remove Profile Photo", exact: true })).toBeVisible();
      await seller.page.reload();
      await expect(seller.page.getByRole("button", { name: "Remove Profile Photo", exact: true })).toBeVisible();
      const profile = await seller.api.from("profiles").select("avatar_path,student_id_number").eq("id", seller.account.id).single();
      expect(profile.data?.avatar_path).toMatch(new RegExp(`^${seller.account.id}/`));
      await buyer.page.goto(`/users/${seller.account.id}`);
      const publicHTML = await buyer.page.content();
      expect(publicHTML).not.toContain(seller.account.email);
      expect(profile.data!.student_id_number).toBeTruthy();
      expect(publicHTML).not.toContain(profile.data!.student_id_number!);
      expect(publicHTML).not.toContain("student-verifications/");
      await expect(buyer.page.getByRole("heading", { name: /Reviews|Ratings/i })).toHaveCount(0);
      await seller.page.goto("/profile/change-password");
      await seller.page.getByLabel("Current password", { exact: true }).fill(seller.account.password);
      await seller.page.getByLabel("New password", { exact: true }).fill("weak-password-but-long");
      await seller.page.getByLabel("Confirm new password", { exact: true }).fill("weak-password-but-long");
      await seller.page.getByRole("button", { name: "Change Password", exact: true }).click();
      await expect(seller.page.locator("#profile-password-error")).not.toBeEmpty();
      // Actual password reset/email confirmation and nonce delivery require a
      // mailbox acceptance run; admin-confirmed fixtures do not prove delivery.
    });

    await test.step("admin suspension applies to an existing browser session, then reactivation restores access", async () => {
      await admin.page.goto(`/admin/users/${buyer.account.id}`);
      await moderate(admin.page, "Suspend account", /Suspend this account/, "Reason for suspension", `QA ${runId}: Temporary isolated suspension test.`);
      await buyer.page.goto("/messages");
      await expect(buyer.page).toHaveURL(/\/account-status$/);
      await buyer.page.goto("/profile");
      await expect(buyer.page).toHaveURL(/\/profile$/);
      await admin.page.reload();
      await moderate(admin.page, "Reactivate account", /Reactivate this account/, "Reason for reactivation", `QA ${runId}: Isolated account reactivation test.`);
      await buyer.page.goto("/marketplace");
      await expect(buyer.page).toHaveURL(/\/marketplace$/);
    });

    await test.step("responsive authenticated pages and controls fit mobile and desktop widths", async () => {
      const routes = ["/marketplace", `/listing/${listingId}`, "/sell", "/favorites", `/messages/${conversationId}`, `/reservations/${reservationId}`, "/notifications", "/profile"];
      for (const width of [375, 390, 430, 1280, 1440, 1920]) {
        await buyer.page.setViewportSize({ width, height: 900 });
        for (const route of routes) {
          await buyer.page.goto(route);
          await expectNoHorizontalOverflow(buyer.page);
          for (const button of await buyer.page.getByRole("button").all()) await expect(button).toHaveAccessibleName(/.+/);
        }
        await admin.page.setViewportSize({ width, height: 900 });
        await admin.page.goto("/admin/reports");
        await expectNoHorizontalOverflow(admin.page);
      }
    });

    await test.step("admin removal persists and sold content does not return to marketplace browsing", async () => {
      await admin.page.goto(`/admin/listings/${listingId}`);
      await moderate(admin.page, "Remove listing", /Remove this listing/, "Reason for removal", `QA ${runId}: Remove completed isolated test content.`);
      const listing = await admin.api.from("listings").select("status").eq("id", listingId).single();
      expect(listing.data?.status).toBe("removed");
      await seller.page.goto(`/listing/${listingId}/edit`);
      await expect(seller.page.getByLabel("Title", { exact: true })).toHaveCount(0);
      await buyer.page.goto(`/marketplace?search=${encodeURIComponent(title)}`);
      await expect(buyer.page.getByRole("link", { name: title, exact: true })).toHaveCount(0);
    });

    await test.step("fresh-session password change rejects the old password and accepts a generated new one", async () => {
      const nextPassword = `Qa-${randomUUID()}-9!`;
      await seller.page.goto("/profile/change-password");
      await seller.page.getByLabel("Current password", { exact: true }).fill(seller.account.password);
      await seller.page.getByLabel("New password", { exact: true }).fill(nextPassword);
      await seller.page.getByLabel("Confirm new password", { exact: true }).fill(nextPassword);
      await seller.page.getByRole("button", { name: "Change Password", exact: true }).click();
      await expect(seller.page.getByText(/Password updated successfully/)).toBeVisible();
      const oldPassword = await seller.api.auth.signInWithPassword({ email: seller.account.email, password: seller.account.password });
      expect(oldPassword.error?.code, "Auth must reject the old password, not fail with a transport or rate-limit error").toBe("invalid_credentials");
      await seller.page.goto("/profile");
      await seller.page.getByRole("button", { name: "Log Out", exact: true }).first().click();
      await expect(seller.page).toHaveURL(/\/login(?:\?|$)/);
      await loginQaSession(seller.page, { ...seller.account, password: nextPassword });
      await seller.page.goto("/profile");
      await expect(seller.page).toHaveURL(/\/profile$/);
      // Integration cleanup uses run-owned Auth IDs, not passwords. The newly
      // generated password stays in memory and is never written to fixtures.
    });

    await test.step("logging out the administrator removes browser access to private verification evidence", async () => {
      await admin.page.goto("/profile");
      await admin.page.getByRole("button", { name: "Log Out", exact: true }).first().click();
      await expect(admin.page).toHaveURL(/\/login(?:\?|$)/);
      const response = await admin.page.request.get(`/admin/verifications/${privateVerificationId}/document`, { maxRedirects: 0 });
      expect([401, 403, 307, 308]).toContain(response.status());
      expect(response.headers()["content-type"] ?? "").not.toMatch(/^image\//);
      expect(response.headers()["cache-control"] ?? "").toContain("no-store");
    });

    for (const session of sessions) expect(session.errors, `${session.account.role} must not produce uncaught browser errors`).toEqual([]);
  } finally {
    // The integration runner removes records belonging to its run-owned Auth
    // users. Do not delete arbitrary account history from browser test code.
    await closeQaSessions(sessions);
  }
});

async function submitVerification(page: Page) {
  await page.goto("/verification");
  await page.locator("#school-id-image").setInputFiles(qaImage);
  await expect(page.getByRole("img", { name: "Preview of your selected school ID" })).toBeVisible();
  await page.getByRole("checkbox", { name: /I understand that my school ID/ }).check();
  await page.getByRole("button", { name: "Submit for verification", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verification pending" })).toBeVisible();
}
