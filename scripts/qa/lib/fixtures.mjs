import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertDatabaseRunOwnership } from "./fixture-ownership.mjs";
import { setFixtureProfileState } from "./fixture-state.mjs";

export { assertDatabaseRunOwnership } from "./fixture-ownership.mjs";

export const QA_ROLES = ["admin", "seller", "buyer", "suspended", "pending", "rejected", "competitor"];
export const QA_IMAGE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgsFjxHwAC/AHgoLvpmAAAAABJRU5ErkJggg==", "base64");
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

// Auth codes come from the installed SDK; Storage codes are documented at
// https://supabase.com/docs/guides/storage/debugging/error-codes. Unknown service
// strings are not safe diagnostics, even if they resemble short identifiers.
const knownServiceCodes = new Set(`
  unexpected_failure validation_failed bad_json email_exists phone_exists bad_jwt not_admin no_authorization
  user_not_found session_not_found session_expired refresh_token_not_found refresh_token_already_used
  flow_state_not_found flow_state_expired signup_disabled user_banned provider_email_needs_verification invite_not_found
  bad_oauth_state bad_oauth_callback oauth_provider_not_supported unexpected_audience single_identity_not_deletable
  email_conflict_identity_not_deletable identity_already_exists email_provider_disabled phone_provider_disabled
  too_many_enrolled_mfa_factors mfa_factor_name_conflict mfa_factor_not_found mfa_ip_address_mismatch
  mfa_challenge_expired mfa_verification_failed mfa_verification_rejected insufficient_aal captcha_failed
  saml_provider_disabled manual_linking_disabled sms_send_failed email_not_confirmed phone_not_confirmed reauth_nonce_missing
  saml_relay_state_not_found saml_relay_state_expired saml_idp_not_found saml_assertion_no_user_id saml_assertion_no_email
  user_already_exists sso_provider_not_found saml_metadata_fetch_failed saml_idp_already_exists sso_domain_already_exists
  saml_entity_id_mismatch conflict provider_disabled user_sso_managed reauthentication_needed same_password
  reauthentication_not_valid otp_expired otp_disabled identity_not_found weak_password over_request_rate_limit
  over_email_send_rate_limit over_sms_send_rate_limit bad_code_verifier anonymous_provider_disabled hook_timeout
  hook_timeout_after_retry hook_payload_over_size_limit hook_payload_invalid_content_type request_timeout
  mfa_phone_enroll_not_enabled mfa_phone_verify_not_enabled mfa_totp_enroll_not_enabled mfa_totp_verify_not_enabled
  mfa_webauthn_enroll_not_enabled mfa_webauthn_verify_not_enabled mfa_verified_factor_exists invalid_credentials
  email_address_not_authorized email_address_invalid
  NoSuchBucket NoSuchKey NoSuchUpload InvalidJWT InvalidRequest TenantNotFound EntityTooLarge InternalError
  ResourceAlreadyExists InvalidBucketName InvalidKey InvalidRange InvalidMimeType InvalidUploadId KeyAlreadyExists
  BucketAlreadyExists DatabaseTimeout InvalidSignature SignatureDoesNotMatch AccessDenied ResourceLocked DatabaseError
  MissingContentLength MissingParameter InvalidUploadSignature LockTimeout S3Error S3InvalidAccessKeyId
  S3MaximumCredentialsLimit InvalidChecksum MissingPart SlowDown not_found already_exists unauthorized database_timeout
  internal_server_error
`.trim().split(/\s+/));
const sqlstateClasses = new Set("00 01 02 03 08 09 0A 0B 0F 0L 0P 0Z 20 21 22 23 24 25 26 27 28 2B 2D 2F 34 38 39 3B 3D 3F 40 42 44 53 54 55 57 58 72 F0 HV P0 XX".split(" "));

/** Primitive allowlist only: never retain SDK errors, responses, rows or causes. */
export function qaFailureMetadata(result) {
  const codes = [result?.error?.code, result?.error?.statusCode];
  const qaErrorCode = codes.find((code) => typeof code === "string" && (
    knownServiceCodes.has(code) || /^PGRST\d{3}$/.test(code)
    || (/^[0-9A-Z]{5}$/.test(code) && sqlstateClasses.has(code.slice(0, 2)))
  )) ?? "service_error";
  let qaHttpStatus = null;
  for (const value of [result?.status, result?.error?.status, result?.error?.statusCode]) {
    const status = typeof value === "number" ? value
      : typeof value === "string" && /^[1-5]\d{2}$/.test(value) ? Number(value) : null;
    if (Number.isInteger(status) && status >= 100 && status <= 599) { qaHttpStatus = status; break; }
  }
  return { qaErrorCode, qaHttpStatus };
}

