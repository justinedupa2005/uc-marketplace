import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const QA_ROLES = ["admin", "seller", "buyer", "suspended", "pending", "rejected", "competitor"];
export const QA_IMAGE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgsFjxHwAC/AHgoLvpmAAAAABJRU5ErkJggg==", "base64");
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export function requireResult(result, label) {
  if (result.error) {
    const code = result.error.code;
    const safeCode = typeof code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3}|[a-z_]{1,40})$/.test(code) ? code : "service_error";
    throw new Error(`${label} failed (${safeCode}).`);
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

export async function assertDatabaseRunOwnership(connection, ids, runId) {
  assert.equal(new Set(ids).size, ids.length, "QA account identities must be distinct.");
  const records = await connection.query(
    "select account.id, account.raw_app_meta_data->>'qa_run_id' as qa_run_id, profile.id as profile_id from auth.users account left join public.profiles profile on profile.id=account.id where account.id=any($1::uuid[]) for update of account",
    [ids],
  );
  assert.equal(records.rowCount, ids.length, "QA API and database must identify the same run-owned accounts.");
  for (const record of records.rows) {
    assert.ok(ids.includes(record.id) && record.profile_id === record.id, "QA database identity must have its own profile.");
    assert.equal(record.qa_run_id, runId, "QA database refuses accounts from another run.");
  }
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
      requireResult(await admin.from("profiles").update({
        role: role === "admin" ? "admin" : "student",
        verification_status: "verified",
        account_status: role === "suspended" ? "suspended" : "active",
      }).eq("id", id).select("id").single(), `Set fixture state ${role}`);
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
