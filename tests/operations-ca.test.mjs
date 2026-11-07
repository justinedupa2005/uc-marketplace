import assert from "node:assert/strict";
import { test, after } from "node:test";
import { registerHooks } from "node:module";
import { mkdtemp, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { command } from "../scripts/operations/process.mjs";

const fixture = await mkdtemp(path.join(tmpdir(), "ucm-backup-ca-"));
const source = new URL("../scripts/operations/backup.mjs", import.meta.url);
const isolated = pathToFileURL(path.join(fixture, "scripts", "operations", "backup.mjs")).href;
const certificate = "Synthetic public CA certificate for filesystem tests only\n";
// Relocate the actual module's import.meta.url to an isolated temporary root.
// Only the public CA download is stubbed; filesystem operations remain real.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === source.href) return { url: isolated, shortCircuit: true };
    if (context.parentURL === isolated) {
      if (specifier === "../staging/tls.mjs") return {
        url: `data:text/javascript,${encodeURIComponent(`export async function getStagingCa() { return ${JSON.stringify(certificate)}; }`)}`,
        shortCircuit: true,
      };
      return next(specifier.startsWith(".") ? new URL(specifier, source).href : specifier, { ...context, parentURL: source.href });
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === isolated) return { format: "module", source: backupSource, shortCircuit: true };
    return next(url, context);
  },
});
const backupSource = await readFile(source, "utf8");
const { prepareCa } = await import(source.href);
after(async () => {
  hooks.deregister();
  assert.equal(path.dirname(fixture), path.resolve(tmpdir()));
  assert.ok(path.basename(fixture).startsWith("ucm-backup-ca-"));
  await rm(fixture, { recursive: true, force: true });
});

test("CA preparation preserves bytes and caller inputs and repairs an existing owner-only certificate", async () => {
  const directory = path.join(fixture, ".qa", "operations"), filename = path.join(directory, "provider-ca.crt");
  const env = Object.freeze({ OPS_ENV: "staging" });
  const configured = await prepareCa(env);
  assert.equal(configured.OPS_CA_FILE, filename);
  assert.equal(configured.OPS_ENV, "staging");
  assert.equal(env.OPS_CA_FILE, undefined);
  assert.equal(await readFile(filename, "utf8"), certificate);
  if (process.platform !== "win32") {
    assert.equal((await stat(filename)).mode & 0o777, 0o644);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
  }
  const privateFile = path.join(directory, "private-receipt.json");
  await writeFile(privateFile, "synthetic private fixture", { mode: 0o600 });
  await chmod(filename, 0o600);
  await writeFile(filename, "stale certificate");
  await prepareCa(env);
  assert.equal(await readFile(filename, "utf8"), certificate);
  assert.equal(await readFile(privateFile, "utf8"), "synthetic private fixture");
  if (process.platform !== "win32") {
    assert.equal((await stat(filename)).mode & 0o777, 0o644);
    assert.equal((await stat(privateFile)).mode & 0o777, 0o600);
  }
});

// Linux permissions are exercised by the Linux CI runner. Do not introduce a
// skipped result into the Windows QA suite, whose evidence rejects skips.
if (process.platform === "linux") test("the hardened Linux dump container can read a repaired CA bind mount but cannot overwrite it", {
  timeout: 180000,
}, async () => {
  const pins = JSON.parse(await readFile(new URL("../config/operations-tools.json", import.meta.url), "utf8"));
  const configured = await prepareCa({});
  const run = (script, extra = []) => command("docker", ["run", "--rm", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt", "no-new-privileges:true", ...extra,
    "--mount", `type=bind,source=${configured.OPS_CA_FILE},target=/provider-ca.crt,readonly`,
    "--entrypoint", "sh", pins.postgresImage, "-ec", script], { timeoutMs: 150000 });
  await chmod(configured.OPS_CA_FILE, 0o600);
  // Reproduce the old access failure with an identity different from the owner.
  const owner = (await stat(configured.OPS_CA_FILE)).uid;
  const other = owner === 65534 ? "65533:65533" : "65534:65534";
  await assert.rejects(run("cat /provider-ca.crt", ["--user", other]));
  await prepareCa({});
  assert.equal((await run("cat /provider-ca.crt")).toString(), certificate);
  assert.equal((await run("cat /provider-ca.crt", ["--user", other])).toString(), certificate);
  assert.equal((await run("awk '/^CapEff:/ {print $2}' /proc/self/status")).toString().trim(), "0000000000000000");
  await assert.rejects(run("printf overwritten > /provider-ca.crt"));
  assert.equal(await readFile(configured.OPS_CA_FILE, "utf8"), certificate);
});
