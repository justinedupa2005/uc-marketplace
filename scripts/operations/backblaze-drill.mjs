import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { command, controlledEnvironment } from "./process.mjs";
import { verifyBackblaze, backblazeConfiguration, backblazeSecretStatus } from "./backblaze.mjs";
import { resticClient } from "./restic.mjs";
import { decodeStoragePack, writeStream } from "./storage.mjs";
import { syntheticPng, syntheticProjectRef } from "./drill-fixtures.mjs";
import { backblazeFailure } from "./diagnostics.mjs";

export async function backblazeDrill(source = process.env, adapters = {}) {
  let phase = "configuration";
  try {
  assert.equal(source.OPS_B2_SYNTHETIC_CONFIRM, "synthetic-only", "B2_CONFIRMATION_REQUIRED");
  assert.ok(!source.OPS_DATABASE_URL && !source.OPS_SERVICE_ROLE_KEY && !source.OPS_MANAGEMENT_TOKEN,
    "B2_SUPABASE_CREDENTIAL_REFUSED");
  const env = controlledEnvironment(source);
  const settings = backblazeConfiguration(source);
  phase = "b2-preflight";
  const id = randomUUID(), start = Date.now(), target = await (adapters.verify ?? verifyBackblaze)(settings, id);
  for (const name of Object.keys(env)) if (name.startsWith("AWS_") || name.startsWith("OPS_") && name !== "OPS_RESTIC_BINARY") delete env[name];
  Object.assign(env, { OPS_DRILL_ID: id, RESTIC_REPOSITORY: target.repository, RESTIC_PASSWORD: randomBytes(48).toString("base64url"),
    AWS_ACCESS_KEY_ID: settings.B2_KEY_ID, AWS_SECRET_ACCESS_KEY: settings.B2_APPLICATION_KEY, AWS_DEFAULT_REGION: target.region });
  const execute = adapters.execute ?? ((binary, args, options) => command(binary, args, { ...options, resticDiagnostics: true }));
  const client = adapters.restic ?? (env => resticClient(env, execute));
  const binary = env.OPS_RESTIC_BINARY || "restic", storage = client(env);
  // Restic refuses init of an existing repository; no overwrite, prune, cleanup
  // of existing prefixes, provider configuration changes or source-data reads.
  phase = "tool-verification";
  assert.match((await execute(binary, ["version"], { env })).toString(), /^restic 0\.19\.1\b/);
  phase = "repository-init";
  await execute(binary, ["--no-cache", "init", "--repository-version", "2"], { env });
  phase = "repository-verification";
  const config = JSON.parse((await execute(binary, ["--no-cache", "cat", "config"], { env })).toString());
  await storage.verify(config.id);
  const producer = component => [process.execPath, fileURLToPath(new URL("./storage-drill-producer.mjs", import.meta.url)), component];
  const snapshots = {};
  for (const component of ["media", "verification"]) { phase = `${component}-backup`; snapshots[component] = await storage.backup(component, id, producer(component)); }
  let objects = 0;
  for (const component of ["media", "verification"]) {
    phase = `${component}-restore`;
    const input = new PassThrough();
    await Promise.all([
      decodeStoragePack(input, { projectRef: syntheticProjectRef, runId: id, component, maxObjects: 10, maxStorageBytes: 10000 }, async (_object, bytes) => {
        assert.deepEqual(bytes, syntheticPng); objects++;
      }),
      storage.dump(snapshots[component], component, chunk => writeStream(input, chunk)).finally(() => input.end()),
    ]);
  }
  assert.equal(objects, 3);
  phase = "integrity-read";
  await storage.check(true);
  phase = "wrong-key-denial";
  await assert.rejects(client({ ...env, RESTIC_PASSWORD: randomBytes(48).toString("base64url") }).verify(config.id));
  phase = "failed-producer-denial";
  const before = (await storage.snapshots()).length;
  await assert.rejects(storage.backup("database", id, producer("broken")));
  assert.equal((await storage.snapshots()).length, before);
  return { version: 1, source: "synthetic-only", provider: "backblaze-b2", status: "passed", privateBucketVerified: true,
    configurationStatus: backblazeSecretStatus(source),
    objectsRestored: objects, repositoryIntegrity: "passed", wrongPasswordDenied: true, failedProducerRejected: true,
    elapsedSeconds: Math.ceil((Date.now() - start) / 1000), retainedSyntheticPrefix: target.prefix,
    ephemeralKeySaved: false, databaseRestoreTested: false, hostedStorageApiRestoreTested: false,
    realStudentDataUsed: false, productionTouched: false, alertsSent: false };
  } catch (error) {
    const failure = new Error("Backblaze synthetic drill failed.");
    failure.diagnostic = backblazeFailure(error, phase);
    throw failure; // Never forward raw provider messages, assertions or causes.
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assert.equal(process.argv.length, 2); console.log(JSON.stringify(await backblazeDrill())); }
  catch (error) { console.error(JSON.stringify({ version: 1, source: "synthetic-only", provider: "backblaze-b2", status: "failed",
    ...(error.diagnostic ?? backblazeFailure(error, "configuration")), configurationStatus: backblazeSecretStatus(process.env),
    realStudentDataUsed: false, productionTouched: false, alertsSent: false })); process.exitCode = 1; }
}
