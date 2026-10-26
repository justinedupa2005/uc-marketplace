import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect } from "@playwright/test";
import { registry } from "./vercel.mjs";
import { isExpectedStorageDenial } from "../qa/lib/api-results.mjs";

// Synthetic staging-only acceptance. No privileged keys, identity photographs,
// account creation, email, database reset or production resource is involved.
export async function testStagingPrivateUploads(page, input, check) {
  const origin = registry.staging.appOrigin;
  const database = `https://${registry.staging.supabaseProjectRef}.supabase.co`;
  const client = createClient(database, input.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const anonymous = createClient(database, input.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const title = `STAGING ACCEPTANCE ${input.sha.slice(0, 8)} ${randomUUID().slice(0, 8)}`;
  let ownerId, listingId, maximumActionBytes = 0, storageTransfers = 0;
  const observe = (request) => {
    const url = new URL(request.url());
    if (url.origin === origin && request.method() === "POST" && request.headers()["next-action"]) {
      maximumActionBytes = Math.max(maximumActionBytes, request.postDataBuffer()?.length ?? 0);
    }
    if (url.origin === database && request.method() === "POST" && url.pathname.startsWith("/storage/v1/object/listing-images/")) storageTransfers++;
  };
  page.on("request", observe);
  try {
    const auth = await client.auth.signInWithPassword({ email: "staging-seller@example.test", password: input.accounts.seller });
    check(!auth.error && auth.data.user?.app_metadata?.staging_fixture === "uc-marketplace-staging-v1");
    ownerId = auth.data.user.id;
    const profile = await client.from("profiles").select("role,verification_status,account_status").eq("id", ownerId).single();
    check(!profile.error && profile.data.role === "student" && profile.data.verification_status === "verified" && profile.data.account_status === "active");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgsFjxHwAC/AHgoLvpmAAAAABJRU5ErkJggg==", "base64");
    const large = { name: "staging-synthetic-5mb.png", mimeType: "image/png", buffer: Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 - png.length)]) };
    await page.goto("/sell");
    await page.getByLabel("Product Title").fill(title);
    await page.getByRole("textbox", { name: "Description", exact: true }).fill("Synthetic hosted upload acceptance only. No real product or student identity information.");
    const category = page.getByRole("combobox", { name: "Category", exact: true });
    const categoryId = await category.locator("option").evaluateAll((options) => options.map((option) => option.value).find(Boolean));
    assert.ok(categoryId);
    await category.selectOption(categoryId);
    await page.getByRole("radio", { name: /^Good/ }).check();
    await page.getByLabel("Price (PHP)").fill("0");
    await page.locator("#listing-images").setInputFiles([large, { name: "staging-synthetic-small.png", mimeType: "image/png", buffer: png }]);
    await page.getByRole("button", { name: "Publish Listing", exact: true }).click();
    await page.waitForURL((url) => url.origin === origin && /^\/listing\/[a-f0-9-]{36}$/.test(url.pathname), { timeout: 90_000 });
    listingId = new URL(page.url()).pathname.split("/")[2];
    const listing = await client.from("listings").select("id,status,title,seller_id").eq("id", listingId).eq("seller_id", ownerId).single();
    check(!listing.error && listing.data.status === "available" && listing.data.title === title);
    const images = await client.from("listing_images").select("storage_path,sort_order,is_cover").eq("listing_id", listingId).order("sort_order");
    check(!images.error && images.data.length === 2 && images.data[0].is_cover && images.data[0].sort_order === 0);
    const info = await client.storage.from("listing-images").info(images.data[0].storage_path);
    check(!info.error && info.data.size === 5 * 1024 * 1024 && info.data.contentType === "image/png");
    check(isExpectedStorageDenial(await anonymous.storage.from("listing-images").download(images.data[0].storage_path)));
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await page.locator("#edit-listing-images").setInputFiles(large);
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await page.waitForURL((url) => url.origin === origin && url.pathname === `/listing/${listingId}`, { timeout: 90_000 });
    await page.reload();
    const edited = await client.from("listing_images").select("storage_path").eq("listing_id", listingId);
    check(!edited.error && edited.data.length === 3);
    await expect(page.locator("main [role=alert]")).toHaveCount(0);
    check(storageTransfers === 3 && maximumActionBytes > 0 && maximumActionBytes < 256 * 1024);
    return { status: "passed", listingCreate: true, listingEdit: true, maximumFileBytes: large.buffer.length,
      storageTransfers, maximumActionBytes, anonymousStorageDenied: true, syntheticListingArchived: true };
  } finally {
    page.off("request", observe);
    try {
      if (ownerId) {
        // Recover this run's exact listing even if the publication response was
        // lost. Archive only the owned synthetic record; retain audit/Storage
        // evidence rather than bypassing published-image deletion policies.
        const result = await client.from("listings").select("id,status").eq("seller_id", ownerId).eq("title", title).maybeSingle();
        assert.ok(!result.error);
        if (result.data && result.data.status !== "draft" && result.data.status !== "removed") {
          const removed = await client.rpc("set_owned_listing_status", { p_listing_id: result.data.id, p_status: "removed" });
          assert.ok(!removed.error);
          const confirmed = await client.from("listings").select("status").eq("id", result.data.id).single();
          assert.ok(!confirmed.error && confirmed.data.status === "removed");
        }
      }
    } finally {
      const logout = await client.auth.signOut({ scope: "local" });
      assert.ok(!logout.error);
    }
  }
}
