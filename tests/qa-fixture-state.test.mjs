import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import test from "node:test";
import { setFixtureProfileState } from "../scripts/qa/lib/fixture-state.mjs";
import { assertDatabaseRunOwnership } from "../scripts/qa/lib/fixture-ownership.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";

function fixture({ rows = [{ id, profile_id: id, qa_run_id: runId }], ownershipResult = null, updateRows = [{ id }], updateError = null, rollbackError = null, releaseError = null } = {}) {
  const calls = [];
  const connection = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.startsWith("select account.id")) return ownershipResult ?? { rows, rowCount: rows.length };
      if (sql.startsWith("update public.profiles")) {
        if (updateError) throw updateError;
        return { rows: updateRows, rowCount: updateRows.length };
      }
      if (sql === "rollback" && rollbackError) throw rollbackError;
      return { rows: [], rowCount: 0 };
    },
    release(destroy) { calls.push({ release: true, destroy }); if (releaseError) throw releaseError; },
  };
  const context = { runId, accounts: { admin: { id } }, pool: {
    async connect() { calls.push({ connect: true }); return connection; },
    async query() { throw new Error("must use the acquired transaction connection"); },
  } };
  return { context, calls };
}

test("fixture state validates recorded identities and exact enum fields before connecting", async () => {
  const badStates = [null, [], {}, { role: "owner" }, { verification_status: "approved" }, { account_status: "banned" },
    { role: null }, { role: "admin", email: "private@example.test" }, { role: "admin' ; grant all --" }, { course: "BSIT" }, { toString: "private-value" }];
  for (const state of badStates) {
    const { context, calls } = fixture();
    await assert.rejects(setFixtureProfileState(context, id, state), /QA fixture state/);
    assert.deepEqual(calls, []);
  }
  for (const accountId of [otherId, "not-a-uuid", null]) {
    const { context, calls } = fixture();
    await assert.rejects(setFixtureProfileState(context, accountId, { role: "admin" }), /QA fixture state/);
    assert.deepEqual(calls, []);
  }
});

test("fixture state locks the run-owned Auth identity on the same transaction before a parameterized update", async () => {
  const { context, calls } = fixture();
  assert.equal(await setFixtureProfileState(context, id, { role: "admin", verification_status: "verified", account_status: "active" }), id);
  assert.equal(calls[0].connect, true);
  assert.equal(calls[1].sql, "begin");
  assert.match(calls[2].sql, /for update of account$/);
  assert.deepEqual(calls[2].parameters, [[id]]);
  assert.match(calls[3].sql, /^update public\.profiles set role=coalesce\(\$2::text,role\), verification_status=coalesce\(\$3::text,verification_status\), account_status=coalesce\(\$4::text,account_status\) where id=\$1::uuid returning id$/);
  assert.deepEqual(calls[3].parameters, [id, "admin", "verified", "active"]);
  assert.equal(calls[4].sql, "commit");
  assert.deepEqual(calls[5], { release: true, destroy: false });
  assert.equal(calls.some((call) => /grant|alter|disable|session_replication_role|(?:^|;)\s*set\s+(?:local\s+)?role\b/i.test(call.sql ?? "")), false);
});

test("fixture state preserves unspecified fields and ignores inherited state properties", async () => {
  const { context, calls } = fixture();
  const state = Object.assign(Object.create({ role: "admin" }), { verification_status: "rejected" });
  await setFixtureProfileState(context, id, state);
  assert.deepEqual(calls.find((call) => call.sql?.startsWith("update public.profiles")).parameters, [id, null, "rejected", null]);
});

test("fixture state blocks another run, missing account/profile, and foreign identity before UPDATE", async () => {
  for (const rows of [[], [{ id, profile_id: id, qa_run_id: "another-run" }], [{ id, profile_id: null, qa_run_id: runId }], [{ id: otherId, profile_id: otherId, qa_run_id: runId }]]) {
    const { context, calls } = fixture({ rows });
    await assert.rejects(setFixtureProfileState(context, id, { role: "admin" }), /same run-owned|another run|own profile/);
    assert.equal(calls.some((call) => call.sql?.startsWith("update")), false);
    assert.ok(calls.some((call) => call.sql === "rollback"));
    assert.equal(calls.at(-1).release, true);
  }
});

