import { DEFAULT_DATABASE_CHECKS } from "./database-harness.mjs";

// Fixed repository-owned Node entrypoints only. The runner supplies its own
// process.execPath and cwd; callers cannot inject a shell, executable, or env.
const gate = (id, label, args, timeoutMs) => Object.freeze({
  id, label, args: Object.freeze(args), timeoutMs,
});

export const LOCAL_QUALITY_GATES = Object.freeze([
  gate("typegen", "Route type generation", ["node_modules/next/dist/bin/next", "typegen"], 120_000),
  gate("typecheck", "TypeScript validation", ["node_modules/typescript/bin/tsc", "--noEmit"], 120_000),
  // Full-source lint can exceed two minutes on Windows/OneDrive cold reads.
  // Keep every rule/file enabled and use the same bounded three-minute budget
  // as the regression/database gates instead of treating slow I/O as a failure.
  gate("lint", "ESLint validation", ["node_modules/eslint/bin/eslint.js"], 180_000),
  gate("unit", "Regression tests", [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--test", "--experimental-strip-types", "tests/*.test.mjs",
  ], 180_000),
  gate("database", "Embedded database assertions", ["scripts/qa/database.mjs"], 180_000),
  gate("source", "Source security checks", ["scripts/qa/security-hygiene.mjs"], 120_000),
]);

// These are catalog inspection assertions, not data-mutating workflow scripts.
// messaging_security.sql must run only after the owned stack's staged Realtime
// publication has been enabled by the already-passing messaging SQL gate.
export const NATIVE_CATALOG_CHECKS = Object.freeze([
  ...DEFAULT_DATABASE_CHECKS.filter((name) => name.endsWith("_security.sql")),
  "messaging_security.sql",
]);

const safeCount = (value) => Number.isSafeInteger(value) && value >= 0;

/** Accept only one passing terminal TAP count block; never return raw output. */
export function parseUnitResult(stdout) {
  if (typeof stdout !== "string") return null;
  const lines = stdout.replaceAll("\r\n", "\n").split("\n");
  const names = ["tests", "pass", "fail", "cancelled", "skipped"];
  const counts = {};
  let previousIndex = -1;
  for (const name of names) {
    const header = new RegExp(`^# ${name}(?:\\s|$)`);
    const candidates = lines.flatMap((line, index) => header.test(line) ? [{ line, index }] : []);
    if (candidates.length !== 1 || candidates[0].index <= previousIndex) return null;
    const match = new RegExp(`^# ${name} (0|[1-9][0-9]*)$`).exec(candidates[0].line);
    if (!match) return null;
    const count = Number(match[1]);
    if (!safeCount(count)) return null;
    counts[name] = count;
    previousIndex = candidates[0].index;
  }
  if (counts.tests < 1 || counts.pass !== counts.tests || counts.fail || counts.cancelled || counts.skipped) return null;
  return { tests: counts.tests, passed: counts.pass };
}

/** Accept only the exact embedded runner summary with positive passing counts. */
export function parseEmbeddedDbResult(stdout) {
  if (typeof stdout !== "string") return null;
  const candidates = stdout.replaceAll("\r\n", "\n").split("\n")
    .filter((line) => line.startsWith("Embedded SQL result:"));
  if (candidates.length !== 1) return null;
  const match = /^Embedded SQL result: ([1-9][0-9]*) migrations, ([1-9][0-9]*) individual checks, 0 failed\.$/.exec(candidates[0]);
  if (!match) return null;
  const migrations = Number(match[1]);
  const assertions = Number(match[2]);
  if (!safeCount(migrations) || !safeCount(assertions)) return null;
  return { migrations, assertions };
}