export function requireResult(result, label) {
  if (result.error) {
    const metadata = qaFailureMetadata(result);
    throw Object.assign(new Error(`${label} failed (${metadata.qaErrorCode}).`), metadata);
  }
  return result.data;
}

export function createFixtureContext(config, pool) {
  return {
    config, pool,
    runId: randomUUID(),
    admin: createClient(config.supabaseUrl, config.serviceRoleKey, clientOptions),
    accounts: {},
  };
}

export async function provisionAccounts(context) {
  const { config, admin, accounts, runId, pool } = context;
  // Fail before provisioning if the disposable schema is not fully migrated.
  const tables = ["profiles", "meetups", "notifications", "student_reports"];
  for (const table of tables) requireResult(await admin.from(table).select("id").limit(0), `QA schema preflight ${table}`);
  for (const [index, role] of QA_ROLES.entries()) {
    const email = `qa-${runId}-${role}@example.test`;
    const password = `Qa!${randomBytes(24).toString("base64url")}9Zz`;
    const created = requireResult(await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { qa_run_id: runId },
      user_metadata: {
        full_name: `QA ${role} ${runId.slice(0, 8)}`, student_id_number: `QA-${randomUUID()}`,
        course: "BSIT", year_level: 3,
        // Malicious signup metadata must not control database permissions.
        role: "admin", verification_status: "verified", account_status: "active",
      },
    }), `Provision ${role}`);
    assert.ok(created.user?.id, "Auth provisioning must return an account ID.");
    const id = created.user.id;
    accounts[role] = { id, email, password, client: createClient(config.supabaseUrl, config.publishableKey, clientOptions) };
    const profile = requireResult(await admin.from("profiles").select("id,role,verification_status,account_status,course,year_level").eq("id", id).single(), `Profile trigger ${role}`);
    assert.equal(profile.role, "student", "Signup metadata must not grant admin.");
    assert.equal(profile.verification_status, "unverified", "Verification begins only after evidence submission.");
    assert.equal(profile.account_status, "active");
    assert.equal(profile.course, "BSIT");
    assert.equal(profile.year_level, 3);
    // Confirm the SQL connection points to the very same Auth/API project.
    await assertDatabaseRunOwnership(pool, [id], runId);
    if (["admin", "seller", "buyer", "competitor", "suspended"].includes(role)) {
      await setFixtureProfileState(context, id, {
        role: role === "admin" ? "admin" : "student",
        verification_status: "verified",
        account_status: role === "suspended" ? "suspended" : "active",
      });
    }
    requireResult(await accounts[role].client.auth.signInWithPassword({ email, password }), `Sign in ${role}`);
    if (role === "pending" || role === "rejected") {
      const verificationId = randomUUID();
      const documentPath = `${id}/${verificationId}/student-id.png`;
      requireResult(await accounts[role].client.storage.from("student-verifications").upload(documentPath, QA_IMAGE, { contentType: "image/png", upsert: false }), `Private evidence ${role}`);
      requireResult(await accounts[role].client.rpc("submit_verification", { p_verification_id: verificationId, p_document_path: documentPath }), `Verification submission ${role}`);
      Object.assign(accounts[role], { verificationId, documentPath });
      if (role === "rejected") requireResult(await accounts.admin.client.rpc("review_verification", {
        p_verification_id: verificationId, p_decision: "rejected", p_rejection_reason: "QA evidence needs a clearer separate image.",
      }), "QA rejection review");
    }
    console.log(`Provisioned QA ${role} (${index + 1}/${QA_ROLES.length}); credentials remain in process memory.`);
  }
  return accounts;
}

