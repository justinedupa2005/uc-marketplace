import assert from "node:assert/strict";
import test from "node:test";
import { StorageApiError } from "@supabase/supabase-js";
import { isExpectedDataDenial, isExpectedStorageDenial, isInvisibleDataResult, isSuccessfulApiResult, isSuccessfulEmptyResult, isUnchangedStorageResult } from "../scripts/qa/lib/api-results.mjs";
import { cleanupFixtures, qaFailureMetadata, requireResult } from "../scripts/qa/lib/fixtures.mjs";
import { runApiChecks } from "../scripts/qa/lib/api.mjs";

const denied = (code, status = 403) => ({ data: null, error: { code }, status });

test("QA service errors expose only bounded standard error codes, not response text", () => {
  assert.throws(() => requireResult({ error: { code: "42501", message: "sensitive response content" } }, "Fixture"), /^Error: Fixture failed \(42501\)\.$/);
  assert.throws(() => requireResult({ error: { code: "https://credential@private.test/token", message: "sensitive response content" } }, "Fixture"), /^Error: Fixture failed \(service_error\)\.$/);
});

test("failure metadata allows known service codes and bounded HTTP statuses without retaining responses", () => {
  assert.deepEqual(qaFailureMetadata(denied("42501", 403)), { qaErrorCode: "42501", qaHttpStatus: 403 });
  assert.deepEqual(qaFailureMetadata(denied("PGRST202", 404)), { qaErrorCode: "PGRST202", qaHttpStatus: 404 });
  assert.deepEqual(qaFailureMetadata({ error: new StorageApiError("private response", 403, "AccessDenied") }), { qaErrorCode: "AccessDenied", qaHttpStatus: 403 });
  assert.deepEqual(qaFailureMetadata({ error: { code: "email_not_confirmed", status: 400 } }), { qaErrorCode: "email_not_confirmed", qaHttpStatus: 400 });
  for (const status of [true, [], {}, 0, 99, 600, Infinity, NaN, "403 credential", "0403", "3e2"]) {
    assert.deepEqual(qaFailureMetadata({ data: ["private row"], error: { code: "private_token_value", status, message: "private response", details: "private details" } }), { qaErrorCode: "service_error", qaHttpStatus: null });
  }
  assert.deepEqual(qaFailureMetadata({ error: { code: "TOKEN", statusCode: "401" } }), { qaErrorCode: "service_error", qaHttpStatus: 401 });
});

test("fixture failures retain only allowlisted primitive metadata and no original cause", () => {
  assert.throws(() => requireResult({ data: { password: "private" }, error: { code: "private_token_value", status: 503, message: "private response", details: "private detail" } }, "Fixture"), (error) => {
    assert.equal(error.message, "Fixture failed (service_error).");
    assert.deepEqual(Object.keys(error), ["qaErrorCode", "qaHttpStatus"]);
    assert.equal(error.qaErrorCode, "service_error");
    assert.equal(error.qaHttpStatus, 503);
    assert.equal(error.cause, undefined);
    assert.equal(JSON.stringify(error).includes("private"), false);
    return true;
  });
});

test("direct API failures expose the numeric assertion and safe returned Auth diagnostics", async () => {
  const context = { runId: "mock-run", admin: {}, accounts: { admin: { id: "mock-account", client: { auth: {
    async getUser() { return { data: { user: null }, error: { code: "unexpected_failure", status: 503, message: "private backend response" } }; },
  } } } } };
  await assert.rejects(runApiChecks(context), (error) => {
    assert.equal(error.message, "Direct API security check failed: dedicated account has a validated Auth identity.");
    assert.deepEqual({ index: error.qaAssertionIndex, code: error.qaErrorCode, status: error.qaHttpStatus }, { index: 1, code: "unexpected_failure", status: 503 });
    assert.equal(error.cause, undefined);
    assert.equal(JSON.stringify(error).includes("private"), false);
    return true;
  });
});

test("direct API request failures preserve assertion numbering and PostgREST diagnostics", async () => {
  const client = {
    auth: { async getUser() { return { data: { user: { id: "mock-account" } }, error: null }; } },
    from() { return { select() { return { eq() { return { async single() { return denied("PGRST202", 404); } }; } }; } }; },
  };
  await assert.rejects(runApiChecks({ runId: "mock-run", admin: {}, accounts: { admin: { id: "mock-account", client } } }), (error) => {
    assert.equal(error.message, "Direct API security check failed: own private profile remains readable.");
    assert.deepEqual({ index: error.qaAssertionIndex, code: error.qaErrorCode, status: error.qaHttpStatus }, { index: 2, code: "PGRST202", status: 404 });
    return true;
  });
});

