import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const consumer = createRequire(require.resolve("@typescript-eslint/typescript-estree"));
const root = fileURLToPath(new URL("../", import.meta.url));

test("the reviewed minimatch patch is isolated to the exact named-export consumer", () => {
  const project = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(project.overrides, { "@typescript-eslint/typescript-estree@8.68.0": { minimatch: "11.0.4" } });
  assert.equal(consumer("minimatch/package.json").version, "11.0.4");
  const { minimatch } = consumer("minimatch");
  for (const [filename, pattern, expected] of [["fixture.ts", "*.ts", true], [".fixture.ts", "*.ts", true],
    ["nested/fixture.ts", "*.ts", false], ["fixture.js", "*.ts", false]]) {
    assert.equal(minimatch(filename, pattern, { dot: true }), expected);
  }
  // Old ESLint consumers still need the callable v3 export; do not override it.
  assert.equal(require("minimatch/package.json").version, "3.1.5");
  assert.equal(typeof require("minimatch"), "function");
});

test("the real TypeScript project-service default-project path works with the patched matcher", () => {
  const parser = consumer("@typescript-eslint/typescript-estree");
  try {
    const result = parser.parseAndGenerateServices("export const answer = 42;", {
      filePath: fileURLToPath(new URL("../dependency-security-fixture.js", import.meta.url)),
      tsconfigRootDir: root,
      projectService: { allowDefaultProject: ["dependency-security-fixture.js"] },
    });
    assert.equal(result.ast.type, "Program");
    assert.ok(result.services.program);
  } finally { parser.clearCaches(); }
});

test("the lockfile has no remaining minimatch version in the affected advisory range", () => {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const entries = Object.entries(lock.packages).filter(([name]) => /(?:^|\/)node_modules\/minimatch$/.test(name));
  assert.ok(entries.length > 0);
  for (const [, item] of entries) {
    const [major, minor, patch] = item.version.split(".").map(Number);
    assert.ok(major < 7 || major > 11 || major === 11 && (minor > 0 || patch >= 1), item.version);
  }
});
