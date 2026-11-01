import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { command } from "./process.mjs";
import { capture } from "./backup.mjs";
import { verifyOperations } from "./verify.mjs";
import { policy, validateBackupPolicy } from "./policy.mjs";
import { resticClient } from "./restic.mjs";
import { readJsonSnapshot, validateRestoreEvidence } from "./bundle.mjs";
import { restoreBundle } from "./restore.mjs";

export async function reviewedSource() {
  const sha = (await command("git", ["rev-parse", "HEAD"])).toString().trim(); assert.match(sha, /^[a-f0-9]{40}$/); return sha;
}

export async function verifyScheduledReadiness(env, sha, storage = resticClient(env)) {
  const selected = validateBackupPolicy(env); assert.equal(selected.enabled, true, "Scheduled backups remain disabled.");
  assert.equal(env.OPS_SCHEDULED_CONFIRM, "staging-synthetic-only");
  await storage.verify(selected.repositoryId);
  const proofs = (await storage.snapshots()).filter(item => item.tags?.includes("component:restore-evidence"))
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  assert.ok(proofs.length, "Restore the exact vault backup before scheduling.");
  const evidence = validateRestoreEvidence(await readJsonSnapshot(storage, proofs[0].id, "restore-evidence"), selected.repositoryId, sha);
  assert.ok(proofs[0].tags.includes(`run:${evidence.runId}`));
  return evidence;
}

export async function cycle(env) {
  const selected = validateBackupPolicy(env), sha = await reviewedSource();
  let phase = "preflight";
  try {
    const configured = await verifyOperations(env);
    if (env.OPS_SCHEDULED_CONFIRM) await verifyScheduledReadiness(configured, sha);
    phase = "capture";
    const captured = await capture(configured);
    phase = "restore";
    const evidence = await restoreBundle(configured, captured.snapshots.bundle, sha);
    validateRestoreEvidence(evidence, selected.repositoryId, sha);
    phase = "restore-evidence";
    const storage = resticClient({ ...configured, OPS_RUN_ID: captured.runId, OPS_RESTORE_EVIDENCE: JSON.stringify(evidence) });
    const proof = await storage.backup("restore-evidence", captured.runId, [process.execPath, fileURLToPath(new URL("./producer.mjs", import.meta.url)), "restore-evidence"]);
    await storage.check(true);
    return { status: "passed", environment: "staging", dataScope: "synthetic-only", bundleId: captured.snapshots.bundle, restoreProofId: proof,
      databaseRestored: evidence.databaseRestored, storageRestored: evidence.storageRestored, objectsRestored: evidence.objectsRestored,
      catalogAssertions: evidence.catalogAssertions, restoredAccessChecks: evidence.restoredAccessChecks, imageDecoded: evidence.imageDecoded,
      cleanup: evidence.cleanup, elapsedSeconds: evidence.elapsedSeconds, productionTouched: false, alertsSent: false };
  } catch (error) { error.operationPhase ??= phase; throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assert.equal(process.argv.length, 2); assert.equal(policy.production.enabled, false); console.log(JSON.stringify(await cycle(process.env))); }
  catch (error) { console.error(JSON.stringify({ status: "failed", environment: "staging", operation: "capture-and-isolated-restore", privateDetailsWithheld: true,
    failurePhase: ["preflight", "preflight-policy", "preflight-b2", "preflight-vault", "preflight-database", "preflight-storage", "capture", "restore", "restore-container", "restore-archive", "restore-fingerprints", "restore-security", "restore-files", "restore-image", "restore-evidence"].includes(error?.operationPhase) ? error.operationPhase : "preflight",
    operationCodes: Array.isArray(error?.operationCodes) ? error.operationCodes : [], productionTouched: false })); process.exitCode = 1; }
}
