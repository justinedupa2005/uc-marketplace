import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { command, controlledEnvironment } from "./process.mjs";
import { verifyBackblaze } from "./backblaze.mjs";
import { resticClient } from "./restic.mjs";
import { decodeStoragePack, writeStream } from "./storage.mjs";
import { syntheticPng, syntheticProjectRef } from "./drill-fixtures.mjs";

export async function backblazeDrill(source = process.env) {
  assert.equal(source.OPS_B2_SYNTHETIC_CONFIRM, "synthetic-only", "Explicit synthetic-only confirmation required.");
  assert.ok(!source.OPS_DATABASE_URL && !source.OPS_SERVICE_ROLE_KEY && !source.OPS_MANAGEMENT_TOKEN,
    "Do not inject any Supabase credential into this drill.");
  const id = randomUUID(), start = Date.now(), target = await verifyBackblaze(source, id);
  const env = controlledEnvironment(source);
  for (const name of Object.keys(env)) if (name.startsWith("AWS_") || name.startsWith("OPS_") && name !== "OPS_RESTIC_BINARY") delete env[name];
  Object.assign(env, { OPS_DRILL_ID: id, RESTIC_REPOSITORY: target.repository, RESTIC_PASSWORD: randomBytes(48).toString("base64url"),
    AWS_ACCESS_KEY_ID: source.B2_KEY_ID, AWS_SECRET_ACCESS_KEY: source.B2_APPLICATION_KEY, AWS_DEFAULT_REGION: target.region });
  const binary = env.OPS_RESTIC_BINARY || "restic", storage = resticClient(env);
  // Restic refuses init of an existing repository; no overwrite, prune, cleanup
  // of existing prefixes, provider configuration changes or source-data reads.
  assert.match((await command(binary, ["version"], { env })).toString(), /^restic 0\.19\.1\b/);
  await command(binary, ["--no-cache", "init", "--repository-version", "2"], { env });
  const config = JSON.parse((await command(binary, ["--no-cache", "cat", "config"], { env })).toString());
  await storage.verify(config.id);
  const producer = component => [process.execPath, fileURLToPath(new URL("./storage-drill-producer.mjs", import.meta.url)), component];
  const snapshots = {};
  for (const component of ["media", "verification"]) snapshots[component] = await storage.backup(component, id, producer(component));
  let objects = 0;
  for (const component of ["media", "verification"]) {
    const input = new PassThrough();
    await Promise.all([
      decodeStoragePack(input, { projectRef: syntheticProjectRef, runId: id, component, maxObjects: 10, maxStorageBytes: 10000 }, async (_object, bytes) => {
        assert.deepEqual(bytes, syntheticPng); objects++;
      }),
      storage.dump(snapshots[component], component, chunk => writeStream(input, chunk)).finally(() => input.end()),
    ]);
  }
  assert.equal(objects, 3);
  await storage.check(true);
  await assert.rejects(resticClient({ ...env, RESTIC_PASSWORD: randomBytes(48).toString("base64url") }).verify(config.id));
  const before = (await storage.snapshots()).length;
  await assert.rejects(storage.backup("database", id, producer("broken")));
  assert.equal((await storage.snapshots()).length, before);
  return { version: 1, source: "synthetic-only", provider: "backblaze-b2", status: "passed", privateBucketVerified: true,
    objectsRestored: objects, repositoryIntegrity: "passed", wrongPasswordDenied: true, failedProducerRejected: true,
    elapsedSeconds: Math.ceil((Date.now() - start) / 1000), retainedSyntheticPrefix: target.prefix,
    ephemeralKeySaved: false, databaseRestoreTested: false, hostedStorageApiRestoreTested: false,
    realStudentDataUsed: false, productionTouched: false, alertsSent: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assert.equal(process.argv.length, 2); console.log(JSON.stringify(await backblazeDrill())); }
  catch { console.error("Backblaze synthetic drill failed. Check private bucket, endpoint, bucket-limited key and read/list/write/delete-files permissions. Private diagnostics withheld; no student data was used."); process.exitCode = 1; }
}