test("thrown SDK messages cannot impersonate a trusted API assertion and leak diagnostics", async () => {
  const context = { runId: "mock-run", admin: {}, accounts: { admin: { id: "mock-account", client: { auth: {
    async getUser() { throw Object.assign(new Error("Direct API security check failed: private credentials."), { code: "request_timeout", status: 503 }); },
  } } } } };
  await assert.rejects(runApiChecks(context), (error) => {
    assert.equal(error.message, "Direct API security checks could not complete. Inspect the local QA service health.");
    assert.equal(error.qaErrorCode, "request_timeout");
    assert.equal(error.qaHttpStatus, 503);
    assert.equal(error.qaAssertionIndex, undefined);
    assert.equal(error.cause, undefined);
    assert.equal(JSON.stringify(error).includes("private"), false);
    return true;
  });
});

test("negative Data API checks require an expected SQLSTATE, not just an error", () => {
  assert.equal(isExpectedDataDenial(denied("42501")), true);
  assert.equal(isExpectedDataDenial(denied("23514", 400), ["23514"]), true);
  for (const code of ["", "PGRST202", "PGRST301", "42P01", "42883", "08P01", "XX000"]) {
    assert.equal(isExpectedDataDenial(denied(code)), false);
  }
  assert.equal(isExpectedDataDenial({ data: null, error: { message: "fetch failed" }, status: 0 }), false);
});

test("business conflicts return a non-retryable HTTP 409 without accepting gateway outages", () => {
  assert.deepEqual(qaFailureMetadata(denied("PT409", 409)), { qaErrorCode: "PT409", qaHttpStatus: 409 });
  assert.equal(isExpectedDataDenial(denied("PT409", 409), ["PT409"]), true);
  assert.equal(isExpectedDataDenial(denied("PT409", 409)), false);
  for (const status of [500, 502, 503, 504]) {
    assert.equal(isExpectedDataDenial(denied("PT409", status), ["PT409"]), false);
    assert.equal(isExpectedDataDenial(denied("", status), ["PT409"]), false);
  }
});

test("expected PostgREST rollback/no-data SQLSTATEs may map to 500 without allowing outages", () => {
  assert.equal(isExpectedDataDenial(denied("P0002", 500)), true);
  assert.equal(isExpectedDataDenial(denied("40001", 500), ["40001"]), true);
  assert.equal(isExpectedDataDenial(denied("40001", 500)), false);
  assert.equal(isExpectedDataDenial(denied("42501", 500)), false);
  assert.equal(isExpectedDataDenial(denied("P0002", 502)), false);
  assert.equal(isExpectedDataDenial(denied("42501", 0)), false);
});

test("hidden rows are a successful empty array or an explicit permission denial", () => {
  assert.equal(isInvisibleDataResult({ data: [], error: null, status: 200 }), true);
  assert.equal(isInvisibleDataResult(denied("42501")), true);
  assert.equal(isInvisibleDataResult({ data: [{ id: "private" }], error: null, status: 200 }), false);
  assert.equal(isInvisibleDataResult({ data: null, error: null, status: 200 }), false);
  assert.equal(isInvisibleDataResult({ data: [], error: null, status: 503 }), false);
  assert.equal(isInvisibleDataResult(denied("PGRST106", 406)), false);
  assert.equal(isInvisibleDataResult(denied("PGRST106", 406), ["PGRST106"]), true);
});

test("Storage denials reject transport, invalid-input, conflict, and server failures", () => {
  for (const statusCode of ["401", "403", "404"]) {
    assert.equal(isExpectedStorageDenial({ error: { statusCode, message: "Access denied" } }), true);
  }
  assert.equal(isExpectedStorageDenial({ error: { statusCode: "400", message: "new row violates row-level security policy" } }), true);
  assert.equal(isExpectedStorageDenial({ error: { statusCode: "400", message: "Object not found" } }), true);
  for (const error of [
    { message: "fetch failed" },
    { statusCode: "0", message: "Access denied" },
    { statusCode: "400", message: "Invalid MIME type" },
    { statusCode: "409", message: "Already exists" },
    { statusCode: "500", message: "Access denied" },
    { statusCode: "503", message: "Service unavailable" },
  ]) assert.equal(isExpectedStorageDenial({ error }), false);
});

