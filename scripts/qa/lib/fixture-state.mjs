import assert from "node:assert/strict";
import { assertDatabaseRunOwnership } from "./fixture-ownership.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedState = {
  role: new Set(["admin", "student"]),
  verification_status: new Set(["unverified", "pending", "verified", "rejected"]),
  account_status: new Set(["active", "suspended", "disabled"]),
};

/** QA-only seed: ordinary RLS, constraints, triggers and grants stay intact. */
export async function setFixtureProfileState(context, accountId, state) {
  assert.ok(typeof accountId === "string" && uuid.test(accountId)
    && typeof context?.runId === "string" && uuid.test(context.runId), "QA fixture state requires valid run/account identities.");
  assert.ok(Object.values(context.accounts ?? {}).some((account) => account?.id === accountId), "QA fixture state refuses an unrecorded account.");
  assert.ok(state && typeof state === "object" && !Array.isArray(state), "QA fixture state must be an explicit state object.");
  const entries = Object.entries(state);
  assert.ok(entries.length >= 1 && entries.length <= 3
    && entries.every(([key, value]) => Object.hasOwn(allowedState, key) && allowedState[key].has(value)),
  "QA fixture state accepts only role, verification_status and account_status with static allowed values.");
  const values = new Map(entries);
  const connection = await context.pool.connect();
  let failed = false;
  let rollbackFailed = false;
  try {
    await connection.query("begin");
    await assertDatabaseRunOwnership(connection, [accountId], context.runId);
    const result = await connection.query(
      "update public.profiles set role=coalesce($2::text,role), verification_status=coalesce($3::text,verification_status), account_status=coalesce($4::text,account_status) where id=$1::uuid returning id",
      [accountId, values.get("role") ?? null, values.get("verification_status") ?? null, values.get("account_status") ?? null],
    );
    assert.ok(result.rowCount === 1 && result.rows?.length === 1 && result.rows[0].id === accountId,
      "QA fixture state must update exactly its run-owned profile.");
    await connection.query("commit");
    return accountId;
  } catch (error) {
    failed = true;
    try { await connection.query("rollback"); } catch { rollbackFailed = true; }
    throw error;
  } finally {
    try { connection.release(rollbackFailed); }
    catch (error) { if (!failed) throw error; }
  }
}
