import assert from "node:assert/strict";

/** Match Auth/API fixtures to this SQL target before trusted inspection/write. */
export async function assertDatabaseRunOwnership(connection, ids, runId) {
  assert.ok(new Set(ids).size === ids.length, "QA account identities must be distinct.");
  const records = await connection.query(
    "select account.id, account.raw_app_meta_data->>'qa_run_id' as qa_run_id, profile.id as profile_id from auth.users account left join public.profiles profile on profile.id=account.id where account.id=any($1::uuid[]) for update of account",
    [ids],
  );
  assert.ok(records?.rowCount === ids.length && Array.isArray(records.rows) && records.rows.length === ids.length
    && new Set(records.rows.map((record) => record?.id)).size === ids.length
    && records.rows.every((record) => ids.includes(record?.id)),
  "QA API and database must identify the same run-owned accounts.");
  for (const record of records.rows) {
    assert.ok(ids.includes(record.id) && record.profile_id === record.id, "QA database identity must have its own profile.");
    assert.ok(record.qa_run_id === runId, "QA database refuses accounts from another run.");
  }
}
