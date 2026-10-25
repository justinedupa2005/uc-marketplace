import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult, TestStep } from "@playwright/test/reporter";

// Locations come from the test sources, not SDK messages or locator arguments.
// A filename outside this fixed set must not become a diagnostic data channel.
const qaSourceFiles = new Set(["anonymous.spec.ts", "authenticated.spec.ts", "recovery.spec.ts", "qa-helpers.ts"]);

function qaSourceLocation(location?: { file: string; line: number }) {
  if (!location) return null;
  const file = path.posix.basename(path.win32.basename(location.file));
  if (!qaSourceFiles.has(file) || !Number.isInteger(location.line) || location.line < 1) return null;
  return { file, line: location.line };
}

function failedStepLocation(steps: TestStep[]) {
  let deepest: { file: string; line: number; indexPath: number[] } | null = null;
  const visit = (children: TestStep[], indexes: number[], inherited: ReturnType<typeof qaSourceLocation>) => {
    for (const [index, step] of children.entries()) {
      const indexPath = [...indexes, index];
      const location = qaSourceLocation(step.location) ?? inherited;
      if (step.error && location && (!deepest || indexPath.length >= deepest.indexPath.length)) {
        deepest = { ...location, indexPath };
      }
      visit(step.steps ?? [], indexPath, location);
    }
  };
  visit(steps, [], null);
  return deepest;
}

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
    failedStepLocation: failedStepLocation(result.steps),
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
  private activeTest: { file: string; line: number; title: string; startedAt: string } | null = null;
  private activeResult: TestResult | null = null;
  private activeSteps = new Map<TestStep, { index: number; file: string | null; line: number | null }>();
  private nextStepIndex = 0;

  constructor(options: { outputFile?: string; listOnly?: boolean } = {}) {
    this.outputFile = options.outputFile ?? "./node_modules/.cache/uc-qa-browser/report.json";
    this.listOnly = options.listOnly ?? process.argv.includes("--list");
  }

  onBegin(config: FullConfig, suite: Suite) {
    this.listOnly ||= config.argv.includes("--list");
    this.discoveredTests = suite.allTests().length;
    this.writeProgress("running");
  }

  onTestBegin(test: TestCase, result: TestResult) {
    if (this.listOnly) return;
    const location = qaSourceLocation(test.location);
    this.activeTest = {
      file: location?.file ?? "unknown",
      line: location?.line ?? 0,
      title: redactQaLabel(test.title),
      startedAt: result.startTime instanceof Date && Number.isFinite(result.startTime.getTime())
        ? result.startTime.toISOString() : new Date().toISOString(),
    };
    this.activeResult = result;
    this.activeSteps.clear();
    this.nextStepIndex = 0;
    this.writeProgress("running");
  }

  onStepBegin(_test: TestCase, result: TestResult, step: TestStep) {
    if (this.listOnly || result !== this.activeResult) return;
    const location = qaSourceLocation(step.location);
    this.activeSteps.set(step, { index: ++this.nextStepIndex, file: location?.file ?? null, line: location?.line ?? null });
    this.writeProgress("running");
  }

  onStepEnd(_test: TestCase, result: TestResult, step: TestStep) {
    if (this.listOnly || result !== this.activeResult) return;
    this.activeSteps.delete(step);
    this.writeProgress("running");
  }

  private writeProgress(status: "running" | FullResult["status"]) {
    if (this.listOnly) return;
    try {
      mkdirSync(path.dirname(this.outputFile), { recursive: true });
      writeFileSync(`${this.outputFile}.progress.json`, JSON.stringify({
        version: 1,
        status,
        discoveredTests: this.discoveredTests,
        tests: this.results,
        activeTest: this.activeTest,
        activeStep: Array.from(this.activeSteps.values()).at(-1) ?? null,
        runnerErrors: this.runnerErrors,
        suppressedOutputChunks: this.suppressedOutputChunks,
        unexpectedRuntimeSignals: this.unexpectedRuntimeSignals,
      }, null, 2));
    } catch {
      // Playwright swallows reporter exceptions. Explicitly fail the final gate,
      // without exposing filesystem errors that might contain private paths.
      this.runnerErrors += 1;
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (this.listOnly) return;
    const summary = qaResultSummary(test, result);
    this.results.push(summary);
    if (result === this.activeResult) {
      this.activeTest = null;
      this.activeResult = null;
      this.activeSteps.clear();
    }
    this.writeProgress("running");
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
    this.writeProgress("running");
  }

  // Never forward raw output: SDK diagnostics may include Auth payloads.
  // Suppression must not conceal unhandled server/worker exceptions either.
  onStdOut(chunk: string | Buffer) { this.inspectOutput(chunk); }
  onStdErr(chunk: string | Buffer) { this.inspectOutput(chunk); }
  onError() { this.runnerErrors += 1; this.writeProgress("running"); }

  async onEnd(result: FullResult) {
    if (this.listOnly) {
      process.stdout.write(`[QA] Discovered ${this.discoveredTests} tests; discovery only. No tests executed or acceptance evidence overwritten.\n`);
      return { status: result.status };
    }
    const incompleteExecution = !this.results.length
      || this.results.some((test) => test.status !== "passed" || test.expectedStatus !== "passed")
      || (this.discoveredTests > 0 && this.results.length !== this.discoveredTests);
    let status = result.status === "passed" && (this.unexpectedRuntimeSignals || this.runnerErrors || incompleteExecution) ? "failed" : result.status;
    this.activeTest = null;
    this.activeResult = null;
    this.activeSteps.clear();
    this.writeProgress(status);
    if (status === "passed" && this.runnerErrors) status = "failed";
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
