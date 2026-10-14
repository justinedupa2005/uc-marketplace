import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  splitSqlStatements, summarizeDatabaseChecks, validateDatabaseCheckNames, executeSqlScript,
  DatabaseStatementError, formatDatabaseCheckDiagnostics, MESSAGING_GATE_SCENARIOS,
} from "../scripts/qa/lib/database-harness.mjs";

test("SQL splitter preserves function bodies, quotes, and nested comments", () => {
  const source = `-- ;\nselect ';', "semi;colon", 'it''s; fine';
    /* ; /* nested ; */ comment */ do $body$ begin perform ';'; end $body$;
    select E'escaped\\\';quote'; select 4`;
  assert.equal(splitSqlStatements(source).length, 4);
  assert.match(splitSqlStatements(source)[1], /perform ';'/);
});

test("SQL splitter respects standard strings and trailing line comments", () => {
  assert.equal(splitSqlStatements("select 'path\\'; select 2; -- final comment").length, 3);
  assert.equal(splitSqlStatements("select '$$;'; select amount$column;").length, 2);
  assert.equal(splitSqlStatements("").length, 0);
});

test("SQL splitter refuses unterminated quoted bodies and comments", () => {
  for (const source of ["select 'oops", "do $tag$ begin", 'select "oops', "/* comment"]) {
    assert.throws(() => splitSqlStatements(source), /Unterminated SQL/);
  }
});

test("database result counts exclude summary rows and retain failed summaries", () => {
  assert.deepEqual(summarizeDatabaseChecks([{ rows: [
    { scenario: "ownership", passed: true }, { scenario: "privacy", passed: false },
    { scenario: "__all_passed__", all_passed: false, tests_run: 2 },
  ] }]), { count: 2, failures: [
    { scenario: "privacy", passed: false },
    { scenario: "__all_passed__", all_passed: false, tests_run: 2, passed: false },
  ] });
});

test("database result fails closed for empty or informational SQL", () => {
  assert.throws(() => summarizeDatabaseChecks([{ rows: [{ active_admin_count: 0 }] }]), /no named assertions/);
  assert.throws(() => summarizeDatabaseChecks([{ rows: [{ all_passed: true, tests_run: "NaN" }] }]), /no named assertions/);
});

test("database check names prohibit traversal, unknown files, and duplicates", () => {
  const available = ["profile_security.sql", "end_to_end_workflow.sql"];
  assert.deepEqual(validateDatabaseCheckNames([available[0], available[0]], available), [available[0]]);
  for (const name of ["../profile_security.sql", "C:\\secret.sql", "missing.sql", "--linked"]) {
    assert.throws(() => validateDatabaseCheckNames([name], available), /Unknown SQL check/);
  }
});

test("database runner sends statements separately to preserve timestamp boundaries", async () => {
  const calls = [];
  const database = { exec: async (statement) => { calls.push(statement); return [{ rows: [] }]; } };
  const results = await executeSqlScript(database, "select 1; select 2;");
  assert.equal(calls.length, 2);
  assert.equal(results.length, 2);
});

test("database statement errors expose SQLSTATE/index without retaining raw errors", async () => {
  const privateValue = "sensitive-value-not-for-diagnostics";
  const original = Object.freeze(Object.assign(new Error(privateValue), { code: "42501", query: privateValue, detail: privateValue, hint: privateValue, where: privateValue, cause: new Error(privateValue) }));
  let calls = 0;
  await assert.rejects(executeSqlScript({ exec: async () => { if (++calls === 2) throw original; return [{ rows: [] }]; } }, "select 1; select 'private-sql'; select 3;"), (error) => {
    assert.ok(error instanceof DatabaseStatementError);
    assert.equal(error.code, "42501");
    assert.equal(error.statementIndex, 2);
    assert.equal(error.cause, undefined);
    assert.equal(error.query, undefined);
    assert.doesNotMatch(`${error.message}\n${error.stack}\n${JSON.stringify(error)}`, /sensitive-value-not-for-diagnostics|private-sql/);
    return true;
  });
  assert.equal(calls, 2);
  assert.equal(original.message, privateValue);
});

