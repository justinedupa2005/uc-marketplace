import assert from "node:assert/strict";
import { storagePack, writeStream } from "./storage.mjs";
import { syntheticPng, syntheticProjectRef } from "./drill-fixtures.mjs";
import { runId } from "./policy.mjs";

try {
  const id = process.env.OPS_DRILL_ID;
  assert.match(id ?? "", runId); assert.equal(process.argv.length, 3);
  const component = process.argv[2];
  if (component === "broken") { process.stdout.write("synthetic incomplete stream"); process.exitCode = 7; }
  else {
    const objects = ["listing-images", "avatars", "student-verifications"].map(bucket_id => ({ bucket_id, name: `${id}/${id}/image.png`, owner_id: id,
      metadata: { size: syntheticPng.length, mimetype: "image/png" }, version: "synthetic", updated_at: "2026-10-29 00:00:00+00" }));
    for await (const line of storagePack({ projectRef: syntheticProjectRef, id, component, objects, download: async () => syntheticPng })) await writeStream(process.stdout, line);
  }
} catch { process.stderr.write("Synthetic file producer failed.\n"); process.exitCode = 1; }
