import assert from "node:assert/strict";
import { command, controlledEnvironment } from "./process.mjs";
import { components, runId, snapshotId } from "./policy.mjs";

export function resticClient(env, execute = command) {
  const childEnv = controlledEnvironment(env);
  const run = (args, options = {}) => execute(env.OPS_RESTIC_BINARY || "restic", ["--no-cache", ...args], { env: childEnv, ...options });
  return {
    async verify(expectedId) {
      const version = (await run(["version"])).toString();
      assert.match(version, /^restic 0\.19\.1\b/, "Install the reviewed restic version.");
      const config = JSON.parse((await run(["cat", "config"])).toString());
      assert.equal(config.id, expectedId, "Repository identity changed.");
      assert.equal(config.version, 2);
    },
    async backup(component, id, producer) {
      assert.ok(components.includes(component)); assert.match(id, runId);
      // restic propagates the producer's nonzero exit instead of accepting a
      // truncated pg_dump/Storage stream as a successful snapshot.
      const result = await run(["backup", "--json", "--quiet", "--host", "uc-marketplace-staging", "--tag", "ucm:staging",
        "--tag", `run:${id}`, "--tag", `component:${component}`, "--stdin-filename", `${component}.backup`, "--stdin-from-command", "--", ...producer]);
      const summary = result.toString().trim().split(/\r?\n/).map(line => JSON.parse(line)).findLast(row => row.message_type === "summary");
      assert.match(summary?.snapshot_id ?? "", snapshotId, "A complete restic snapshot is required.");
      return summary.snapshot_id;
    },
    async snapshots() { return JSON.parse((await run(["snapshots", "--json", "--host", "uc-marketplace-staging", "--tag", "ucm:staging"])).toString()); },
    async check(full = false) { await run(["check", ...(full ? ["--read-data"] : [])], { timeoutMs: 1800000 }); },
    async dump(id, component, output) {
      assert.match(id, snapshotId); assert.ok(components.includes(component));
      return run(["dump", id, `/${component}.backup`], { output });
    },
    async forget(ids, apply = false) {
      assert.ok(ids.length > 0); ids.forEach(id => assert.match(id, snapshotId));
      // Exact IDs only. Duration-based keep-within is relative to the newest
      // snapshot and can otherwise preserve stale ID photographs indefinitely.
      await run(["forget", ...ids, ...(apply ? ["--prune"] : ["--dry-run"])]);
    },
  };
}
