import assert from "node:assert/strict";
import { test } from "node:test";
import { dumpFailureCodes, producerFailureMarker, resticFailureCodes, capturePhases } from "../scripts/operations/diagnostics.mjs";
import { command } from "../scripts/operations/process.mjs";
import { resticClient } from "../scripts/operations/restic.mjs";

test("database export diagnostics report only fixed categories, never private command output", () => {
  const samples = [
    ["password authentication failed for private-user", "DATABASE_AUTHENTICATION_REJECTED"],
    ["permission denied for private-table", "DATABASE_PERMISSION_DENIED"],
    ["query would be affected by row-level security policy", "DATABASE_PERMISSION_DENIED"],
    ["invalid snapshot identifier: private-snapshot", "DUMP_SNAPSHOT_REJECTED"],
    ["aborting because of server version mismatch", "DUMP_VERSION_REJECTED"],
    ["root certificate file private-path does not exist", "DUMP_TLS_REJECTED"],
    ["could not translate host name private-host", "DATABASE_NETWORK_UNAVAILABLE"],
    ["canceling statement due to statement timeout", "DATABASE_QUERY_TIMEOUT"],
    ["Cannot connect to the Docker daemon at private-endpoint", "DUMP_DOCKER_UNAVAILABLE"],
    ["toomanyrequests: You have reached your unauthenticated pull rate limit", "DUMP_IMAGE_UNAVAILABLE"],
    ["cannot execute private-statement in a read-only transaction", "DUMP_READ_ONLY_REFUSAL"],
  ];
  for (const [text, code] of samples) {
    const codes = dumpFailureCodes(text); assert.ok(codes.includes(code)); assert.ok(!JSON.stringify(codes).includes("private"));
  }
  assert.deepEqual(dumpFailureCodes("private unexpected failure"), ["DUMP_COMMAND_FAILED"]);
});

test("producer failures cross the restic boundary as an allowlisted marker, without Error text or unknown codes", () => {
  const error = Object.assign(new Error("private error and credentials"), {
    operationCodes: ["DUMP_TOOL_FAILED", "DUMP_TLS_REJECTED", "private-credential", "DATABASE_AUTHENTICATION_REJECTED"],
  });
  const marker = producerFailureMarker(error);
  assert.ok(!marker.includes("private"));
  assert.deepEqual(new Set(resticFailureCodes(`private command output\n${marker}\nrepository is already locked`)),
    new Set(["REPOSITORY_LOCKED", "DUMP_TOOL_FAILED", "DUMP_TLS_REJECTED", "DATABASE_AUTHENTICATION_REJECTED"]));
  assert.deepEqual(resticFailureCodes("UCM_BACKUP_FAILURE:UNREVIEWED_CODE,PRIVATE_DATA"), []);
  assert.equal(producerFailureMarker(new Error("private")), "UCM_BACKUP_FAILURE:BACKUP_PRODUCER_FAILED\n");
  assert.equal(producerFailureMarker({ operationCodes: "private" }), "UCM_BACKUP_FAILURE:BACKUP_PRODUCER_FAILED\n");
  assert.ok(capturePhases.includes("capture-database") && capturePhases.includes("capture-manifest") && !capturePhases.includes("private"));
});

test("process wrappers classify actual failing stderr without retaining provider output in errors", async () => {
  const diagnostic = "pg_dump: error: invalid snapshot identifier: private-do-not-log";
  await assert.rejects(command(process.execPath, ["-e", "process.stderr.write(process.argv[1]); process.exitCode=7", diagnostic], { postgresDumpDiagnostics: true }), error => {
    assert.deepEqual(error.operationCodes, ["DUMP_SNAPSHOT_REJECTED"]);
    assert.ok(!String(error).includes("private") && !JSON.stringify(error).includes("private")); return true;
  });
  await assert.rejects(command(process.execPath, ["-e", "process.stderr.write(process.argv[1]); process.exitCode=7",
    "private-do-not-log\nUCM_BACKUP_FAILURE:DUMP_COMMAND_FAILED,DATABASE_PERMISSION_DENIED,UNREVIEWED_CODE\n"], { resticDiagnostics: true }), error => {
    assert.deepEqual(error.operationCodes, ["DUMP_COMMAND_FAILED", "DATABASE_PERMISSION_DENIED"]);
    assert.ok(!String(error).includes("private") && !JSON.stringify(error).includes("private")); return true;
  });
});

test("malformed or missing restic completion summaries fail with a fixed code and no raw JSON", async () => {
  for (const text of ["private-not-json", "", '{"message_type":"status","private":"do-not-log"}', '{"message_type":"summary","snapshot_id":"private-invalid"}']) {
    const storage = resticClient({}, async () => Buffer.from(text));
    await assert.rejects(storage.backup("database", "11111111-1111-4111-8111-111111111111", ["safe-producer"]), error => {
      assert.deepEqual(error.operationCodes, ["RESTIC_SUMMARY_INVALID"]);
      assert.ok(!String(error).includes(text) || text === ""); assert.ok(!JSON.stringify(error).includes("do-not-log")); return true;
    });
  }
});
