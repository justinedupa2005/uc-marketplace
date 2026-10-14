// These helpers have no database, environment, or network side effects.
// Inventory/preflight SQL is not an assertion suite. messaging_security.sql
// additionally requires the staged Supabase Realtime publication configuration;
// verify it on the actual target instead of fabricating it in the SQL bootstrap.
export const DEFAULT_DATABASE_CHECKS = Object.freeze([
  "authorization_hardening_security.sql",
  "marketplace_authorization_security.sql",
  "marketplace_authorization_rls_smoke.sql",
  "listing_creation_security.sql",
  "listing_management_security.sql",
  "listing_management_rls_smoke.sql",
  "marketplace_browse_performance.sql",
  "favorites_security.sql",
  "favorites_rls_smoke.sql",
  "messaging_rls_smoke.sql",
  "reservation_meetup_security.sql",
  "reservation_meetup_rls_smoke.sql",
  "notifications_security.sql",
  "notifications_rls_smoke.sql",
  "reporting_moderation_security.sql",
  "reporting_moderation_rls_smoke.sql",
  "profile_security.sql",
  "profile_rls_smoke.sql",
  "end_to_end_workflow.sql",
  "release_security.sql",
  "storage_lifecycle_security.sql",
  "storage_lifecycle_rls_smoke.sql",
]);

// Exact tracked assertion labels, never labels supplied by a database response.
export const MESSAGING_GATE_SCENARIOS = Object.freeze([
  "anonymous user cannot read conversations",
  "anonymous user cannot read messages",
  "anonymous user cannot read conversation summaries",
  "available conversation creation is idempotent",
  "send derives sender trims body and starts unread",
  "database rejects a whitespace-only message",
  "database rejects a message over two thousand characters",
  "buyer summary exposes only its thread aggregate",
  "sold thread is reusable and removed thread is not reopened",
  "sold listing rejects a new conversation",
  "removed listing rejects reopening an existing conversation",
  "removed listing makes its conversation read-only",
  "sold and removed summaries preserve safe history context",
  "authenticated users cannot forge message senders",
  "authenticated users cannot forge conversation participants",
  "authenticated users cannot edit message content",
  "authenticated users cannot set read timestamps directly",
  "authenticated users cannot delete messages",
  "seller cannot start a conversation with self",
  "recipient summary counts only incoming unread messages",
  "recipient mark-read updates one incoming message",
  "mark-read stores a timestamp and is idempotent",
  "sender cannot mark their own new message through recipient logic",
  "suspended other participant remains a safe summary fallback",
  "active participant cannot message a suspended participant",
  "buyer sees the seller reply as newest and unread",
  "buyer mark-read updates only the seller reply",
  "both received messages have recipient read timestamps",
  "unrelated student cannot read conversations messages or summaries",
  "unrelated student cannot send into another conversation",
  "unrelated student cannot mark another conversation read",
  "active buyer cannot start a thread with a suspended seller",
  "pending student cannot start a conversation",
  "suspended participant cannot read messaging rows or summaries",
  "suspended participant cannot send messages",
  "suspended participant cannot mark messages read",
]);

const safeSqlstate = (value) => typeof value === "string" && /^[0-9A-Z]{5}$/.test(value) ? value : "unknown";
const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 100_000;
const safeStatementIndex = (value) => safeCount(value) && value > 0 ? value : "unknown";

/** Safe SQL failure metadata only; do not retain raw errors or their causes. */
export class DatabaseStatementError extends Error {
  constructor(error, statementIndex) {
    const code = safeSqlstate(error?.code);
    const index = safeStatementIndex(statementIndex);
    super(`SQL statement ${index} failed (SQLSTATE ${code}).`);
    this.name = "DatabaseStatementError";
    this.code = code;
    this.statementIndex = index;
  }
}

