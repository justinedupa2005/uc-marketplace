import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, realpath, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LOCAL_QUALITY_GATES } from "../scripts/qa/lib/quality-gates.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("every typecheck entrypoint generates installed Next route types before tsc", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.typecheck, "next typegen && tsc --noEmit");
  assert.deepEqual(LOCAL_QUALITY_GATES.slice(0, 2).map(({ id }) => id), ["typegen", "typecheck"]);
  const workflow = await readFile(new URL("../.github/workflows/security-qa.yml", import.meta.url), "utf8");
  assert.match(workflow, /run: npm run typecheck/);
  assert.doesNotMatch(workflow, /ignoreBuildErrors|continue-on-error|pull_request_target/);
  for (const [, name] of workflow.matchAll(/run: npm run ([a-z0-9:-]+)/g)) {
    assert.equal(typeof pkg.scripts[name], "string", "Every CI command must reference a defined lockfile-project script.");
  }
});

test("a real clean checkout reproduction fails before generation and passes next typegen plus tsc", { timeout: 120_000 }, async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "uc-marketplace-clean-types-"));
  const nodeModules = path.join(root, "node_modules");
  try {
    await cp(path.join(root, "src"), path.join(fixture, "src"), { recursive: true });
    await cp(path.join(root, "scripts"), path.join(fixture, "scripts"), { recursive: true });
    await cp(path.join(root, "config"), path.join(fixture, "config"), { recursive: true });
    for (const name of ["package.json", "tsconfig.json", "next.config.ts"]) await cp(path.join(root, name), path.join(fixture, name));
    await mkdir(path.join(fixture, "tests"));
    await cp(path.join(root, "tests/e2e"), path.join(fixture, "tests/e2e"), { recursive: true });
    await symlink(nodeModules, path.join(fixture, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const env = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ucmarketplace_anonymous_ci",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100" };
    const options = { cwd: fixture, env, encoding: "utf8", timeout: 50_000, windowsHide: true, maxBuffer: 4_000_000 };
    const tsc = path.join(nodeModules, "typescript/bin/tsc");
    const before = spawnSync(process.execPath, [tsc, "--noEmit"], options);
    assert.notEqual(before.status, 0, "Fresh checkout must reproduce the missing generated route type.");
    assert.match(before.stdout, /Cannot find name 'LayoutProps'/);
    execFileSync(process.execPath, [path.join(nodeModules, "next/dist/bin/next"), "typegen"], { ...options, stdio: ["ignore", "pipe", "pipe"] });
    const after = spawnSync(process.execPath, [tsc, "--noEmit"], options);
    assert.equal(after.status, 0, "Generated Next types must make the real copied application compile from clean state.");
  } finally {
    // Remove only this freshly allocated fixture; a junction is unlinked, not
    // followed. Never remove or rename the shared workspace/build/dependencies.
    const absolute = await realpath(fixture);
    assert.ok(absolute.startsWith(`${await realpath(tmpdir())}${path.sep}uc-marketplace-clean-types-`));
    await unlink(path.join(fixture, "node_modules")).catch((error) => { if (error.code !== "ENOENT") throw error; });
    await rm(fixture, { recursive: true, force: true });
  }
});
