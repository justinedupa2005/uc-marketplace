import assert from "node:assert/strict";
import { registry, runId, snapshotId } from "./policy.mjs";
import { fingerprintFormat } from "./fingerprints.mjs";

export async function readJsonSnapshot(storage, id, component, maximum = 16000000) {
  assert.match(id, snapshotId);
  const chunks = []; let bytes = 0;
  await storage.dump(id, component, chunk => {
    bytes += chunk.length; assert.ok(bytes <= maximum, "Encrypted manifest exceeded its limit."); chunks.push(chunk);
  });
  return JSON.parse(Buffer.concat(chunks).toString());
}

export function validateBundle(manifest, id, snapshots) {
  assert.match(id, snapshotId); assert.match(manifest.runId ?? "", runId);
  assert.equal(manifest.version, 1); assert.equal(manifest.complete, true);
  assert.equal(manifest.projectRef, registry.staging.supabaseProjectRef);
  assert.equal(manifest.dataScope, "synthetic-only", "Only attested synthetic staging bundles may be restored.");
  assert.deepEqual(Object.keys(manifest.snapshots ?? {}).sort(), ["database", "media", "verification"]);
  const byId = new Map(snapshots.map(item => [item.id, item]));
  for (const [component, reference] of Object.entries({ bundle: id, ...manifest.snapshots })) {
    assert.ok(["database", "media", "verification", "bundle"].includes(component)); assert.match(reference, snapshotId);
    const item = byId.get(reference);
    assert.equal(item?.hostname, "uc-marketplace-staging");
    for (const tag of ["ucm:staging", `component:${component}`, `run:${manifest.runId}`]) assert.ok(item.tags.includes(tag));
  }
  for (const component of ["database", "media", "verification"]) assert.match(manifest.snapshots?.[component] ?? "", snapshotId);
  assert.ok(Array.isArray(manifest.storage?.inventory));
  assert.equal(manifest.storage.inventory.length, manifest.storage.objects);
  assert.ok(manifest.database?.fingerprints && Array.isArray(manifest.database.roles));
  assert.ok(manifest.database.fingerprintFormat === fingerprintFormat,
    Object.assign(new Error("Capture a fresh bundle with the supported comparison format."), { operationCodes: ["RESTORE_FINGERPRINT_FORMAT_UNSUPPORTED"] }));
  return manifest;
}

export function validateRestoreEvidence(value, repositoryId, sourceSha, now = Date.now()) {
  assert.equal(value.version, 1); assert.equal(value.status, "passed");
  assert.equal(value.environment, "staging"); assert.equal(value.dataScope, "synthetic-only");
  assert.equal(value.repositoryId, repositoryId); assert.equal(value.sourceSha, sourceSha);
  assert.match(value.bundleId ?? "", snapshotId); assert.match(value.runId ?? "", runId);
  for (const key of ["databaseRestored", "storageRestored", "tablesMatched", "imageDecoded", "cleanup"]) assert.equal(value[key], true);
  assert.ok(Number.isSafeInteger(value.catalogAssertions) && value.catalogAssertions > 0);
  assert.ok(Number.isSafeInteger(value.restoredAccessChecks) && value.restoredAccessChecks >= 3);
  assert.ok(Number.isSafeInteger(value.objectsRestored) && value.objectsRestored > 0);
  const completed = Date.parse(value.completedAt);
  assert.ok(Number.isFinite(completed) && completed <= now + 300000 && now - completed <= 7 * 86400000,
    "Scheduled capture needs recent successful restoration of the exact reviewed source.");
  assert.equal(value.productionTouched, false);
  return value;
}
