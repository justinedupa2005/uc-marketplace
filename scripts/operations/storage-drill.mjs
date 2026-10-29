import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { command, controlledEnvironment } from "./process.mjs";
import { resticClient } from "./restic.mjs";
import { decodeStoragePack, writeStream } from "./storage.mjs";
import { syntheticPng, syntheticProjectRef } from "./drill-fixtures.mjs";

try {
  assert.equal(process.argv.length, 2);
  const parent = fileURLToPath(new URL("../../.qa/operations/storage-drills/", import.meta.url));
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(parent, "run-")), id = randomUUID(), start = Date.now();
  const env = controlledEnvironment(process.env);
  for (const name of Object.keys(env)) if (name.startsWith("AWS_") || name.startsWith("OPS_") && name !== "OPS_RESTIC_BINARY") delete env[name];
  Object.assign(env, { OPS_DRILL_ID: id, RESTIC_REPOSITORY: path.join(directory, "encrypted-repository"), RESTIC_PASSWORD: randomBytes(48).toString("base64url") });
  const binary = env.OPS_RESTIC_BINARY || "restic", storage = resticClient(env);
  await command(binary, ["--no-cache", "init", "--repository-version", "2"], { env });
  const config = JSON.parse((await command(binary, ["--no-cache", "cat", "config"], { env })).toString());
  await storage.verify(config.id);
  const producer = component => [process.execPath, fileURLToPath(new URL("./storage-drill-producer.mjs", import.meta.url)), component];
  const snapshots = {};
  for (const component of ["media", "verification"]) snapshots[component] = await storage.backup(component, id, producer(component));
  const files = new Map();
  for (const component of ["media", "verification"]) {
    const input = new PassThrough();
    await Promise.all([
      decodeStoragePack(input, { projectRef: syntheticProjectRef, runId: id, component, maxObjects: 10, maxStorageBytes: 10000 }, async (object, bytes) => {
        assert.deepEqual(bytes, syntheticPng); files.set(`${object.bucket_id}/${object.name}`, bytes);
      }),
      storage.dump(snapshots[component], component, chunk => writeStream(input, chunk)).finally(() => input.end()),
    ]);
  }
  assert.equal(files.size, 3);
  await storage.check(true);
  await assert.rejects(resticClient({ ...env, RESTIC_PASSWORD: randomBytes(48).toString("base64url") }).verify(config.id));
  const before = (await storage.snapshots()).length;
  await assert.rejects(storage.backup("database", id, producer("broken")));
  assert.equal((await storage.snapshots()).length, before, "A failed producer must not leave a passing snapshot.");
  const result = { version: 1, source: "synthetic-local-only", status: "passed", separateMediaAndVerification: true, objectsRestored: files.size,
    repositoryIntegrity: "passed", wrongPasswordDenied: true, failedProducerRejected: true, elapsedSeconds: Math.ceil((Date.now() - start) / 1000),
    databaseRestoreTested: false, hostedStorageApiRestoreTested: false, productionTouched: false };
  await writeFile(path.join(directory, "evidence.json"), `${JSON.stringify(result)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(result));
} catch { console.error("Synthetic encrypted Storage restore drill failed; private diagnostics withheld. No hosted resource was targeted."); process.exitCode = 1; }
