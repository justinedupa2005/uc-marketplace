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

export function summarizeDatabaseChecks(results) {
  const rows = results.flatMap((result) => result.rows ?? []);
  const checks = rows.map((row) => ({ ...row, passed: row.passed ?? row.all_passed }))
    .filter((row) => typeof row.passed === "boolean");
  const individual = checks.filter((row) => !String(row.scenario ?? row.check_name ?? "").startsWith("__"));
  const summary = checks.find((row) => row.tests_run !== undefined);
  const count = summary ? Number(summary.tests_run) : individual.length;
  // An empty or malformed result must not silently count as a passing suite.
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("SQL check file produced no named assertions.");
  return { count, failures: checks.filter((row) => !row.passed) };
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
    try { results.push(...await database.exec(statement)); }
    catch (error) {
      error.message = `Statement ${index + 1}: ${error.message}`;
      throw error;
    }
  }
  return results;
}
