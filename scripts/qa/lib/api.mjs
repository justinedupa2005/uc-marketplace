import { randomUUID } from "node:crypto";
import { isExpectedDataDenial, isExpectedStorageDenial, isInvisibleDataResult, isSuccessfulApiResult, isUnchangedStorageResult } from "./api-results.mjs";
import { qaFailureMetadata } from "./fixtures.mjs";
import { setFixtureProfileState } from "./fixture-state.mjs";

// A valid, non-private 1x1 PNG. Every object is uploaded through the tested
// account's normal Storage API, not inserted into storage.objects by service role.
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgsFjxHwAC/AHgoLvpmAAAAABJRU5ErkJggg==", "base64");
const rowCount = (result) => Array.isArray(result.data) ? result.data.length : result.data ? 1 : 0;
class ApiCheckError extends Error {}

export async function runApiChecks(context) {
  try {
    return await runChecks(context);
  } catch (error) {
    if (error instanceof ApiCheckError) throw error;
    // SDK/network exceptions may contain endpoint or credential information.
    throw Object.assign(new Error("Direct API security checks could not complete. Inspect the local QA service health."), qaFailureMetadata({ error }));
  }
}

async function runChecks(context) {
  const { admin, accounts, runId } = context;
  const { seller, buyer, competitor, suspended, pending, rejected } = accounts;
  const moderator = accounts.admin.client;
  let count = 0;
  function check(condition, label, result) {
    if (!condition) throw Object.assign(new ApiCheckError(`Direct API security check failed: ${label}.`), qaFailureMetadata(result), { qaAssertionIndex: count + 1 });
    count += 1;
  }
  async function success(request, label) {
    const result = await request;
    check(isSuccessfulApiResult(result), label, result);
    return result.data;
  }
  async function denied(request, label, codes) {
    const result = await request;
    check(isExpectedDataDenial(result, codes), label, result);
  }
  async function storageDenied(request, label) {
    const result = await request;
    check(isExpectedStorageDenial(result), label, result);
  }
  async function invisible(request, label, codes) {
    const result = await request;
    check(isInvisibleDataResult(result, codes), label, result);
  }
  async function unchanged(request, inspect, expected, label) {
    const result = await request;
    check(isInvisibleDataResult(result), `${label}: unauthorized mutation returns no changed rows`, result);
    const current = await success(inspect, `${label}: trusted state inspection`);
    check(Object.entries(expected).every(([key, value]) => current?.[key] === value), `${label}: persisted values remain unchanged`);
  }
  async function profileState(account) {
    return success(account.client.from("profiles").select("id,role,verification_status,account_status,full_name,course,year_level,avatar_path").eq("id", account.id).single(), "own private profile remains readable");
  }

  // A positive Auth/profile baseline makes network failures distinguishable
  // from expected RLS-empty reads in the later negative cases.
  for (const account of Object.values(accounts)) {
    const auth = await account.client.auth.getUser();
    check(!auth.error && auth.data.user?.id === account.id, "dedicated account has a validated Auth identity", auth);
  }
  check((await profileState(accounts.admin)).role === "admin", "admin authority comes from profiles.role");
  check((await profileState(seller)).verification_status === "verified", "seller is verified");
  check((await profileState(buyer)).verification_status === "verified", "buyer is verified");
  check((await profileState(suspended)).account_status === "suspended", "suspended QA account is restricted");

  for (const [account, field, value] of [[buyer, "role", "admin"], [pending, "verification_status", "verified"], [suspended, "account_status", "active"]]) {
    const before = await profileState(account);
    await unchanged(account.client.from("profiles").update({ [field]: value }).eq("id", account.id).select("id"), admin.from("profiles").select(field).eq("id", account.id).single(), { [field]: before[field] }, "protected profile field cannot be escalated");
  }
  const sellerBefore = await profileState(seller);
  await unchanged(buyer.client.from("profiles").update({ year_level: sellerBefore.year_level === 5 ? 4 : 5 }).eq("id", seller.id).select("id"), admin.from("profiles").select("year_level").eq("id", seller.id).single(), { year_level: sellerBefore.year_level }, "student cannot edit another private profile");
  await invisible(buyer.client.from("profiles").select("id,student_id_number").eq("id", seller.id), "another student's private profile/student ID is hidden");
  await success(buyer.client.auth.updateUser({ data: { role: "admin", verification_status: "verified", account_status: "active" } }), "Auth metadata tampering request is independent from database privileges");
  check((await profileState(buyer)).role === "student", "forged Auth user metadata cannot grant admin");
  const publicSeller = await success(buyer.client.from("marketplace_profiles").select("*").eq("id", seller.id).single(), "public seller profile is readable to an eligible student");
  const publicFields = new Set(["id", "full_name", "course", "year_level", "avatar_path", "verification_status", "created_at"]);
  check(Object.keys(publicSeller).every((field) => publicFields.has(field)), "public seller projection excludes email, student ID, role, account status, and verification documents");

  // Exercise student-verification rejection, resubmission, and approval on a
  // competitor-owned fixture. Main pending/rejected browser fixtures stay intact.
  check(await setFixtureProfileState(context, competitor.id, {
    role: "student", verification_status: "rejected", account_status: "active",
  }) === competitor.id, "prepare isolated competitor verification fixture");
  async function submitCompetitorVerification() {
    const verificationId = randomUUID();
    const documentPath = `${competitor.id}/${verificationId}/student-id.png`;
    await success(competitor.client.storage.from("student-verifications").upload(documentPath, image, { contentType: "image/png", upsert: false }), "school ID upload succeeds in owner's private folder");
    const submitted = await success(competitor.client.rpc("submit_verification", { p_verification_id: verificationId, p_document_path: documentPath }), "real school-ID submission succeeds");
    check(submitted === verificationId, "verification RPC returns the owned submission");
    return { verificationId, documentPath };
  }
  const firstVerification = await submitCompetitorVerification();
  await denied(buyer.client.rpc("review_verification", { p_verification_id: firstVerification.verificationId, p_decision: "approved" }), "student cannot call verification approval RPC");
  await denied(moderator.rpc("review_verification", { p_verification_id: firstVerification.verificationId, p_decision: "rejected", p_rejection_reason: "" }), "admin rejection requires a reason", ["22023"]);
  await success(moderator.rpc("review_verification", { p_verification_id: firstVerification.verificationId, p_decision: "rejected", p_rejection_reason: "QA document requires a clearer resubmission." }), "authorized admin rejects verification");
  check((await profileState(competitor)).verification_status === "rejected", "rejection is persisted in student's own profile");
  const secondVerification = await submitCompetitorVerification();
  await success(moderator.rpc("review_verification", { p_verification_id: secondVerification.verificationId, p_decision: "approved" }), "authorized admin approves resubmitted verification");
  check((await profileState(competitor)).verification_status === "verified", "verification approval unlocks the competitor account");
  const adminDocument = await moderator.storage.from("student-verifications").download(secondVerification.documentPath);
  check(!adminDocument.error && adminDocument.data?.size > 0, "admin can privately review school-ID bytes", adminDocument);
  const signingStartedAt = Math.floor(Date.now() / 1000);
  const signedDocument = await success(moderator.storage.from("student-verifications").createSignedUrl(secondVerification.documentPath, 60), "authorized admin can issue a short-lived private verification URL");
  let signedClaims;
  try { signedClaims = JSON.parse(Buffer.from(new URL(signedDocument.signedUrl).searchParams.get("token").split(".")[1], "base64url").toString("utf8")); } catch { /* The assertion below fails closed. */ }
  check(Number.isSafeInteger(signedClaims?.exp) && signedClaims.exp > signingStartedAt && signedClaims.exp <= signingStartedAt + 65,
    "private verification signing has a bounded one-minute lifetime");
  const signedDownload = await fetch(signedDocument.signedUrl, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  check(signedDownload.ok, "authorized short-lived verification URL downloads the synthetic placeholder");
  await storageDenied(buyer.client.storage.from("student-verifications").download(secondVerification.documentPath), "another student cannot download private school ID");
  await invisible(buyer.client.from("verifications").select("id,document_path,rejection_reason").eq("user_id", competitor.id), "another student's verification details are not returned");
  await storageDenied(buyer.client.storage.from("student-verifications").createSignedUrl(secondVerification.documentPath, 60), "another student cannot sign private school-ID access");
  const publicSchoolIdUrl = buyer.client.storage.from("student-verifications").getPublicUrl(secondVerification.documentPath).data.publicUrl;
  const publicSchoolIdResponse = await fetch(publicSchoolIdUrl, { redirect: "manual" });
  check([400, 401, 403, 404].includes(publicSchoolIdResponse.status), "school-ID bucket cannot be downloaded through a public object URL", { status: publicSchoolIdResponse.status });

  const categories = await success(seller.client.from("categories").select("id").eq("is_active", true).limit(1), "an active listing category exists");
  check(Boolean(categories?.[0]?.id), "listing fixture has a real active category");
  const categoryId = categories[0].id;
  async function listingFixture(owner, suffix, price = 650) {
    const listingId = randomUUID();
    const storagePath = `${owner.id}/${listingId}/${randomUUID()}.png`;
    const draft = await success(owner.client.from("listings").insert({ id: listingId, seller_id: owner.id, submission_token: randomUUID(), category_id: categoryId, title: `QA ${runId} ${suffix} calculator`, description: "QA description-only-keyword scientific calculator in good working order.", price, condition: "good" }).select("id,status").single(), "seller creates own listing draft");
    check(draft.id === listingId && draft.status === "draft", "listing is private draft before image upload");
    await success(owner.client.storage.from("listing-images").upload(storagePath, image, { contentType: "image/png", upsert: false }), "seller uploads real listing image under owned path");
    await success(owner.client.from("listing_images").insert({ listing_id: listingId, storage_path: storagePath, is_cover: true, sort_order: 0 }), "seller records their owned listing image");
    check(await success(owner.client.rpc("publish_listing", { p_listing_id: listingId }), "seller publishes complete image-backed draft") === listingId, "published listing ID is stable");
    return { id: listingId, path: storagePath, price };
  }
  const listing = await listingFixture(seller, "workflow");
  const moderatedListing = await listingFixture(seller, "moderation", 1200);
  const unrelatedListing = await listingFixture(competitor, "unrelated", 500);
  const editable = await success(seller.client.from("listings").select("updated_at").eq("id", listing.id).single(), "owner can load listing edit version");
  const editArgs = { p_listing_id: listing.id, p_expected_updated_at: editable.updated_at, p_title: `QA ${runId} workflow calculator updated`, p_description: "QA description-only-keyword scientific calculator in good working order.", p_category_id: categoryId, p_price: 650, p_condition: "good", p_image_paths: [listing.path] };
  await success(seller.client.rpc("update_owned_listing", editArgs), "owner saves listing details through authorized versioned RPC");
  await denied(seller.client.rpc("update_owned_listing", { ...editArgs, p_title: "Stale update must not replace current title" }), "stale listing version cannot overwrite a successful owner edit", ["PT409"]);
  await denied(buyer.client.rpc("update_owned_listing", editArgs), "buyer cannot bypass ownership through listing edit RPC");
  const visible = await success(buyer.client.from("listings").select("id,title,price,status,seller_id").eq("id", listing.id).single(), "buyer sees persisted available listing");
  check(visible.status === "available" && visible.seller_id === seller.id && visible.title === editArgs.p_title, "listing has real seller, owner edit, and available state");
  const imageDownload = await buyer.client.storage.from("listing-images").download(listing.path);
  check(!imageDownload.error && imageDownload.data?.size > 0, "eligible buyer can read available listing image", imageDownload);
  const found = await success(buyer.client.from("listings").select("id,price").eq("seller_id", seller.id).ilike("title", `%${runId}%`).eq("category_id", categoryId).eq("condition", "good").gte("price", 500).lte("price", 1000), "real title search with category/condition/price filters succeeds");
  check(found.length === 1 && found[0].id === listing.id, "combined search returns only matching listing");
  const described = await success(buyer.client.from("listings").select("id").eq("id", listing.id).ilike("description", "%DESCRIPTION-ONLY-KEYWORD%"), "description search is case-insensitive");
  check(described.length === 1, "description-only keyword finds persisted listing");
  const ascending = await success(buyer.client.from("listings").select("id,price").in("id", [listing.id, moderatedListing.id, unrelatedListing.id]).order("price", { ascending: true }), "price sort is performed by database");
  check(ascending.map((row) => Number(row.price)).join(",") === "500,650,1200", "database price ordering is correct");

  for (const [field, value] of [["title", "Hacked"], ["seller_id", buyer.id], ["status", "sold"], ["status", "removed"], ["status", "reserved"]]) {
    await unchanged(buyer.client.from("listings").update({ [field]: value }).eq("id", listing.id).select("id"), admin.from("listings").select(field).eq("id", listing.id).single(), { [field]: visible[field] ?? "available" }, "buyer cannot alter seller-owned listing");
  }
  await unchanged(buyer.client.from("listings").delete().eq("id", listing.id).select("id"), admin.from("listings").select("id").eq("id", listing.id).single(), { id: listing.id }, "buyer cannot delete seller listing");
  await denied(buyer.client.from("listings").insert({ id: randomUUID(), seller_id: seller.id, category_id: categoryId, title: `QA ${runId} forged seller`, description: "An unauthorized ownership assignment must be rejected.", price: 10, condition: "good", submission_token: randomUUID() }), "listing insert cannot forge seller_id");
  await denied(buyer.client.rpc("set_owned_listing_status", { p_listing_id: listing.id, p_status: "removed" }), "buyer cannot call seller removal RPC for another listing");
  await storageDenied(buyer.client.storage.from("listing-images").upload(listing.path, image, { contentType: "image/png", upsert: true }), "buyer cannot overwrite another seller's image");
  await storageDenied(buyer.client.storage.from("listing-images").upload(`${seller.id}/${listing.id}/${randomUUID()}.png`, image, { contentType: "image/png", upsert: false }), "buyer cannot upload into another seller's folder");
  const crossDelete = await buyer.client.storage.from("listing-images").remove([listing.path]);
  check(isUnchangedStorageResult(crossDelete), "buyer Storage deletion changes no other seller objects", crossDelete);
  check(!(await seller.client.storage.from("listing-images").download(listing.path)).error, "seller image survives unauthorized deletion");
  const referencedDelete = await seller.client.storage.from("listing-images").remove([listing.path]);
  check(isUnchangedStorageResult(referencedDelete), "even owner cannot delete a currently referenced published image", referencedDelete);

  const avatarPath = `${buyer.id}/${randomUUID()}.png`;
  const invalidAvatar = await buyer.client.storage.from("avatars").upload(`${buyer.id}/${randomUUID()}.png`, image, { contentType: "application/pdf", upsert: false });
  check(invalidAvatar.error?.code === "InvalidMimeType", "Storage HTTP enforces avatar MIME restrictions", invalidAvatar);
  const oversizedAvatar = await buyer.client.storage.from("avatars").upload(`${buyer.id}/${randomUUID()}.png`, Buffer.alloc(2 * 1024 * 1024 + 1), { contentType: "image/png", upsert: false });
  check(oversizedAvatar.error?.code === "EntityTooLarge", "Storage HTTP enforces the two MiB avatar limit", oversizedAvatar);
  await denied(buyer.client.from("profiles").update({ avatar_path: `${buyer.id}/${randomUUID()}.png` }).eq("id", buyer.id), "profile cannot link an avatar object that does not exist", ["23514"]);
  await success(buyer.client.storage.from("avatars").upload(avatarPath, image, { contentType: "image/png", upsert: false }), "student uploads own avatar");
  await success(buyer.client.from("profiles").update({ avatar_path: avatarPath }).eq("id", buyer.id).select("id").single(), "student links real owned avatar object");
  await denied(seller.client.from("profiles").update({ avatar_path: avatarPath }).eq("id", seller.id), "profile cannot link another student's avatar", ["23514"]);
  await storageDenied(seller.client.storage.from("avatars").upload(avatarPath, image, { contentType: "image/png", upsert: true }), "avatar overwrite is owner-scoped and immutable");
  const referencedAvatarDelete = await buyer.client.storage.from("avatars").remove([avatarPath]);
  check(isUnchangedStorageResult(referencedAvatarDelete), "linked avatar object cannot be removed prematurely", referencedAvatarDelete);
  check(!(await buyer.client.storage.from("avatars").download(avatarPath)).error, "linked avatar remains present");
  await success(buyer.client.from("profiles").update({ avatar_path: null }).eq("id", buyer.id), "student unlinks own avatar");
  const avatarRemoval = await buyer.client.storage.from("avatars").remove([avatarPath]);
  check(!avatarRemoval.error && rowCount(avatarRemoval) === 1, "unreferenced owner avatar can be cleaned up", avatarRemoval);

  for (let attempt = 0; attempt < 2; attempt += 1) check(await success(buyer.client.rpc("set_listing_favorite", { p_listing_id: listing.id, p_should_favorite: true }), "idempotent favorite insertion succeeds") === true, "requested favorite state is persisted");
  const favorites = await success(buyer.client.from("favorites").select("user_id,listing_id").eq("listing_id", listing.id), "buyer can refresh own favorite");
  check(favorites.length === 1, "duplicate favorite requests produce one row");
  await invisible(seller.client.from("favorites").select("user_id,listing_id").eq("user_id", buyer.id), "seller cannot read buyer favorites");
  await denied(seller.client.from("favorites").insert({ user_id: buyer.id, listing_id: moderatedListing.id }), "favorite insert cannot forge recipient ownership");

  const conversationId = await success(buyer.client.rpc("start_listing_conversation", { p_listing_id: listing.id }), "buyer creates seller conversation");
  check(await success(buyer.client.rpc("start_listing_conversation", { p_listing_id: listing.id }), "conversation creation retry succeeds") === conversationId, "duplicate conversation is reused");
  const messageId = await success(buyer.client.rpc("send_conversation_message", { p_conversation_id: conversationId, p_body: "Hi, is this QA calculator still available?" }), "buyer sends actual message");
  await success(seller.client.rpc("send_conversation_message", { p_conversation_id: conversationId, p_body: "Yes, it is available." }), "seller replies using own identity");
  const sellerMessages = await success(seller.client.from("messages").select("id,sender_id,body").eq("conversation_id", conversationId), "seller reads participant messages");
  check(sellerMessages.length === 2 && sellerMessages.some((row) => row.id === messageId && row.sender_id === buyer.id), "message sender identity is derived by database");
  const unrelatedConversation = await success(competitor.client.rpc("start_listing_conversation", { p_listing_id: moderatedListing.id }), "unrelated student creates separate private conversation");
  await success(competitor.client.rpc("send_conversation_message", { p_conversation_id: unrelatedConversation, p_body: "Private unrelated conversation QA fixture." }), "unrelated private message exists");
  await invisible(buyer.client.from("conversations").select("id").eq("id", unrelatedConversation), "buyer cannot read unrelated conversation");
  await invisible(buyer.client.from("messages").select("id,body").eq("conversation_id", unrelatedConversation), "buyer cannot read unrelated private messages");
  await denied(buyer.client.rpc("send_conversation_message", { p_conversation_id: unrelatedConversation, p_body: "Unauthorized message" }), "buyer cannot send into unrelated conversation");
  await denied(buyer.client.from("messages").insert({ conversation_id: conversationId, sender_id: seller.id, body: "Spoofed seller message" }), "direct message insert cannot spoof sender");
  await success(seller.client.rpc("mark_conversation_read", { p_conversation_id: conversationId }), "participant can mark incoming messages read");

  await denied(seller.client.rpc("request_reservation", { p_listing_id: listing.id }), "seller cannot reserve own listing");
  const firstReservation = await success(buyer.client.rpc("request_reservation", { p_listing_id: listing.id, p_message: "Please reserve this QA calculator." }), "buyer requests reservation");
  await denied(buyer.client.rpc("request_reservation", { p_listing_id: listing.id }), "duplicate active reservation is rejected", ["23505"]);
  const competingReservation = await success(competitor.client.rpc("request_reservation", { p_listing_id: listing.id, p_message: "Competing QA buyer request." }), "second buyer can request before acceptance");
  await denied(buyer.client.rpc("accept_reservation", { p_reservation_id: firstReservation }), "buyer cannot accept their own seller-side request");
  // Actual simultaneous HTTP requests (not a sequential SQL approximation).
  const decisions = await Promise.all([seller.client.rpc("accept_reservation", { p_reservation_id: firstReservation }), seller.client.rpc("accept_reservation", { p_reservation_id: competingReservation })]);
  check(decisions.filter(isSuccessfulApiResult).length === 1, "concurrent seller acceptance has exactly one winner");
  check(decisions.filter((result) => result.error).every((result) => isExpectedDataDenial(result, ["P0002", "PT409", "40001", "23505"])), "concurrent acceptance loser fails for a committed state conflict, not transport or configuration");
  const raced = await success(admin.from("reservations").select("id,status,buyer_id").eq("listing_id", listing.id), "inspect concurrent committed reservations");
  check(raced.filter((row) => row.status === "accepted").length === 1 && raced.filter((row) => row.status === "rejected").length === 1, "one accepted reservation and one rejected competitor persist atomically");
  check((await success(admin.from("listings").select("status").eq("id", listing.id).single(), "inspect reserved listing after race")).status === "reserved", "race winner atomically reserves listing");
  const winning = raced.find((row) => row.status === "accepted");
  const winningBuyer = winning.buyer_id === buyer.id ? buyer : competitor;
  await success(winningBuyer.client.rpc("cancel_reservation", { p_reservation_id: winning.id }), "accepted buyer can cancel their reservation");
  check((await success(admin.from("listings").select("status").eq("id", listing.id).single(), "inspect reopened listing")).status === "available", "cancellation reopens listing atomically");
  const reservationId = await success(buyer.client.rpc("request_reservation", { p_listing_id: listing.id, p_message: "Final QA buyer-to-seller workflow reservation." }), "buyer may request again after cancellation");
  await success(seller.client.rpc("accept_reservation", { p_reservation_id: reservationId }), "seller accepts final buyer request");
  const unrelatedReservation = await success(seller.client.rpc("request_reservation", { p_listing_id: unrelatedListing.id }), "unrelated seller/competitor reservation fixture exists");
  await success(competitor.client.rpc("accept_reservation", { p_reservation_id: unrelatedReservation }), "unrelated reservation accepted by its seller");
  await invisible(buyer.client.from("reservations").select("id,message").eq("id", unrelatedReservation), "unrelated reservation private details are hidden");
  await denied(buyer.client.rpc("cancel_reservation", { p_reservation_id: unrelatedReservation }), "buyer cannot cancel unrelated reservation");
  const meetupArgs = { p_reservation_id: reservationId, p_location_name: "UC Main Campus Lobby", p_location_details: "Near the security desk", p_scheduled_at: new Date(Date.now() + 86400000).toISOString(), p_notes: "QA private meetup notes." };
  const meetupId = await success(buyer.client.rpc("upsert_meetup", meetupArgs), "buyer schedules meetup on accepted reservation");
  const otherMeetupId = await success(competitor.client.rpc("upsert_meetup", { ...meetupArgs, p_reservation_id: unrelatedReservation }), "unrelated participants have their own meetup");
  await invisible(buyer.client.from("meetups").select("id,location_name,notes").eq("id", otherMeetupId), "unrelated meetup location and notes remain private");
  await denied(buyer.client.rpc("upsert_meetup", { ...meetupArgs, p_reservation_id: unrelatedReservation }), "unrelated meetup cannot be modified");
  const sellerMeetup = await success(seller.client.from("meetups").select("id,status,notes,updated_at").eq("id", meetupId).single(), "seller sees participant meetup details");
  check(sellerMeetup.status === "scheduled" && sellerMeetup.notes === meetupArgs.p_notes, "meetup is persisted for both participants");
  await denied(seller.client.rpc("upsert_meetup", { ...meetupArgs, p_expected_updated_at: "2000-01-01T00:00:00Z" }), "stale meetup version cannot overwrite a newer schedule", ["PT409"]);
  await denied(buyer.client.rpc("complete_sale", { p_reservation_id: reservationId }), "buyer cannot complete seller-side sale");

  // Suspension is checked through the existing authenticated session. There is
  // no token refresh between admin moderation and the direct denied requests.
  await success(moderator.rpc("admin_moderate_user", { p_user_id: buyer.id, p_account_status: "suspended", p_reason: "QA immediate restriction coverage without session refresh." }), "admin suspends buyer using authorized RPC");
  for (const [name, args] of [["set_listing_favorite", { p_listing_id: moderatedListing.id, p_should_favorite: true }], ["send_conversation_message", { p_conversation_id: conversationId, p_body: "Suspended send must fail." }], ["request_reservation", { p_listing_id: moderatedListing.id }], ["upsert_meetup", { ...meetupArgs, p_expected_updated_at: sellerMeetup.updated_at }], ["complete_sale", { p_reservation_id: reservationId }], ["admin_moderate_user", { p_user_id: seller.id, p_account_status: "suspended", p_reason: "Unauthorized moderation must be rejected." }]]) await denied(buyer.client.rpc(name, args), "suspended session cannot perform marketplace or admin RPC");
  await invisible(buyer.client.from("listings").select("id").eq("id", moderatedListing.id), "suspended account cannot directly browse another marketplace listing");
  await storageDenied(buyer.client.storage.from("avatars").upload(`${buyer.id}/${randomUUID()}.png`, image, { contentType: "image/png" }), "suspended account cannot upload avatar");
  const restrictedNotifications = await success(buyer.client.from("notifications").select("id,type").eq("user_id", buyer.id).eq("type", "account_suspended"), "suspended buyer retains own account notices");
  check(restrictedNotifications.length > 0, "suspension creates recipient-private notice");
  await success(buyer.client.rpc("mark_notification_read", { p_notification_id: restrictedNotifications[0].id }), "suspended buyer may acknowledge own notification");
  await success(moderator.rpc("admin_moderate_user", { p_user_id: buyer.id, p_account_status: "active", p_reason: "QA restore buyer after suspension restriction checks." }), "admin reactivates buyer using authorized RPC");

  // Initial suspended/pending/rejected fixtures cannot bypass RLS through the
  // Data API even though their own account pages remain available.
  for (const restricted of [suspended, pending, rejected]) {
    await denied(restricted.client.rpc("start_listing_conversation", { p_listing_id: listing.id }), "restricted account cannot open marketplace conversation");
    await denied(restricted.client.rpc("request_reservation", { p_listing_id: moderatedListing.id }), "restricted account cannot reserve marketplace item");
    await denied(restricted.client.rpc("set_listing_favorite", { p_listing_id: moderatedListing.id, p_should_favorite: true }), "restricted account cannot add marketplace favorite");
    await denied(restricted.client.from("listings").insert({ id: randomUUID(), seller_id: restricted.id, category_id: categoryId, title: `QA ${runId} prohibited listing`, description: "Unverified or suspended listing must not be inserted.", price: 1, condition: "good", submission_token: randomUUID() }), "restricted account cannot directly create listing");
    await denied(restricted.client.rpc("admin_moderate_user", { p_user_id: seller.id, p_account_status: "suspended", p_reason: "Restricted account admin escalation must fail." }), "restricted account cannot invoke admin moderation");
  }

  await success(seller.client.rpc("complete_sale", { p_reservation_id: reservationId }), "seller completes actual accepted sale");
  const completedListing = await success(admin.from("listings").select("status").eq("id", listing.id).single(), "inspect completed listing state");
  const completedReservation = await success(buyer.client.from("reservations").select("status,completed_at").eq("id", reservationId).single(), "buyer sees completed reservation");
  const completedMeetup = await success(seller.client.from("meetups").select("status,completed_at").eq("id", meetupId).single(), "seller sees completed meetup");
  check(completedListing.status === "sold" && completedReservation.status === "completed" && completedMeetup.status === "completed" && Boolean(completedReservation.completed_at) && Boolean(completedMeetup.completed_at), "sale completion atomically persists sold/completed/completed states");
  await denied(buyer.client.rpc("request_reservation", { p_listing_id: listing.id }), "sold item cannot accept new reservation");
  const retainedMessages = await success(buyer.client.from("messages").select("id").eq("conversation_id", conversationId), "completed-sale participant keeps conversation history");
  check(retainedMessages.length === 2, "sale does not delete private messages");
  const completedFavorites = await success(buyer.client.from("favorites").select("listing_id").eq("listing_id", listing.id), "completed favorite remains recipient-private");
  check(completedFavorites.length === 1, "sold favorite remains persisted for history");

  const notificationRows = await success(buyer.client.from("notifications").select("id,type,message").eq("user_id", buyer.id), "buyer reads own event notifications");
  check(notificationRows.some((row) => row.type === "sale_completed"), "sale completion notification delivered");
  check(notificationRows.every((row) => !row.message.includes("QA private meetup notes") && !row.message.includes("Hi, is this QA calculator")), "notifications do not duplicate private message/meetup content");
  await invisible(seller.client.from("notifications").select("id,message").eq("user_id", buyer.id), "student cannot read another recipient's notifications");
  const crossRead = await seller.client.rpc("mark_notification_read", { p_notification_id: notificationRows[0].id });
  check(isExpectedDataDenial(crossRead, ["42501"]) || (isSuccessfulApiResult(crossRead) && crossRead.data === false), "student cannot mark another recipient's notice read", crossRead);
  await denied(buyer.client.from("notifications").insert({ user_id: seller.id, type: "message", title: "Forged", message: "Forged", event_key: randomUUID() }), "student cannot forge notifications");

  const listingReportId = await success(buyer.client.rpc("report_listing", { p_listing_id: moderatedListing.id, p_reason: "misleading", p_details: "QA listing reporting test with sufficient detail." }), "buyer reports listing privately");
  const studentReportId = await success(buyer.client.rpc("report_student", { p_subject_id: seller.id, p_reason: "harassment", p_details: "QA student reporting test with sufficient detail." }), "buyer reports student privately");
  check(await success(buyer.client.rpc("report_listing", { p_listing_id: moderatedListing.id, p_reason: "misleading", p_details: "Retried QA listing report." }), "listing report retry succeeds") === listingReportId, "duplicate active listing report is reused");
  check(await success(buyer.client.rpc("report_student", { p_subject_id: seller.id, p_reason: "harassment", p_details: "Retried QA student report." }), "student report retry succeeds") === studentReportId, "duplicate active student report is reused");
  await invisible(competitor.client.from("listing_reports").select("id,details").eq("id", listingReportId), "unrelated student cannot read listing report");
  await invisible(seller.client.from("student_reports").select("id,details").eq("id", studentReportId), "reported student cannot read reporter's private student report");
  for (const [kind, reportId] of [["listing", listingReportId], ["student", studentReportId]]) await denied(buyer.client.rpc("admin_review_report", { p_kind: kind, p_report_id: reportId, p_decision: "resolved", p_admin_note: "Unauthorized report decision must fail." }), "student cannot resolve or dismiss report");
  await denied(buyer.client.rpc("admin_moderate_listing", { p_listing_id: moderatedListing.id, p_reason: "Unauthorized removal must be rejected." }), "student cannot invoke admin listing removal");
  await invisible(buyer.client.schema("private").from("moderation_actions").select("id"), "private moderation action logs are not Data API accessible", ["42501", "PGRST106"]);
  await success(moderator.rpc("admin_review_report", { p_kind: "listing", p_report_id: listingReportId, p_decision: "resolved", p_admin_note: "QA private administrator listing review note." }), "admin resolves listing report");
  await success(moderator.rpc("admin_review_report", { p_kind: "student", p_report_id: studentReportId, p_decision: "dismissed", p_admin_note: "QA private administrator student review note." }), "admin dismisses student report");
  check(await success(moderator.rpc("get_admin_report_note", { p_kind: "listing", p_report_id: listingReportId }), "admin can read protected report decision note") === "QA private administrator listing review note.", "private admin note is persisted");
  await denied(buyer.client.rpc("get_admin_report_note", { p_kind: "listing", p_report_id: listingReportId }), "reporter cannot read private admin note");
  await success(moderator.rpc("admin_moderate_listing", { p_listing_id: moderatedListing.id, p_reason: "QA inappropriate listing removal acceptance test." }), "admin removes inappropriate listing");
  check((await success(admin.from("listings").select("status").eq("id", moderatedListing.id).single(), "inspect moderated listing")).status === "removed", "moderated listing has persisted removed status");
  await invisible(buyer.client.from("listings").select("id").eq("id", moderatedListing.id), "removed listing disappears from buyer browsing");
  await denied(buyer.client.rpc("request_reservation", { p_listing_id: moderatedListing.id }), "removed listing cannot receive reservations");

  await success(buyer.client.auth.signOut({ scope: "local" }), "buyer logout revokes current session");
  await invisible(buyer.client.from("reservations").select("id").eq("id", reservationId), "logged-out buyer cannot read private reservation");
  const login = await buyer.client.auth.signInWithPassword({ email: buyer.email, password: buyer.password });
  check(!login.error && login.data.user?.id === buyer.id, "buyer can sign back in with retained QA credentials", login);
  const persisted = await success(buyer.client.from("reservations").select("status").eq("id", reservationId).single(), "private completed reservation reloads after logout/login");
  check(persisted.status === "completed", "completed state survives a fresh Auth session");
  check((await profileState(buyer)).account_status === "active" && (await profileState(competitor)).verification_status === "verified", "API suite restores buyer/competitor states for browser tests");
  return count;
}