/** Flatten aggregate failures without ever exporting observed values or rows. */
export function formatDatabaseCheckDiagnostics(error, { summary = null, allowedScenarios = [] } = {}) {
  const allowed = new Set(allowedScenarios);
  const failedNames = new Set();
  let unnamed = 0;
  let declaredFailures = 0;
  const addFailure = (row) => {
    const name = row?.scenario ?? row?.check_name;
    if (typeof name === "string") failedNames.add(name);
    else unnamed += 1;
  };
  const failures = Array.isArray(summary?.failures) ? summary.failures : [];
  for (const row of failures) {
    if (row?.tests_run !== undefined || String(row?.scenario ?? row?.check_name ?? "").startsWith("__")) {
      const run = Number(row.tests_run);
      const passed = Number(row.tests_passed);
      if (safeCount(run) && safeCount(passed) && passed <= run) declaredFailures = Math.max(declaredFailures, run - passed);
      if (Array.isArray(row.failures)) row.failures.forEach(addFailure);
    } else addFailure(row);
  }
  const names = [...failedNames].filter((name) => allowed.has(name));
  const failed = Math.max(failedNames.size + unnamed, declaredFailures);
  const failedCount = safeCount(failed) && (failed > 0 || failures.length === 0) ? failed : "unknown";
  return `SQLSTATE=${safeSqlstate(error?.code)}; statement=${safeStatementIndex(error?.statementIndex ?? summary?.statementIndex)}; checks=${safeCount(summary?.count) ? summary.count : "unknown"}; failed=${failedCount}; scenarios=${JSON.stringify(names)}`;
}

// Split top-level statements, not semicolons inside strings, quoted names,
// nested comments, or dollar-quoted functions. Executing each separately keeps
// statement_timestamp() semantics faithful to separate PostgREST requests.
export function splitSqlStatements(source) {
  const statements = [];
  let start = 0;
  let quote = null;
  let escapeString = false;
  let lineComment = false;
  let blockDepth = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockDepth) {
      if (character === "/" && next === "*") { blockDepth++; index++; }
      else if (character === "*" && next === "/") { blockDepth--; index++; }
      continue;
    }
    if (quote) {
      if (quote.startsWith("$")) {
        if (source.startsWith(quote, index)) { index += quote.length - 1; quote = null; }
      } else if (character === quote) {
        if (next === quote) index++;
        else quote = null;
      } else if (escapeString && character === "\\") index++;
      continue;
    }
    if (character === "-" && next === "-") { lineComment = true; index++; continue; }
    if (character === "/" && next === "*") { blockDepth = 1; index++; continue; }
    if (character === "'" || character === '"') {
      quote = character;
      escapeString = character === "'" && /(?:^|[^A-Za-z0-9_$])[Ee]$/.test(source.slice(0, index));
      continue;
    }
    if (character === "$" && !/[A-Za-z0-9_$]/.test(source[index - 1] ?? "")) {
      const match = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) { quote = match[0]; index += quote.length - 1; continue; }
    }
    if (character === ";") { statements.push(source.slice(start, index + 1)); start = index + 1; }
  }
  if (quote || blockDepth) throw new Error("Unterminated SQL string, identifier, or block comment.");
  if (source.slice(start).trim()) statements.push(source.slice(start));
  return statements;
}

export function summarizeDatabaseChecks(results, { includeStatementIndex = false } = {}) {
  const rows = results.flatMap((result) => result.rows ?? []);
  const checks = rows.map((row) => ({ ...row, passed: row.passed ?? row.all_passed }))
    .filter((row) => typeof row.passed === "boolean");
  const individual = checks.filter((row) => !String(row.scenario ?? row.check_name ?? "").startsWith("__"));
  const summary = checks.find((row) => row.tests_run !== undefined);
  const count = summary ? Number(summary.tests_run) : individual.length;
  // An empty or malformed result must not silently count as a passing suite.
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("SQL check file produced no named assertions.");
  const result = { count, failures: checks.filter((row) => !row.passed) };
  if (includeStatementIndex) {
    const assertionResult = results.find((entry) => entry.rows?.some((row) => row.tests_run !== undefined && typeof row.all_passed === "boolean"))
      ?? results.find((entry) => entry.rows?.some((row) => row.passed === false));
    result.statementIndex = safeStatementIndex(assertionResult?.statementIndex);
  }
  return result;
}

export function validateDatabaseCheckNames(names, availableNames) {
  for (const name of names) {
    if (!/^[a-z][a-z0-9_]*\.sql$/.test(name) || !availableNames.includes(name)) {
      throw new Error(`Unknown SQL check file: ${name}. Use a basename from supabase/checks.`);
    }
  }
  return [...new Set(names)];
}

export async function executeSqlScript(database, source) {
  const results = [];
  for (const [index, statement] of splitSqlStatements(source).entries()) {
    try { results.push(...(await database.exec(statement)).map((result) => ({ ...result, statementIndex: index + 1 }))); }
    catch (error) { throw new DatabaseStatementError(error, index + 1); }
  }
  return results;
}
