import assert from "node:assert/strict";
import test from "node:test";
import {
  splitSqlStatements, summarizeDatabaseChecks, validateDatabaseCheckNames, executeSqlScript,
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
