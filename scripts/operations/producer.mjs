import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { connect, dumpDatabase, importSnapshot, inventorySql } from "./database.mjs";
import { validateBackupPolicy, validateObject, registry, runId } from "./policy.mjs";
import { boundedBody, inventoryDigest, storagePack, writeStream } from "./storage.mjs";

// Private stdout is consumed only by restic, never inherited by the terminal.
try {
  const env = process.env, selected = validateBackupPolicy(env);
  assert.match(env.OPS_RUN_ID ?? "", runId);
  const [component] = process.argv.slice(2);
  assert.equal(process.argv.length, 3);
  if (component === "database") await dumpDatabase(env, chunk => writeStream(process.stdout, chunk));
  else if (["media", "verification"].includes(component)) {
    const { client } = await connect(env), { client: current } = await connect(env);
    try {
      await importSnapshot(client, env.OPS_EXPORTED_SNAPSHOT);
      const objects = (await client.query(inventorySql)).rows;
      assert.ok(objects.length <= selected.maxObjects);
      const total = objects.reduce((size, object) => size + validateObject(object).size, 0);
      assert.ok(total <= selected.maxStorageBytes);
      const before = inventoryDigest(objects);
      assert.equal(inventoryDigest((await current.query(inventorySql)).rows), before, "Concurrent Storage changes require a fresh backup.");
      const download = async object => {
        const path = object.name.split("/").map(encodeURIComponent).join("/");
        const response = await fetch(`https://${registry.staging.supabaseProjectRef}.supabase.co/storage/v1/object/authenticated/${object.bucket_id}/${path}`, {
          redirect: "error", signal: AbortSignal.timeout(60000),
          headers: { apikey: env.OPS_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.OPS_SERVICE_ROLE_KEY}` },
        });
        const data = await boundedBody(response, object.size);
        assert.equal(data.length, object.size);
        return data;
      };
      for await (const line of storagePack({ projectRef: registry.staging.supabaseProjectRef, id: env.OPS_RUN_ID, component, objects, download })) await writeStream(process.stdout, line);
      assert.equal(inventoryDigest((await current.query(inventorySql)).rows), before, "Storage changed during capture.");
      await client.query("rollback");
    } finally { await client.end(); await current.end(); }
  } else if (component === "bundle") {
    const manifest = JSON.parse(env.OPS_BUNDLE_MANIFEST);
    assert.equal(manifest.runId, env.OPS_RUN_ID);
    assert.equal(manifest.projectRef, registry.staging.supabaseProjectRef);
    assert.equal(manifest.inventorySha256.length, createHash("sha256").digest("hex").length);
    await writeStream(process.stdout, JSON.stringify(manifest));
  } else throw new Error();
} catch { process.stderr.write("Backup producer failed; private details withheld.\n"); process.exitCode = 1; }
