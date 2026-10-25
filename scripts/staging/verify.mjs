import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createManagementApi, staging, validateFixtureCredentials, verifyStagingProject } from "./lib.mjs";

try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 5000) throw new Error();
  }
  const credentials = validateFixtureCredentials(JSON.parse(input));
  const api = createManagementApi(process.env);
  await verifyStagingProject(api);
  const read = (query) => api("/database/query/read-only", { method: "POST", body: { query } });
  const sql = await read(`select
    (select count(*)::int from auth.users where raw_app_meta_data->>'staging_fixture'='uc-marketplace-staging-v1') as accounts,
    (select count(*)::int from public.listings) as listings,
    (select count(*)::int from public.conversations) as conversations,
    (select count(*)::int from public.messages) as messages,
    (select count(*)::int from public.favorites) as favorites,
    (select count(*)::int from public.reservations) as reservations,
    (select count(*)::int from public.meetups) as meetups,
    (select count(*)::int from public.verifications) as verifications,
    (select count(*)::int from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) as public_tables_without_rls`);
  assert.equal(sql[0].accounts, 5);
  for (const field of ["listings", "conversations", "messages", "favorites", "reservations", "meetups", "verifications"]) assert.ok(sql[0][field] > 0);
  assert.equal(sql[0].public_tables_without_rls, 0);
  const buckets = await read("select id,public from storage.buckets where id in ('avatars','listing-images','student-verifications')");
  assert.equal(buckets.length, 3);
  assert.equal(buckets.find((bucket) => bucket.id === "student-verifications").public, false);
  assert.equal(buckets.find((bucket) => bucket.id === "listing-images").public, false);
  const url = `https://${staging.supabaseProjectRef}.supabase.co`;
  const keys = await api("/api-keys");
  assert.ok(keys.some((key) => key.api_key === process.env.STAGING_PUBLISHABLE_KEY && (key.name === "anon" || key.type === "publishable")));
  const clients = {};
  for (const credential of credentials) {
    const client = createClient(url, process.env.STAGING_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) }) },
    });
    const auth = await client.auth.signInWithPassword({ email: credential.email, password: credential.password });
    assert.ok(!auth.error && auth.data.user?.id);
    const profile = await client.from("profiles").select("role,verification_status,account_status").eq("id", auth.data.user.id).single();
    assert.ok(!profile.error);
    assert.equal(profile.data.role, credential.role === "admin" ? "admin" : "student");
    if (credential.role === "suspended") assert.equal(profile.data.account_status, "suspended");
    if (credential.role === "pending") assert.equal(profile.data.verification_status, "pending");
    const listings = await client.from("listings").select("id");
    assert.ok(!listings.error);
    if (["pending", "suspended"].includes(credential.role)) assert.equal(listings.data.length, 0);
    if (["seller", "buyer"].includes(credential.role)) assert.ok(listings.data.length >= 2);
    clients[credential.role] = client;
  }
  const pendingDocument = await clients.pending.from("verifications").select("document_path").eq("status", "pending").single();
  assert.ok(!pendingDocument.error && pendingDocument.data?.document_path);
  const allowed = await clients.admin.storage.from("student-verifications").download(pendingDocument.data.document_path);
  assert.ok(!allowed.error && allowed.data.size > 0);
  const denied = await clients.buyer.storage.from("student-verifications").download(pendingDocument.data.document_path);
  assert.ok(denied.error && [400, 401, 403, 404].includes(Number(denied.error.status ?? denied.error.statusCode)));
  const hidden = await clients.buyer.from("verifications").select("id");
  // A buyer sees its own approved submission, never the pending student's file.
  assert.ok(!hidden.error && hidden.data.length === 1);
  for (const client of Object.values(clients)) await client.auth.signOut({ scope: "local" });
  console.log(`Staging live smoke passed: ${JSON.stringify(sql[0])}. Auth identities, restricted-user RLS and private verification Storage verified; no fixture data changed.`);
} catch {
  console.error("Staging live smoke failed; private credentials, rows and service diagnostics withheld.");
  process.exitCode = 1;
}
