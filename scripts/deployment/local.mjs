import { readFile, writeFile, copyFile, mkdir, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { validateDeploymentEnvironment } from "../../src/lib/deployment-environment.ts";
import { resolveInstalledSupabaseBinary, launchQaProcess } from "../qa/lib/process.mjs";
import { resolveQaDockerBinary } from "../qa/lib/docker.mjs";
import { assertLocalDockerEndpoint } from "../qa/lib/local-stack.mjs";
import { isStrongRecoverySecret } from "../../src/lib/auth/recovery-secret.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
let phase = "configuration";
export function existingRecoverySecret(source) {
  const assignments = source.split(/\r?\n/).filter((line) => /^[ \t]*(?:export[ \t]+)?AUTH_RECOVERY_SECRET[ \t]*(?:=|:[ \t]+)/.test(line));
  if (!assignments.length) return null;
  const match = /^[ \t]*(?:export[ \t]+)?AUTH_RECOVERY_SECRET[ \t]*(?:=|:[ \t]+)[ \t]*(?:"([a-fA-F0-9]+)"|'([a-fA-F0-9]+)'|([a-fA-F0-9]+))[ \t]*(?:#.*)?$/.exec(assignments[0]);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  if (assignments.length !== 1 || !isStrongRecoverySecret(value)) throw new Error("Existing recovery configuration requires manual review; refusing implicit rotation.");
  return value;
}
export function renderLocalEnvironment(source, values) {
  if (validateDeploymentEnvironment(values).mode !== "local") throw new Error("Local configuration requires loopback-only settings.");
  const names = Object.keys(values);
  const marker = "# Local-only application configuration; generated once, never committed.";
  const retained = source.split(/\r?\n/).filter((line) => line !== marker && !names.some((name) => new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*(?:=|:[ \\t]+)`).test(line)));
  const prefix = retained.join("\n").trimEnd();
  return `${prefix ? `${prefix}\n\n` : ""}${marker}\n${names.map((name) => `${name}=${values[name]}`).join("\n")}\n`;
}

async function main() {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--start")) throw new Error();
  const filename = path.join(root, ".env.local");
  const ignored = spawnSync("git", ["check-ignore", "--quiet", "--no-index", ".env.local"], { cwd: root, windowsHide: true });
  if (ignored.status !== 0) throw new Error();
  const docker = resolveQaDockerBinary();
  if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) throw new Error("Explicit Docker overrides require separate review.");
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PATH"));
  const originalPath = process.env.PATH ?? process.env.Path ?? "";
  env.PATH = path.isAbsolute(docker) ? `${path.dirname(docker)}${path.delimiter}${originalPath}` : originalPath;
  // CLI local commands only; never link, push, reset, repair, or pass a remote URL.
  const cli = resolveInstalledSupabaseBinary(root);
  const run = (command, args) => launchQaProcess({ command, args, cwd: root, env, label: "Local environment setup",
    progressIntervalMs: 30_000, onProgress: () => console.log("Local development service setup is still running; private output withheld.") });
  const context = (await run(docker, ["context", "show"]).wait()).trim();
  const endpoint = JSON.parse(await run(docker, ["context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"] ).wait());
  assertLocalDockerEndpoint(endpoint);
  phase = "local service startup";
  if (process.argv[2] === "--start") await run(cli, ["start", "--exclude", "studio,postgres-meta,edge-runtime,logflare,vector", "--agent", "no", "--log-level", "error"]).wait({ timeoutMs: 300_000 });
  phase = "local status";
  const status = JSON.parse(await run(cli, ["status", "--output", "json"]).wait());
  if (new URL(status.API_URL).origin !== "http://127.0.0.1:54321") throw new Error();
  let before = "";
  try {
    const file = await lstat(filename);
    if (!file.isFile() || file.isSymbolicLink()) throw new Error();
    before = await readFile(filename, "utf8");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const existing = existingRecoverySecret(before);
  const values = { APP_ENV: "local", NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    NEXT_PUBLIC_APP_URL: "http://localhost:3000", AUTH_RECOVERY_SECRET: existing ?? randomBytes(32).toString("hex"), EMAIL_CONFIRMATION_MODE: "code" };
  const updated = renderLocalEnvironment(before, values);
  phase = "local configuration write";
  if (before) {
    await mkdir(path.join(root, ".qa"), { recursive: true });
    // Recoverable copy inside the already-ignored operator directory; never log
    // contents, and never replace a previous backup.
    try { await copyFile(filename, path.join(root, ".qa/local-env-before-step5.backup"), 1); } catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  await writeFile(filename, updated, { encoding: "utf8", mode: 0o600 });
  console.log("Local .env.local now uses only loopback Supabase, localhost:3000 and a persistent local recovery secret. Previous configuration retained in the ignored scoped backup; no hosted database changed.");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(`Local environment setup failed during ${phase} (${error?.name === "QaProcessError" ? error.reason : "configuration"}); private status/credentials withheld. No hosted fallback/reset attempted.`); process.exitCode = 1; }
}
