import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createManagementApi, fixtureStoragePaths, staging, validateFixtureCredentials, verifyStagingProject } from "./lib.mjs";
import { QA_IMAGE, qaFailureMetadata } from "../qa/lib/fixtures.mjs";

const marker = "uc-marketplace-staging-v1";
let phase = "preflight";
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) }) } };
function data(result) {
  if (result.error) throw Object.assign(new Error("Staging synthetic fixture operation failed; private details withheld."), qaFailureMetadata(result));
  return result.data;
}
function uuid(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid staging fixture identity.");
  return value;
}

try {
  if (process.argv.length !== 2) throw new Error("Staging seed does not accept command-line credentials.");
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 5000) throw new Error("Staging credential input exceeded its limit.");
  }
  const fixtures = validateFixtureCredentials(JSON.parse(input));
  const api = createManagementApi(process.env);
  await verifyStagingProject(api);
  const auth = await api("/config/auth");
  if (!auth.disable_signup || auth.smtp_host !== "smtp.example.invalid" || auth.site_url !== staging.appOrigin) {
    throw new Error("Staging seed requires closed signups, the non-delivering SMTP sink, and the registered staging origin.");
  }
  const url = `https://${staging.supabaseProjectRef}.supabase.co`;
  const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY;
  const publicKey = process.env.STAGING_PUBLISHABLE_KEY;
  if (!serviceKey || !publicKey || serviceKey === publicKey) throw new Error("Staging requires separate private operator and public application keys.");
  // Establish key/project provenance before any Auth/Storage write. A copied
  // production key is rejected, not tried against the production host.
  const keys = await api("/api-keys");
  if (!keys.some((key) => key.api_key === serviceKey && (key.name === "service_role" || key.type === "secret"))
      || !keys.some((key) => key.api_key === publicKey && (key.name === "anon" || key.type === "publishable"))) {
    throw new Error("Staging API key provenance check failed.");
  }
  const admin = createClient(url, serviceKey, options);
  phase = "schema preflight";
  for (const table of ["profiles", "categories", "meetups", "verifications"]) data(await admin.from(table).select("id").limit(0));
  const existing = data(await admin.auth.admin.listUsers({ page: 1, perPage: 100 }));
  if (existing.users.length > fixtures.length || existing.users.some((user) => user.app_metadata.staging_fixture !== marker
      || !fixtures.some((fixture) => fixture.email === user.email))) {
    throw new Error("Staging contains non-owned accounts; seed refuses adoption or modification.");
  }
  const accounts = {};
  for (const fixture of fixtures) {
    phase = `synthetic ${fixture.role} account`;
    const owned = existing.users.find((user) => user.email === fixture.email);
    const user = owned ?? data(await admin.auth.admin.createUser({ email: fixture.email, password: fixture.password,
      email_confirm: true, app_metadata: { staging_fixture: marker },
      user_metadata: { full_name: `STAGING TEST ${fixture.role}`, student_id_number: `TEST-${fixture.role.toUpperCase()}`,
        course: "BSIT", year_level: 3 } })).user;
    uuid(user.id);
    const client = createClient(url, publicKey, options);
    data(await client.auth.signInWithPassword({ email: fixture.email, password: fixture.password }));
    accounts[fixture.role] = { id: user.id, client };
  }
  // Only this known synthetic administrator may be bootstrapped by an operator.
  // All student verification/suspension uses the existing authorized RPCs.
  const adminId = uuid(accounts.admin.id);
  phase = "administrator bootstrap";
  const bootstrapped = await api("/database/query", { method: "POST", body: { query: `
update public.profiles p set role='admin',verification_status='verified',account_status='active'
from auth.users u where p.id=u.id and p.id='${adminId}'::uuid
and u.email='staging-admin@example.test' and u.raw_app_meta_data->>'staging_fixture'='${marker}' returning p.id;` } });
  if (bootstrapped.length !== 1 || bootstrapped[0].id !== adminId) throw new Error("Staging administrator ownership check failed.");
  const moderator = accounts.admin.client;
  for (const role of ["seller", "buyer", "suspended", "pending"]) {
    phase = `synthetic ${role} verification`;
    const account = accounts[role];
    const profile = data(await account.client.from("profiles").select("verification_status,account_status").eq("id", account.id).single());
    if (profile.verification_status === "unverified") {
      const id = randomUUID();
      const document = fixtureStoragePaths(account.id, id).verification;
      data(await account.client.storage.from("student-verifications").upload(document, QA_IMAGE, { contentType: "image/png", upsert: false }));
      data(await account.client.rpc("submit_verification", { p_verification_id: id, p_document_path: document }));
    }
    if (role !== "pending") {
      const state = data(await account.client.from("profiles").select("verification_status").eq("id", account.id).single());
      if (state.verification_status === "pending") {
        const record = data(await admin.from("verifications").select("id").eq("user_id", account.id).eq("status", "pending").single());
        data(await moderator.rpc("review_verification", { p_verification_id: record.id, p_decision: "approved" }));
      }
    }
    if (role === "suspended" && profile.account_status !== "suspended") {
      data(await moderator.rpc("admin_moderate_user", { p_user_id: account.id, p_account_status: "suspended", p_reason: "Synthetic staging suspension scenario; no real student." }));
    }
  }
  const category = data(await accounts.seller.client.from("categories").select("id").eq("is_active", true).limit(1))[0];
  if (!category?.id) throw new Error("Staging requires migrated categories.");
  for (const [index, title] of ["STAGING TEST calculator", "STAGING TEST textbook"].entries()) {
    phase = "synthetic listing";
    const seller = accounts.seller;
    let listing = data(await seller.client.from("listings").select("id,status").eq("seller_id", seller.id).eq("title", title).maybeSingle());
    if (!listing) listing = data(await seller.client.from("listings").insert({ id: randomUUID(), seller_id: seller.id,
      submission_token: randomUUID(), category_id: category.id, title,
      description: "Synthetic staging demonstration only. Not for sale. Image is a generated 1-pixel placeholder.",
      price: index ? 100 : 650, condition: "good" }).select("id,status").single());
    if (listing.status === "draft") {
      phase = "synthetic listing images";
      // Production publication requires UUID image filenames. The bytes remain
      // a synthetic placeholder, regardless of this policy-required filename.
      const imagePath = fixtureStoragePaths(seller.id, listing.id).listing;
      const legacyPath = `${seller.id}/${listing.id}/synthetic-placeholder.png`;
      let images = data(await seller.client.from("listing_images").select("id,storage_path").eq("listing_id", listing.id));
      for (const old of images.filter((image) => image.storage_path === legacyPath)) {
        // Repair only our original unfinished synthetic placeholder. Ordinary
        // students correctly lack direct image-metadata DELETE privileges.
        const repaired = await api("/database/query", { method: "POST", body: { query: `
delete from public.listing_images image using public.listings listing,auth.users account
where image.id='${uuid(old.id)}'::uuid and image.listing_id=listing.id and listing.id='${uuid(listing.id)}'::uuid
and listing.seller_id=account.id and account.id='${uuid(seller.id)}'::uuid and listing.status='draft'
and account.email='staging-seller@example.test' and account.raw_app_meta_data->>'staging_fixture'='${marker}'
and image.storage_path=account.id::text||'/'||listing.id::text||'/synthetic-placeholder.png' returning image.id;` } });
        if (repaired.length !== 1 || repaired[0].id !== old.id) throw new Error("Synthetic placeholder ownership check failed.");
        data(await seller.client.storage.from("listing-images").remove([legacyPath]));
      }
      images = images.filter((image) => image.storage_path !== legacyPath);
      if (!images.length) {
        // A retry can encounter an uploaded object whose metadata insert failed.
        const uploaded = await seller.client.storage.from("listing-images").upload(imagePath, QA_IMAGE, { contentType: "image/png", upsert: false });
        if (uploaded.error && !["Duplicate", "ResourceAlreadyExists", "KeyAlreadyExists"].includes(uploaded.error.code)
            && String(uploaded.error.statusCode) !== "409") data(uploaded);
        data(await seller.client.from("listing_images").insert({ listing_id: listing.id, storage_path: imagePath, is_cover: true, sort_order: 0 }));
      }
      phase = "synthetic listing publication";
      data(await seller.client.rpc("publish_listing", { p_listing_id: listing.id }));
    }
    const buyer = accounts.buyer.client;
    phase = "synthetic favorites";
    data(await buyer.rpc("set_listing_favorite", { p_listing_id: listing.id, p_should_favorite: true }));
    if (!index) {
      phase = "synthetic conversation";
      const conversation = data(await buyer.rpc("start_listing_conversation", { p_listing_id: listing.id }));
      const messages = data(await buyer.from("messages").select("id").eq("conversation_id", conversation).limit(1));
      if (!messages.length) {
        data(await buyer.rpc("send_conversation_message", { p_conversation_id: conversation, p_body: "STAGING TEST: May we use this synthetic listing for an acceptance test?" }));
        data(await seller.client.rpc("send_conversation_message", { p_conversation_id: conversation, p_body: "STAGING TEST: Yes. This is not a real transaction." }));
      }
      let reservation = data(await buyer.from("reservations").select("id,status").eq("listing_id", listing.id).eq("buyer_id", accounts.buyer.id).in("status", ["pending", "accepted"]).maybeSingle());
      phase = "synthetic reservation and meetup";
      if (!reservation) reservation = { id: data(await buyer.rpc("request_reservation", { p_listing_id: listing.id, p_message: "Synthetic staging reservation; no purchase." })), status: "pending" };
      if (reservation.status === "pending") data(await seller.client.rpc("accept_reservation", { p_reservation_id: reservation.id }));
      const meetup = data(await buyer.from("meetups").select("id").eq("reservation_id", reservation.id).maybeSingle());
      if (!meetup) data(await buyer.rpc("upsert_meetup", { p_reservation_id: reservation.id,
        p_location_name: "STAGING TEST - no actual meeting", p_location_details: "Synthetic acceptance scenario only",
        p_scheduled_at: new Date(Date.now() + 7 * 86400000).toISOString(), p_notes: "No real students or physical meetup." }));
    }
  }
  for (const account of Object.values(accounts)) data(await account.client.auth.signOut({ scope: "local" }));
  console.log("Staging synthetic fixtures ready: 5 accounts, 2 listings, private placeholder verification records, favorites, messages, reservation and meetup. Credentials were not logged.");
} catch (error) {
  console.log(`Staging seed stopped during ${phase} (${error?.qaErrorCode ?? "validation"}; HTTP ${error?.qaHttpStatus ?? "unavailable"}). Private details withheld; existing data was not reset.`);
  process.exitCode = 1;
}