test("Storage SDK numeric HTTP status takes precedence over symbolic statusCode", () => {
  assert.equal(isExpectedStorageDenial({ error: new StorageApiError("Access denied", 403, "AccessDenied") }), true);
  assert.equal(isExpectedStorageDenial({ error: new StorageApiError("Object not found", 404, "NoSuchKey") }), true);
  assert.equal(isExpectedStorageDenial({ error: { status: 503, statusCode: "403" } }), false);
  assert.equal(isExpectedStorageDenial({ status: 500, error: { status: 403, statusCode: "AccessDenied" } }), false);
  assert.equal(isExpectedStorageDenial({ error: { statusCode: "AccessDenied" } }), false);
});

test("Storage no-op deletion and RLS empties must actually be successful responses", () => {
  assert.equal(isUnchangedStorageResult({ data: [], error: null }), true);
  assert.equal(isUnchangedStorageResult({ data: null, error: { statusCode: "403" } }), true);
  assert.equal(isUnchangedStorageResult({ data: [{ name: "removed" }], error: null }), false);
  assert.equal(isUnchangedStorageResult({ data: null, error: { message: "fetch failed" } }), false);
  assert.equal(isSuccessfulEmptyResult({ data: [], error: null, status: 0 }), false);
  assert.equal(isSuccessfulApiResult({ data: false, error: null, status: 200 }), true);
  assert.equal(isSuccessfulApiResult({ data: false, error: null, status: 500 }), false);
});

const id = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

function cleanupContext({ databaseRows = [{ id, profile_id: id, qa_run_id: runId }], objects = [], apiRunId = runId } = {}) {
  const calls = [];
  const transaction = {
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith("select account.id")) return { rowCount: databaseRows.length, rows: databaseRows };
      if (sql.startsWith("select bucket_id")) return { rowCount: objects.length, rows: objects };
      return { rowCount: 0, rows: [] };
    },
    release() { calls.push("release"); },
  };
  const context = {
    runId, accounts: { buyer: { id, client: { auth: { async signOut() { calls.push("signout"); return { error: null }; } } } } },
    pool: { async connect() { calls.push("connect"); return transaction; } },
    admin: {
      auth: { admin: {
        async getUserById() { return { data: { user: { app_metadata: { qa_run_id: apiRunId } } }, error: null }; },
        async deleteUser() { calls.push("deleteUser"); return { data: {}, error: null }; },
      } },
      storage: { from() { return { async remove() { calls.push("storage.remove"); return { data: [], error: null }; } }; } },
    },
  };
  return { context, calls };
}

const isMutation = (call) => /^(?:delete|update)/i.test(call) || ["deleteUser", "storage.remove"].includes(call);

test("cleanup rejects a wrong API run marker before accessing the database", async () => {
  const { context, calls } = cleanupContext({ apiRunId: "another-run" });
  await assert.rejects(cleanupFixtures(context), /another run/);
  assert.deepEqual(calls, []);
});

test("cleanup rejects a mismatched SQL project or run marker before any deletion", async () => {
  for (const databaseRows of [[], [{ id, profile_id: id, qa_run_id: "another-run" }], [{ id, profile_id: null, qa_run_id: runId }]]) {
    const { context, calls } = cleanupContext({ databaseRows });
    await assert.rejects(cleanupFixtures(context), /same run-owned|another run|own profile/);
    assert.equal(calls.some(isMutation), false);
    assert.ok(calls.includes("rollback"));
  }
});

test("cleanup validates Storage ownership before changing related database records", async () => {
  const { context, calls } = cleanupContext({ objects: [{ bucket_id: "avatars", owner_id: id, name: "another-student/avatar.png" }] });
  await assert.rejects(cleanupFixtures(context), /non-owned Storage/);
  assert.equal(calls.some(isMutation), false);
  assert.ok(calls.includes("rollback"));
});

test("cleanup checks matching API and locked database identities before scoped mutations", async () => {
  const { context, calls } = cleanupContext();
  await cleanupFixtures(context);
  const identityIndex = calls.findIndex((call) => call.startsWith("select account.id"));
  const firstMutation = calls.findIndex(isMutation);
  assert.ok(identityIndex > calls.indexOf("begin") && identityIndex < firstMutation);
  assert.ok(calls[identityIndex].includes("for update of account"));
  assert.ok(calls.includes("commit"));
  assert.ok(calls.includes("deleteUser"));
});