/** Real unconfirmed signup; admin tags ownership but never confirms this email. */
export async function createSignupFixture(context, { confirmationMode = "code" } = {}) {
  const { config, accounts, admin, runId, pool } = context;
  assert.equal(config.local, true, "SMTP signup fixtures require an isolated local QA project.");
  assert.ok(["code", "link"].includes(confirmationMode) && !accounts.emailSignup, "Create only one explicitly configured signup fixture per run.");
  const email = `qa-${runId}-email-signup@example.test`;
  const password = `Qa!${randomBytes(24).toString("base64url")}9Zz`;
  const nonce = randomUUID();
  const client = createClient(config.supabaseUrl, config.publishableKey, clientOptions);
  const signupData = requireResult(await client.auth.signUp({
    email, password,
    options: {
      emailRedirectTo: `${config.appBaseUrl}/auth/confirm`,
      data: { full_name: `QA email signup ${runId.slice(0, 8)}`, student_id_number: `QA-${randomUUID()}`, course: "BSIT", year_level: 3,
        qa_signup_nonce: nonce, role: "admin", verification_status: "verified", account_status: "active" },
    },
  }), "Normal SMTP signup");
  assert.ok(signupData?.user?.id, "Real signup must return a fixture account ID.");
  const account = { id: signupData.user.id, email, password, client };
  // Retain the exact returned ID even if tagging fails. Cleanup then fails
  // closed on its missing trusted run marker, enabling scoped manual salvage.
  accounts.emailSignup = account;
  assert.ok(!signupData.session && !signupData.user.email_confirmed_at, "Real signup must wait for SMTP confirmation.");
  const actual = requireResult(await admin.auth.admin.getUserById(account.id), "SMTP signup identity inspection").user;
  assert.equal(actual.id, account.id);
  assert.equal(actual.email, email);
  assert.equal(actual.user_metadata.qa_signup_nonce, nonce, "Signup must identify the newly created disposable fixture, not an obfuscated duplicate.");
  assert.ok(!actual.email_confirmed_at && !actual.app_metadata.qa_run_id, "SMTP fixture must be new and still unconfirmed.");
  requireResult(await admin.auth.admin.updateUserById(account.id, { app_metadata: { ...actual.app_metadata, qa_run_id: runId } }), "SMTP fixture ownership tag");
  await assertDatabaseRunOwnership(pool, [account.id], runId);
  const profile = requireResult(await admin.from("profiles").select("id,role,verification_status,account_status").eq("id", account.id).single(), "SMTP signup profile trigger");
  assert.equal(profile.role, "student");
  assert.equal(profile.verification_status, "unverified");
  assert.equal(profile.account_status, "active");
  return { account, signupData };
}

export function accountEnvironment(accounts) {
  return Object.fromEntries(Object.entries(accounts).flatMap(([role, account]) => [
    [`QA_${role.toUpperCase()}_ID`, account.id],
    [`QA_${role.toUpperCase()}_EMAIL`, account.email],
    [`QA_${role.toUpperCase()}_PASSWORD`, account.password],
  ]));
}

/** Delete only resources owned by accounts this invocation created. */
export async function cleanupFixtures(context) {
  const { admin, accounts, runId, pool } = context;
  const ids = Object.values(accounts).map((account) => account.id);
  if (!ids.length) return;
  for (const id of ids) {
    const record = requireResult(await admin.auth.admin.getUserById(id), "Cleanup identity check");
    assert.equal(record.user.app_metadata.qa_run_id, runId, "Cleanup refuses accounts from another run.");
  }
  let objects;
  const transaction = await pool.connect();
  try {
    await transaction.query("begin");
    // Re-check the SQL identity and server-owned run marker under a lock before
    // any cleanup mutation. A mismatched API/database target fails closed.
    await assertDatabaseRunOwnership(transaction, ids, runId);
    // Storage bytes are removed through Storage, not by deleting its catalog.
    objects = (await transaction.query("select bucket_id,name,owner_id from storage.objects where owner_id=any($1::text[])", [ids])).rows;
    for (const object of objects) {
      assert.ok(["avatars", "listing-images", "student-verifications"].includes(object.bucket_id)
        && ids.includes(object.owner_id) && object.name.startsWith(`${object.owner_id}/`), "Cleanup refuses non-owned Storage paths or unrecognized buckets.");
    }
    await transaction.query("delete from private.moderation_actions where actor_id=any($1::uuid[]) and (target_user_id=any($1::uuid[]) or listing_id in (select id from public.listings where seller_id=any($1::uuid[])))", [ids]);
    await transaction.query("delete from public.listing_reports where reporter_id=any($1::uuid[]) or listing_id in (select id from public.listings where seller_id=any($1::uuid[]))", [ids]);
    await transaction.query("delete from public.student_reports where reporter_id=any($1::uuid[]) or subject_id=any($1::uuid[])", [ids]);
    await transaction.query("delete from public.verifications where user_id=any($1::uuid[])", [ids]);
    await transaction.query("update public.profiles set avatar_path=null where id=any($1::uuid[])", [ids]);
    await transaction.query("delete from public.listings where seller_id=any($1::uuid[])", [ids]);
    await transaction.query("commit");
  } catch (error) {
    await transaction.query("rollback");
    throw error;
  } finally { transaction.release(); }
  for (const bucket of ["avatars", "listing-images", "student-verifications"]) {
    const names = objects.filter((object) => object.bucket_id === bucket).map((object) => {
      return object.name;
    });
    for (let index = 0; index < names.length; index += 100) requireResult(await admin.storage.from(bucket).remove(names.slice(index, index + 100)), "QA Storage cleanup");
  }
  for (const account of Object.values(accounts)) {
    await account.client.auth.signOut({ scope: "local" });
    requireResult(await admin.auth.admin.deleteUser(account.id), "QA account cleanup");
  }
  console.log(`Removed ${ids.length} run-owned QA accounts and their temporary records/files. No existing accounts were targeted.`);
}
