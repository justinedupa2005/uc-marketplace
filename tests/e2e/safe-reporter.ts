import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";

/** Defense in depth for labels; raw diagnostics are never emitted at all. */
export function redactQaLabel(value: string, environment = process.env) {
  let label = value;
  for (const [name, secret] of Object.entries(environment)) {
    if (secret && /PASSWORD|SECRET|TOKEN|KEY|EMAIL|DATABASE_URL/.test(name)) {
      label = label.replaceAll(secret, "[redacted]");
    }
  }
  return label
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]")
    .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/Qa-[0-9a-f-]{36}-9!/gi, "[redacted-password]");
}

/**
 * Intentionally an allowlist, not an attempt to regex arbitrary diagnostics.
 * Playwright errors/steps may embed passwords supplied to fill(), including a
 * new password generated inside the worker and unknown to this process.
 */
export function qaResultSummary(test: TestCase, result: TestResult) {
  return {
    file: path.basename(test.location.file),
    line: test.location.line,
    title: redactQaLabel(test.title),
    status: result.status,
    expectedStatus: test.expectedStatus,
    durationMs: result.duration,
    failedStepIndexes: result.steps.flatMap((step, index) => step.error ? [index] : []),
  };
}

export default class SafeQaReporter implements Reporter {
  private outputFile: string;
  private results: ReturnType<typeof qaResultSummary>[] = [];
  private suppressedOutputChunks = 0;
  private runnerErrors = 0;
  private unexpectedRuntimeSignals = 0;
  private outputTail = "";
  private listOnly: boolean;
  private discoveredTests = 0;

  constructor(options: { outputFile?: string; listOnly?: boolean } = {}) {
    this.outputFile = options.outputFile ?? "./node_modules/.cache/uc-qa-browser/report.json";
    this.listOnly = options.listOnly ?? process.argv.includes("--list");
  }

  onBegin(config: FullConfig, suite: Suite) {
    this.listOnly ||= config.argv.includes("--list");
    this.discoveredTests = suite.allTests().length;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const summary = qaResultSummary(test, result);
    this.results.push(summary);
    process.stdout.write(`[QA] ${summary.status}: ${summary.title}\n`);
    if (result.status !== test.expectedStatus) {
      process.stdout.write("[QA] Failure diagnostics withheld to protect credentials; use the named test and step indexes for an isolated, credential-safe investigation.\n");
    }
  }

  private inspectOutput(chunk: string | Buffer) {
    this.suppressedOutputChunks += 1;
    const output = this.outputTail + String(chunk);
    if (/unhandled\s*rejection|uncaught\s*exception/i.test(output)) this.unexpectedRuntimeSignals += 1;
    this.outputTail = output.slice(-40);
  }

  // Never forward raw output: SDK diagnostics may include Auth payloads.
  // Suppression must not conceal unhandled server/worker exceptions either.
  onStdOut(chunk: string | Buffer) { this.inspectOutput(chunk); }
  onStdErr(chunk: string | Buffer) { this.inspectOutput(chunk); }
  onError() { this.runnerErrors += 1; }

  async onEnd(result: FullResult) {
    if (this.listOnly) {
      process.stdout.write(`[QA] Discovered ${this.discoveredTests} tests; discovery only. No tests executed or acceptance evidence overwritten.\n`);
      return { status: result.status };
    }
    const status = result.status === "passed" && (this.unexpectedRuntimeSignals || this.runnerErrors || !this.results.length) ? "failed" : result.status;
    mkdirSync(path.dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, JSON.stringify({
      version: 1,
      status,
      tests: this.results,
      runnerErrors: this.runnerErrors,
      suppressedOutputChunks: this.suppressedOutputChunks,
      unexpectedRuntimeSignals: this.unexpectedRuntimeSignals,
      diagnostics: "Raw errors, stacks, step call logs, attachments and worker output are intentionally omitted.",
    }, null, 2));
    process.stdout.write(`[QA] ${status}; ${this.results.length} tests; ${this.unexpectedRuntimeSignals} unhandled runtime signals. Sanitized summary saved; raw diagnostics omitted.\n`);
    return { status };
  }

  printsToStdio() { return true; }
}
