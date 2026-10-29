import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export const registry = JSON.parse(await readFile(new URL("../../config/environments.json", import.meta.url), "utf8"));
export const policy = JSON.parse(await readFile(new URL("../../config/operations.json", import.meta.url), "utf8"));
export const buckets = Object.freeze(["listing-images", "avatars", "student-verifications"]);
export const components = Object.freeze(["database", "media", "verification", "bundle"]);
export const snapshotId = /^[a-f0-9]{64}$/;
export const runId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function validateTarget(env) {
  assert.equal(env.OPS_ENV, "staging", "Operations currently support staging only; production is blocked.");
  assert.equal(env.OPS_PROJECT_REF, registry.staging.supabaseProjectRef, "Explicit staging identity required.");
  assert.notEqual(registry.staging.supabaseProjectRef, registry.production.supabaseProjectRef);
  assert.equal(registry.production.deploymentEnabled, false, "Review operations before enabling production.");
  return registry.staging;
}

export function validateBackupPolicy(env, selected = policy.staging) {
  validateTarget(env);
  assert.equal(selected.enabled, true, "Backup activation requires reviewed policy.");
  assert.equal(selected.retentionApproved, true, "Approve retention before copying private data.");
  assert.ok(typeof selected.owner === "string" && selected.owner.trim().length > 2, "A backup owner is required.");
  assert.ok(Number.isInteger(selected.retentionDays) && selected.retentionDays >= 1 && selected.retentionDays <= 30);
  assert.ok(Number.isInteger(selected.verificationRetentionDays) && selected.verificationRetentionDays >= 1
    && selected.verificationRetentionDays <= selected.retentionDays, "Verification retention must not exceed general retention.");
  // The single bundle expires at the stricter limit. Never retain verification
  // images longer merely to keep a general database/media backup.
  assert.equal(selected.verificationRetentionDays, selected.retentionDays, "Use the strictest retention for all bundle components.");
  assert.ok(typeof selected.repository === "string" && /^s3:https:\/\/[a-z0-9.-]+(?::443)?\/[a-zA-Z0-9/_-]+$/.test(selected.repository),
    "Configure an exact HTTPS S3-compatible off-site repository without embedded credentials.");
  assert.equal(env.RESTIC_REPOSITORY, selected.repository, "Backup repository must match the approved destination.");
  assert.ok(typeof env.RESTIC_PASSWORD === "string" && env.RESTIC_PASSWORD.length >= 32
    && !/example|placeholder|changeme/i.test(env.RESTIC_PASSWORD), "A persistent strong repository password is required.");
  assert.match(selected.repositoryId ?? "", snapshotId, "Pin the independently initialized restic repository ID.");
  assert.ok(Number.isSafeInteger(selected.maxObjects) && selected.maxObjects > 0 && selected.maxObjects <= 100000);
  assert.ok(Number.isSafeInteger(selected.maxStorageBytes) && selected.maxStorageBytes > 0 && selected.maxStorageBytes <= 107374182400);
  return selected;
}

export function validateObject(object) {
  assert.ok(buckets.includes(object.bucket_id), "Unexpected Storage bucket.");
  assert.ok(typeof object.name === "string" && object.name.length <= 1024 && /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(object.name)
    && object.name.split("/").every(segment => segment && segment !== "." && segment !== ".."), "Unsafe Storage object path.");
  const size = Number(object.metadata?.size);
  assert.ok(Number.isSafeInteger(size) && size > 0 && size <= (object.bucket_id === "avatars" ? 2 : 5) * 1024 * 1024, "Unexpected object size.");
  assert.ok(["image/png", "image/jpeg", "image/webp"].includes(object.metadata?.mimetype), "Unexpected object content type.");
  return { ...object, size };
}

export function expiredSnapshots(snapshots, now, days) {
  assert.ok(Number.isFinite(now) && Number.isInteger(days) && days >= 1 && days <= 30);
  const cutoff = now - days * 86400000;
  return snapshots.filter(snapshot => {
    assert.match(snapshot.id, snapshotId);
    assert.ok(Number.isFinite(Date.parse(snapshot.time)) && Date.parse(snapshot.time) <= now + 300000, "Invalid backup timestamp.");
    assert.equal(snapshot.hostname, "uc-marketplace-staging");
    assert.ok(snapshot.tags?.includes("ucm:staging") && components.some(component => snapshot.tags.includes(`component:${component}`)));
    return Date.parse(snapshot.time) < cutoff;
  }).map(snapshot => snapshot.id);
}

export function backupFreshness(bundles, now, staleHours) {
  const dates = bundles.filter(item => item.tags?.includes("component:bundle") && item.tags?.includes("ucm:staging"))
    .map(item => Date.parse(item.time)).filter(time => Number.isFinite(time) && time <= now + 300000);
  const latest = Math.max(...dates);
  return { status: Number.isFinite(latest) && now - latest <= staleHours * 3600000 ? "healthy" : "stale",
    ageHours: Number.isFinite(latest) ? Math.max(0, Math.floor((now - latest) / 3600000)) : null };
}
