const sourceFiles = new Set(["anonymous.spec.ts", "authenticated.spec.ts", "recovery.spec.ts"]);

function invalidBrowserAcceptance() {
  // Never interpolate a report value: titles and extra fields may carry secrets.
  return new Error("QA browser acceptance requires completed, nonempty, passing anonymous, authenticated, and recovery suites.");
}

/** Validate sanitized browser evidence and export counts only, never test metadata. */
export function parseBrowserAcceptance(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)
    || report.version !== 1 || report.status !== "passed"
    || report.runnerErrors !== 0 || report.unexpectedRuntimeSignals !== 0
    || !Array.isArray(report.tests) || report.tests.length < 1 || report.tests.length > 100_000) {
    throw invalidBrowserAcceptance();
  }

  const seenTests = new Set();
  const seenFiles = new Set();
  let anonymousTests = 0;
  let authenticatedTests = 0;
  for (const test of report.tests) {
    if (!test || typeof test !== "object" || Array.isArray(test)
      || !sourceFiles.has(test.file) || !Number.isSafeInteger(test.line) || test.line < 1
      || typeof test.title !== "string" || !test.title.length || test.title.length > 10_000
      || test.status !== "passed" || test.expectedStatus !== "passed") {
      throw invalidBrowserAcceptance();
    }
    const identity = JSON.stringify([test.file, test.line, test.title]);
    if (seenTests.has(identity)) throw invalidBrowserAcceptance();
    seenTests.add(identity);
    seenFiles.add(test.file);
    if (test.file === "anonymous.spec.ts") anonymousTests += 1;
    else authenticatedTests += 1;
  }
  if (seenFiles.size !== sourceFiles.size) throw invalidBrowserAcceptance();
  return { anonymousTests, authenticatedTests, totalTests: anonymousTests + authenticatedTests };
}
