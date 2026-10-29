import assert from "node:assert/strict";
import { command } from "./process.mjs";
import { schemas } from "./database.mjs";
import { storagePack, writeStream } from "./storage.mjs";
import { runId } from "./policy.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { syntheticProjectRef, syntheticPng } from "./drill-fixtures.mjs";

export async function assertDrillContainer(env, requireRunning = true) {
  assert.match(env.OPS_DRILL_ID ?? "", runId);
  assert.equal(env.OPS_DRILL_CONTAINER, `ucm-restore-${env.OPS_DRILL_ID}`);
  const inspected = JSON.parse((await command("docker", ["inspect", env.OPS_DRILL_CONTAINER])).toString());
  assert.equal(inspected.length, 1);
  assert.equal(inspected[0].Config.Labels["ucmarketplace.restore-drill"], env.OPS_DRILL_ID);
  assert.equal(inspected[0].Name, `/${env.OPS_DRILL_CONTAINER}`);
  if (requireRunning) assert.equal(inspected[0].State.Running, true);
  return inspected[0];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const env = process.env;
    await assertDrillContainer(env);
    const [component] = process.argv.slice(2);
    if (component === "database") {
      await command("docker", ["exec", env.OPS_DRILL_CONTAINER, "pg_dump", "--username=postgres", "--dbname=postgres", "--format=custom",
        ...schemas.map(schema => `--schema=${schema}`)], { output: chunk => writeStream(process.stdout, chunk) });
    } else if (["media", "verification"].includes(component)) {
      const objects = JSON.parse(env.OPS_DRILL_OBJECTS);
      for await (const line of storagePack({ projectRef: syntheticProjectRef, id: env.OPS_DRILL_ID, component, objects, download: async () => syntheticPng })) await writeStream(process.stdout, line);
    } else if (component === "bundle") {
      const manifest = JSON.parse(env.OPS_DRILL_MANIFEST);
      assert.equal(manifest.projectRef, syntheticProjectRef); assert.equal(manifest.runId, env.OPS_DRILL_ID);
      await writeStream(process.stdout, JSON.stringify(manifest));
    } else throw new Error();
  } catch { process.stderr.write("Synthetic restore producer failed; no private diagnostics emitted.\n"); process.exitCode = 1; }
}
