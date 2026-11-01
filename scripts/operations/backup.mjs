import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { connect, databaseManifest, inventorySql, validateExportedSnapshot } from "./database.mjs";
import { policy, registry, validateBackupPolicy, validateTarget, validateObject, expiredSnapshots, assertSyntheticSource } from "./policy.mjs";
import { inventoryDigest, validateBuckets } from "./storage.mjs";
import { resticClient } from "./restic.mjs";
import { getStagingCa } from "../staging/tls.mjs";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export async function prepareCa(env) {
  const pem = await getStagingCa();
  const directory = path.join(root, ".qa", "operations");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, "provider-ca.crt");
  await writeFile(filename, pem, { mode: 0o600 });
  return { ...env, OPS_CA_FILE: filename };
}

export function validateServiceKey(env) {
  const parts = env.OPS_SERVICE_ROLE_KEY?.split(".");
  assert.equal(parts?.length, 3, "Use an operator-only legacy service key with verifiable project provenance.");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  assert.equal(payload.ref, registry.staging.supabaseProjectRef); assert.equal(payload.role, "service_role");
  assert.ok(payload.exp > Date.now() / 1000);
}

export async function capture(env, adapters = {}) {
  const selected = validateBackupPolicy(env); validateServiceKey(env);
  assert.equal(env.OPS_CONFIRM, `${registry.staging.supabaseProjectRef}:backup`, "Explicit backup confirmation required.");
  const id = randomUUID(), startedAt = new Date().toISOString();
  const storage = adapters.restic ?? resticClient(env);
  await storage.verify(selected.repositoryId);
  const { client } = await (adapters.connect ?? connect)(env);
  try {
    await client.query("set idle_in_transaction_session_timeout='20min'");
    await client.query("begin isolation level repeatable read read only");
    if (selected.dataScope === "synthetic-only") await assertSyntheticSource(client);
    const exported = validateExportedSnapshot((await client.query("select pg_export_snapshot() as id")).rows[0].id);
    validateBuckets((await client.query("select id,public from storage.buckets order by id")).rows);
    const objects = (await client.query(inventorySql)).rows;
    assert.ok(objects.length <= selected.maxObjects);
    const bytes = objects.reduce((sum, object) => sum + validateObject(object).size, 0);
    assert.ok(bytes <= selected.maxStorageBytes);
    const database = await databaseManifest(client);
    const workerEnv = { ...env, OPS_RUN_ID: id, OPS_EXPORTED_SNAPSHOT: exported };
    // A new child environment carries the exported snapshot only in memory.
    const worker = adapters.worker ?? (childEnv => resticClient(childEnv));
    const producer = component => [process.execPath, fileURLToPath(new URL("./producer.mjs", import.meta.url)), component];
    const snapshots = {};
    for (const component of ["database", "media", "verification"]) {
      snapshots[component] = await worker(workerEnv).backup(component, id, producer(component));
    }
    const { client: current } = await (adapters.connect ?? connect)(env);
    try { assert.equal(inventoryDigest((await current.query(inventorySql)).rows), inventoryDigest(objects), "Storage changed; do not certify this capture."); }
    finally { await current.end(); }
    await storage.check();
    const manifest = { version: 1, complete: true, projectRef: registry.staging.supabaseProjectRef, runId: id, dataScope: selected.dataScope,
      startedAt, completedAt: new Date().toISOString(), inventorySha256: inventoryDigest(objects),
      database, storage: { objects: objects.length, bytes, inventory: objects }, snapshots,
      excludes: ["managed-role-passwords", "auth-provider-settings-and-api-keys", "smtp-credentials", "root-encryption-key", "edge-functions", "off-site-repository-key"] };
    snapshots.bundle = await worker({ ...workerEnv, OPS_BUNDLE_MANIFEST: JSON.stringify(manifest) }).backup("bundle", id, producer("bundle"));
    await client.query("rollback");
    // Counts/opaque snapshot IDs only. The private encrypted manifest carries
    // table inventories and relationships; no credentials go into any receipt.
    return { version: 1, status: "captured", runId: id, startedAt, completedAt: manifest.completedAt,
      projectRef: registry.staging.supabaseProjectRef, objects: objects.length, bytes, snapshots, restoreTested: false };
  } finally { await client.query("rollback").catch(() => {}); await client.end(); }
}

async function main() {
  const [operation] = process.argv.slice(2);
  assert.equal(process.argv.length, 3);
  if (operation === "plan") {
    const selected = policy.staging;
    console.log(JSON.stringify({ environment: "staging", backupEnabled: selected.enabled, manualBackupEnabled: selected.manualBackupEnabled === true, monitoringEnabled: selected.monitoringEnabled,
      repositoryConfigured: Boolean(selected.repository && selected.repositoryId), ownerConfigured: Boolean(selected.owner),
      repositoryUrlConfigured: Boolean(selected.repository), repositoryIdConfigured: Boolean(selected.repositoryId),
      deputyConfigured: Boolean(selected.deputy), syntheticPolicyApproved: selected.syntheticPolicyApproval?.approved === true,
      approvedDataScope: selected.syntheticPolicyApproval?.dataScope ?? null,
      approvedDailyTime: selected.syntheticPolicyApproval?.dailyAt ?? null,
      approvedScheduleTimezone: selected.syntheticPolicyApproval?.timezone ?? null,
      approvedSyntheticRetentionDays: selected.syntheticPolicyApproval?.retentionDays ?? null,
      activationApproved: selected.syntheticPolicyApproval?.activationApproved === true,
      deletionApproved: selected.syntheticPolicyApproval?.deletionApproved === true,
      retentionApproved: selected.retentionApproved, proposedRetentionDays: selected.retentionDays,
      proposedVerificationRetentionDays: selected.verificationRetentionDays, backupIntervalHours: selected.backupIntervalHours,
      productionEnabled: false, credentialsPrinted: false })); return;
  }
  validateTarget(process.env); const selected = validateBackupPolicy(process.env);
  const env = await prepareCa(process.env), storage = resticClient(env);
  await storage.verify(selected.repositoryId);
  if (operation === "capture") {
    const result = await capture(env);
    await writeFile(path.join(root, ".qa", "operations", `${result.runId}.json`), `${JSON.stringify(result)}\n`, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: result.status, runId: result.runId, objects: result.objects, restoreTested: false }));
  } else if (operation === "check") {
    await storage.check(true); console.log(JSON.stringify({ repositoryIntegrity: "passed", allDataRead: true, restoreTested: false }));
  } else if (["retention-plan", "retention-apply"].includes(operation)) {
    const snapshots = await storage.snapshots();
    // A dedicated repository must contain only this application's snapshots.
    // restic prune needs separate deletion credentials and explicit approval.
    const ids = expiredSnapshots(snapshots, Date.now(), selected.retentionDays);
    const apply = operation === "retention-apply";
    if (apply) {
      assert.equal(selected.syntheticPolicyApproval?.deletionApproved, true, "Retention deletion needs separate approval.");
      assert.equal(env.OPS_PRUNE_CONFIRM, `${registry.staging.supabaseProjectRef}:prune:${new Date().toISOString().slice(0, 10)}`);
    }
    if (ids.length) await storage.forget(ids, apply);
    if (apply) await storage.check();
    console.log(JSON.stringify({ expiredSnapshots: ids.length, deleted: apply, unrelatedSnapshotsTargeted: false }));
  } else throw new Error();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch { console.error("Operations backup refused or failed; private database, object and provider diagnostics withheld. No automatic reset, retry or production fallback was attempted."); process.exitCode = 1; }
}
