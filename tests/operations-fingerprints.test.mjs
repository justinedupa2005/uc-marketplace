import assert from "node:assert/strict";
import { test } from "node:test";
import { fingerprintFormat, verifyTableFingerprints } from "../scripts/operations/fingerprints.mjs";
import { validateBundle } from "../scripts/operations/bundle.mjs";
import { registry } from "../scripts/operations/policy.mjs";

const a = "1".repeat(32), b = "2".repeat(32);
const expected = { "private.synthetic_table": { count: "2", fingerprint: a } };
test("fingerprint verification accepts identical data but distinguishes missing tables, missing rows and changed values without disclosure", () => {
  assert.doesNotThrow(() => verifyTableFingerprints(structuredClone(expected), expected));
  for (const [actual, code] of [[{}, "RESTORE_TABLE_SET_MISMATCH"],
    [{ "private.synthetic_table": { count: "1", fingerprint: a } }, "RESTORE_TABLE_ROW_COUNT_MISMATCH"],
    [{ "private.synthetic_table": { count: "2", fingerprint: b } }, "RESTORE_TABLE_DATA_MISMATCH"]]) {
    assert.throws(() => verifyTableFingerprints(actual, expected), error => {
      assert.deepEqual(error.operationCodes, [code]);
      assert.ok(!String(error).includes("synthetic_table") && !JSON.stringify(error).includes(a));
      assert.equal(error.actual, undefined); assert.equal(error.expected, undefined);
      return true;
    });
  }
});

test("bundles with legacy or unknown fingerprint formats require a fresh capture rather than being silently relabelled", () => {
  const run = "11111111-1111-4111-8111-111111111111";
  const ids = { database: "1".repeat(64), media: "2".repeat(64), verification: "3".repeat(64), bundle: "4".repeat(64) };
  const snapshots = Object.entries(ids).map(([component, id]) => ({ id, hostname: "uc-marketplace-staging",
    tags: ["ucm:staging", `component:${component}`, `run:${run}`] }));
  const manifest = { version: 1, complete: true, projectRef: registry.staging.supabaseProjectRef, runId: run, dataScope: "synthetic-only",
    snapshots: { database: ids.database, media: ids.media, verification: ids.verification },
    storage: { inventory: [], objects: 0 }, database: { fingerprintFormat, fingerprints: expected, roles: [] } };
  assert.equal(validateBundle(manifest, ids.bundle, snapshots), manifest);
  for (const format of [undefined, "legacy-default-locale", "unknown"]) {
    const input = { ...manifest, database: { ...manifest.database, fingerprintFormat: format } };
    assert.throws(() => validateBundle(input, ids.bundle, snapshots), error => error.operationCodes?.includes("RESTORE_FINGERPRINT_FORMAT_UNSUPPORTED"));
    assert.equal(input.database.fingerprintFormat, format);
  }
});