test("database diagnostics reject malformed SQLSTATEs and preserve non-Error failure safety", async () => {
  for (const rejection of [null, "sensitive-value", { code: 42501, message: "sensitive-value" }, { code: "42501 sensitive-value" }, { code: "ENOTFOUND" }]) {
    await assert.rejects(executeSqlScript({ exec: async () => { throw rejection; } }, "select 1;"), (error) => {
      assert.equal(error.code, "unknown");
      assert.equal(error.statementIndex, 1);
      assert.doesNotMatch(error.message, /sensitive-value|ENOTFOUND/);
      return true;
    });
  }
  const diagnostic = formatDatabaseCheckDiagnostics({ code: "sensitive-value", statementIndex: "92 sensitive-value" });
  assert.equal(diagnostic, 'SQLSTATE=unknown; statement=unknown; checks=unknown; failed=0; scenarios=[]');
});

test("aggregate failures report exact allowlisted names/counts and no observed values", () => {
  const known = MESSAGING_GATE_SCENARIOS[0];
  const results = [{ statementIndex: 92, rows: [{ tests_run: "36", tests_passed: "34", all_passed: false, failures: [
    { scenario: known, observed: "sensitive-row-value" },
    { scenario: known, observed: "sensitive-duplicate-value" },
    { scenario: `${known} sensitive-injected-label`, observed: "sensitive-row-value" },
  ] }] }, { statementIndex: 93, rows: [] }];
  const summary = summarizeDatabaseChecks(results, { includeStatementIndex: true });
  assert.equal(summary.count, 36);
  assert.equal(summary.statementIndex, 92);
  const diagnostic = formatDatabaseCheckDiagnostics(null, { summary, allowedScenarios: MESSAGING_GATE_SCENARIOS });
  assert.equal(diagnostic, `SQLSTATE=unknown; statement=92; checks=36; failed=2; scenarios=${JSON.stringify([known])}`);
  assert.doesNotMatch(diagnostic, /sensitive-/);
  assert.equal(summarizeDatabaseChecks([{ rows: [{ tests_run: "36", tests_passed: "36", all_passed: true, failures: [] }] }]).failures.length, 0);
});

test("safe diagnostics do not double-count summary rows or expose unallowlisted labels", () => {
  const known = MESSAGING_GATE_SCENARIOS[0];
  const summary = { count: 3, failures: [{ scenario: known, passed: false, observed: "sensitive-value" },
    { scenario: "__all_checks__", tests_run: 3, tests_passed: 2, all_passed: false }] };
  assert.match(formatDatabaseCheckDiagnostics(null, { summary, allowedScenarios: MESSAGING_GATE_SCENARIOS }), /failed=1;/);
  assert.equal(formatDatabaseCheckDiagnostics(null, { summary }).includes(known), false);
  assert.equal(formatDatabaseCheckDiagnostics({ code: "42501", statementIndex: 92 }), 'SQLSTATE=42501; statement=92; checks=unknown; failed=0; scenarios=[]');
});

test("messaging diagnostic allowlist matches only tracked static assertion labels", async () => {
  const source = await readFile(new URL("../supabase/checks/messaging_rls_smoke.sql", import.meta.url), "utf8");
  const pattern = /step10_messaging_expect_rejected\(\s*'([^']+)'|insert into pg_temp\.step10_messaging_results\s+(?:values\s*\(\s*|select\s*)'([^']+)'/gi;
  const names = [...source.matchAll(pattern)].map((match) => match[1] ?? match[2]);
  assert.deepEqual([...new Set(names)].sort(), [...MESSAGING_GATE_SCENARIOS].sort());
  assert.equal(new Set(MESSAGING_GATE_SCENARIOS).size, MESSAGING_GATE_SCENARIOS.length);
});
