import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_DATABASE_CHECKS, splitSqlStatements } from "../scripts/qa/lib/database-harness.mjs";
import {
  LOCAL_QUALITY_GATES, NATIVE_CATALOG_CHECKS, parseEmbeddedDbResult, parseUnitResult,
} from "../scripts/qa/lib/quality-gates.mjs";

const tap = ({ tests = 3, pass = 3, fail = 0, cancelled = 0, skipped = 0 } = {}) =>
  `TAP version 13\n1..${tests}\n# tests ${tests}\n# suites 1\n# pass ${pass}\n# fail ${fail}\n# cancelled ${cancelled}\n# skipped ${skipped}\n# todo 0\n# duration_ms 12.345\n`;

test("local quality gates are frozen repository-owned Node arguments without execution overrides", () => {
  assert.equal(Object.isFrozen(LOCAL_QUALITY_GATES), true);
  assert.deepEqual(LOCAL_QUALITY_GATES.map(({ id }) => id), ["typegen", "typecheck", "lint", "unit", "database", "source"]);
  assert.deepEqual(LOCAL_QUALITY_GATES.map(({ args }) => args), [
    ["node_modules/next/dist/bin/next", "typegen"],
    ["node_modules/typescript/bin/tsc", "--noEmit"],
    ["node_modules/eslint/bin/eslint.js"],
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--test", "--experimental-strip-types", "tests/*.test.mjs"],
    ["scripts/qa/database.mjs"],
    ["scripts/qa/security-hygiene.mjs"],
  ]);
  for (const gate of LOCAL_QUALITY_GATES) {
    assert.equal(Object.isFrozen(gate), true);
    assert.equal(Object.isFrozen(gate.args), true);
    assert.deepEqual(Object.keys(gate), ["id", "label", "args", "timeoutMs"]);
    assert.match(gate.label, /^[A-Za-z ]+$/);
    assert.ok(gate.timeoutMs >= 120_000 && gate.timeoutMs <= 180_000);
    assert.throws(() => { gate.args.push("--require=untrusted.js"); }, TypeError);
    assert.throws(() => { gate.cwd = "outside-workspace"; }, TypeError);
  }
});

test("unit summary returns only terminal TAP passing counts and drops private output", () => {
  const privateOutput = "password=Qa-secret-19!\nhttps://private.invalid/token?credential=secret\n";
  const result = parseUnitResult(privateOutput + tap());
  assert.deepEqual(result, { tests: 3, passed: 3 });
  assert.deepEqual(parseUnitResult(tap().replaceAll("\n", "\r\n")), result);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.deepEqual(Object.keys(result), ["tests", "passed"]);
});

test("unit summary refuses empty, incomplete, failing, cancelled, skipped and malformed evidence", () => {
  for (const output of [
    undefined, null, {}, "", "# tests 3\n# pass 3\n",
    tap({ tests: 0, pass: 0 }), tap({ pass: 2, fail: 1 }), tap({ pass: 2, cancelled: 1 }),
    tap({ pass: 2, skipped: 1 }), tap({ pass: 4 }), tap({ fail: 1 }), tap({ cancelled: 1 }), tap({ skipped: 1 }),
    tap().replace("# tests 3", " # tests 3"), tap().replace("# pass 3", "# pass 03"),
    tap().replace("# fail 0", "# fail unknown"), tap().replace("# cancelled 0", "# cancelled -1"),
    tap().replace("# skipped 0", "# skipped 0 secret"), tap().replace("# tests 3", "# tests 9007199254740992"),
    tap() + "# pass 3\n", tap() + tap(), tap().replace("# tests 3", "# pass 3").replace("# pass 3\n# fail", "# tests 3\n# fail"),
  ]) assert.equal(parseUnitResult(output), null);
});

test("embedded summary returns only positive passing migration and assertion counts", () => {
  const result = parseEmbeddedDbResult("private database response=secret\nEmbedded SQL result: 18 migrations, 535 individual checks, 0 failed.\nLimits: emulated Supabase auth/storage SQL.\n");
  assert.deepEqual(result, { migrations: 18, assertions: 535 });
  assert.deepEqual(parseEmbeddedDbResult("Embedded SQL result: 19 migrations, 540 individual checks, 0 failed.\r\n"), { migrations: 19, assertions: 540 });
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.deepEqual(Object.keys(result), ["migrations", "assertions"]);
});

test("embedded summary refuses failed, empty, repeated or malformed database evidence", () => {
  const passing = "Embedded SQL result: 18 migrations, 535 individual checks, 0 failed.";
  for (const output of [
    undefined, null, {}, "", "SQL scripts passed", passing.replace("0 failed", "1 failed"),
    passing.replace("18 migrations", "0 migrations"), passing.replace("535 individual", "0 individual"),
    passing.replace("18 migrations", "018 migrations"), passing.replace("535 individual", "-535 individual"),
    passing.replace("535 individual", "9007199254740992 individual"), passing.slice(0, -1),
    `${passing} secret`, ` ${passing}`, `${passing}\n${passing}`, `${passing}\nEmbedded SQL result: malformed`,
  ]) assert.equal(parseEmbeddedDbResult(output), null);
});

test("native catalog plan contains only frozen tracked read-only security assertions", async () => {
  assert.equal(Object.isFrozen(NATIVE_CATALOG_CHECKS), true);
  assert.deepEqual(NATIVE_CATALOG_CHECKS, [
    ...DEFAULT_DATABASE_CHECKS.filter((name) => name.endsWith("_security.sql")), "messaging_security.sql",
  ]);
  assert.equal(new Set(NATIVE_CATALOG_CHECKS).size, NATIVE_CATALOG_CHECKS.length);
  for (const name of NATIVE_CATALOG_CHECKS) {
    assert.match(name, /^[a-z][a-z0-9_]*_security\.sql$/);
    const sql = await readFile(new URL(`../supabase/checks/${name}`, import.meta.url), "utf8");
    for (const statement of splitSqlStatements(sql)) {
      // Catalog checks can inspect definitions containing mutation words; those
      // definitions are strings, not commands executed by this assertion SQL.
      const executable = statement.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/'(?:''|[^'])*'/g, " ").trim();
      if (!executable) continue;
      assert.match(executable, /^(?:with|select)\b/i, name);
      assert.doesNotMatch(executable, /\b(?:insert|update|delete|merge|create|drop|alter|grant|revoke|truncate|call|do|set|reset|commit|rollback)\b/i, name);
    }
  }
});
