import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateBackupPolicy, assertSyntheticSource, registry } from "./policy.mjs";
import { validateServiceKey, prepareCa } from "./backup.mjs";
import { connect } from "./database.mjs";
import { backblazeConfiguration, verifyBackblaze } from "./backblaze.mjs";
import { resticClient } from "./restic.mjs";
import { validateBuckets } from "./storage.mjs";
import { backblazeFailure, databaseFailureCode } from "./diagnostics.mjs";

export async function verifyOperations(env) {
  let phase = "preflight-policy";
  try {
  const selected = validateBackupPolicy(env); validateServiceKey(env);
  assert.equal(selected.dataScope, "synthetic-only");
  const url = new URL(selected.repository.slice(3));
  const segments = url.pathname.slice(1).split("/"); const bucket = segments.shift(), prefix = `${segments.join("/")}/`;
  const normalized = backblazeConfiguration({ B2_ENDPOINT: url.hostname, B2_BUCKET_NAME: bucket,
    B2_KEY_ID: env.AWS_ACCESS_KEY_ID, B2_APPLICATION_KEY: env.AWS_SECRET_ACCESS_KEY });
  phase = "preflight-b2";
  const id = randomUUID(), target = await verifyBackblaze(normalized, id);
  const allowedPrefix = target.prefix.slice(0, -`ucm-synthetic-tests/${id}`.length);
  assert.ok(prefix.startsWith(allowedPrefix), "The permanent repository is outside this key's prefix scope.");
  assert.equal(env.AWS_DEFAULT_REGION, target.region);
  phase = "preflight-vault";
  const configured = await prepareCa({ ...env, AWS_ACCESS_KEY_ID: normalized.B2_KEY_ID, AWS_SECRET_ACCESS_KEY: normalized.B2_APPLICATION_KEY });
  const storage = resticClient(configured); await storage.verify(selected.repositoryId);
  phase = "preflight-database";
  const { client } = await connect(configured);
  try {
    await client.query("begin isolation level repeatable read read only"); await assertSyntheticSource(client);
    validateBuckets((await client.query("select id,public from storage.buckets order by id")).rows);
    await client.query("rollback");
  } finally { await client.end(); }
  phase = "preflight-storage";
  const response = await fetch(`https://${registry.staging.supabaseProjectRef}.supabase.co/storage/v1/bucket`, {
    redirect: "error", signal: AbortSignal.timeout(30000), headers: { apikey: env.OPS_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.OPS_SERVICE_ROLE_KEY}` },
  });
  assert.ok(response.ok, "Staging private Storage access was refused.");
  validateBuckets(await response.json());
  return configured;
  } catch (error) {
    error.operationPhase = phase;
    if (phase === "preflight-b2") {
      const diagnostic = backblazeFailure(error, "b2-preflight");
      error.operationCodes = [diagnostic.failureCode, ...diagnostic.operationCodes];
    }
    if (phase === "preflight-database") error.operationCodes = [databaseFailureCode(error)];
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 2); await verifyOperations(process.env);
    console.log(JSON.stringify({ status: "passed", environment: "staging", dataScope: "synthetic-only", repositoryIdentityVerified: true,
      privateDestinationVerified: true, fixtureOwnershipVerified: true, storageCredentialVerified: true, backupCreated: false, productionTouched: false }));
  } catch { console.error(JSON.stringify({ status: "failed", operation: "staging-backup-preflight", privateDetailsWithheld: true, backupCreated: false, productionTouched: false })); process.exitCode = 1; }
}