test("fixture ownership refuses malformed result rows and duplicate identities even with matching rowCount", async () => {
  for (const ownershipResult of [{ rows: [], rowCount: 1 }, { rows: {}, rowCount: 1 }, { rows: [null], rowCount: 1 }]) {
    const { context, calls } = fixture({ ownershipResult });
    await assert.rejects(setFixtureProfileState(context, id, { role: "admin" }), /same run-owned/);
    assert.equal(calls.some((call) => call.sql?.startsWith("update")), false);
    assert.ok(calls.some((call) => call.sql === "rollback"));
    assert.equal(calls.at(-1).release, true);
  }
  const duplicate = { async query() { return { rowCount: 2, rows: [
    { id, profile_id: id, qa_run_id: runId }, { id, profile_id: id, qa_run_id: runId },
  ] }; } };
  await assert.rejects(assertDatabaseRunOwnership(duplicate, [id, otherId], runId), /same run-owned/);
});

test("fixture state requires exactly one matching returned row and rolls back otherwise", async () => {
  for (const updateRows of [[], [{ id: otherId }], [{ id }, { id: otherId }]]) {
    const { context, calls } = fixture({ updateRows });
    await assert.rejects(setFixtureProfileState(context, id, { role: "student" }), /exactly its run-owned profile/);
    assert.equal(calls.some((call) => call.sql === "commit"), false);
    assert.ok(calls.some((call) => call.sql === "rollback"));
    assert.equal(calls.at(-1).release, true);
  }
});

test("fixture state preserves the original SQL error when rollback/release also fail", async () => {
  const original = Object.assign(new Error("controlled update failure"), { code: "42501" });
  const { context, calls } = fixture({ updateError: original, rollbackError: new Error("rollback failure"), releaseError: new Error("release failure") });
  await assert.rejects(setFixtureProfileState(context, id, { role: "admin" }), (error) => error === original);
  assert.deepEqual(calls.at(-1), { release: true, destroy: true });
  assert.equal(calls.some((call) => call.sql === "commit"), false);
});

test("trusted fixture seeding works with native-style CHECK function ACLs while authenticated grants stay restricted", async () => {
  const database = await PGlite.create();
  try {
    await database.exec(`
      create role service_role nologin bypassrls;
      create role authenticated nologin;
      create schema auth;
      create schema private;
      create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null);
      create function private.is_accepted_course(candidate text) returns boolean language sql immutable as $$ select candidate='BSIT' $$;
      revoke all on function private.is_accepted_course(text) from public;
      grant usage on schema public,private to service_role,authenticated;
      grant execute on function private.is_accepted_course(text) to authenticated;
      create table public.profiles(id uuid primary key references auth.users(id),course text not null check(private.is_accepted_course(course)),
        role text not null default 'student',verification_status text not null default 'unverified',account_status text not null default 'active',year_level integer default 3);
      alter table public.profiles enable row level security;
      grant select,update on public.profiles to service_role;
      grant select,update(year_level) on public.profiles to authenticated;
      create policy own_profile on public.profiles to authenticated using(id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid);
    `);
    await database.query("insert into auth.users values($1,$2::jsonb)", [id, JSON.stringify({ qa_run_id: runId })]);
    await database.query("insert into public.profiles(id,course) values($1,'BSIT')", [id]);
    await database.exec("begin;set local role service_role;");
    assert.equal((await database.query("select id from public.profiles limit 0")).rows.length, 0);
    await assert.rejects(database.query("update public.profiles set role='admin' where id=$1", [id]), (error) => error.code === "42501");
    await database.exec("rollback;reset role;");
    let releases = 0;
    const context = { runId, accounts: { admin: { id } }, pool: { async connect() { return {
      async query(sql, parameters) { const result = await database.query(sql, parameters); return { rows: result.rows, rowCount: result.rows.length }; },
      release() { releases += 1; },
    }; } } };
    assert.equal(await setFixtureProfileState(context, id, { role: "admin", verification_status: "verified" }), id);
    assert.equal(releases, 1);
    assert.deepEqual((await database.query("select role,verification_status from public.profiles where id=$1", [id])).rows[0], { role: "admin", verification_status: "verified" });
    await database.exec("begin;set local role authenticated;");
    await database.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    await assert.rejects(database.query("update public.profiles set role='student' where id=$1", [id]), (error) => error.code === "42501");
    await database.exec("rollback;reset role;");
    assert.equal((await database.query("select has_function_privilege('service_role','private.is_accepted_course(text)','EXECUTE') as allowed")).rows[0].allowed, false);
  } finally { await database.close(); }
});
