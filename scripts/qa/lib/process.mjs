import { spawn } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

export class QaProcessError extends Error {
  constructor(label, reason) {
    const details = {
      start: "could not start", timeout: "timed out", output: "exceeded its private output limit",
      runtime: "reported an unhandled runtime failure", stopped: "was stopped", exit: "failed",
      cleanup: "could not stop its owned process tree", progress: "could not report safe progress",
    };
    super(`${label} ${details[reason] ?? "failed"}. Private process output was withheld.`);
    this.name = "QaProcessError";
    this.reason = reason;
  }
}

function validDuration(value, { allowZero = false } = {}) {
  return Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) && value <= 86_400_000;
}

function killWindowsTree(pid) {
  return new Promise((resolve) => {
    const taskkill = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    const killer = spawn(taskkill, ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    let failed = false;
    const timer = setTimeout(() => { failed = true; killer.kill("SIGTERM"); }, 5000);
    killer.once("error", () => { failed = true; });
    killer.once("close", (code) => { clearTimeout(timer); resolve(!failed && code === 0); });
  });
}

/** Always capture both streams. Returned stdout stays in the caller's memory. */
export function launchQaProcess({
  command, args = [], label = "QA command", cwd = process.cwd(), env = process.env,
  outputLimitBytes = 1_000_000, failOnUnhandledRuntime = false,
  progressIntervalMs = 0, onProgress = null,
}) {
  if (typeof label !== "string" || !/^[A-Za-z][A-Za-z0-9 ()/.-]{0,100}$/.test(label)
    || !Number.isSafeInteger(outputLimitBytes) || outputLimitBytes < 1
    || !validDuration(progressIntervalMs, { allowZero: true })) {
    throw new Error("QA process options must use a bounded output limit and a static safe label.");
  }
  let child;
  try {
    child = spawn(command, args, { cwd, env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  } catch { throw new QaProcessError(label, "start"); }
  const chunks = [];
  const tails = { stdout: "", stderr: "" };
  let totalBytes = 0;
  let runtimeSignals = 0;
  let failure = null;
  let processClosed = false;
  let stopRequested = false;
  let stopPromise;
  let waitPromise;
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  const progress = progressIntervalMs && onProgress ? setInterval(() => {
    try { onProgress(); }
    catch { failure ??= "progress"; void stop().catch(() => {}); }
  }, progressIntervalMs) : null;

  function inspectRuntime(stream, chunk) {
    const prefix = tails[stream];
    const combined = prefix + chunk.toString("utf8");
    const pattern = /unhandled[ _-]?rejection|uncaught[ _-]?exception|UnhandledPromiseRejection|ERR_UNHANDLED_REJECTION/gi;
    for (const match of combined.matchAll(pattern)) {
      if (match.index + match[0].length > prefix.length) runtimeSignals += 1;
    }
    tails[stream] = combined.slice(-128);
  }

  function capture(stream, chunk) {
    inspectRuntime(stream, chunk);
    totalBytes += chunk.length;
    if (totalBytes > outputLimitBytes) {
      failure ??= "output";
      void stop().catch(() => {});
    } else if (stream === "stdout") chunks.push(chunk);
    // Stderr is drained but never retained, returned, or printed.
  }
  child.stdout.on("data", (chunk) => capture("stdout", chunk));
  child.stderr.on("data", (chunk) => capture("stderr", chunk));
  child.once("error", () => { failure ??= "start"; });
  child.once("close", (code, signal) => {
    processClosed = true;
    if (progress) clearInterval(progress);
    resolveClosed({ code, signal, spawnFailed: failure === "start", stopped: stopRequested });
  });

  function stop({ graceMs = 1000 } = {}) {
    if (stopPromise) return stopPromise;
    if (processClosed) return Promise.resolve();
    if (!validDuration(graceMs, { allowZero: true })) return Promise.reject(new Error("QA process shutdown requires a bounded grace period."));
    stopRequested = true;
    stopPromise = (async () => {
      let stopFailed = false;
      let escalation;
      let signalGroup;
      if (child.pid) {
        if (process.platform === "win32") {
          // This exact PID came from our spawn; never use image names or /IM.
          const killed = await killWindowsTree(child.pid);
          if (!killed && !processClosed) {
            stopFailed = true;
            child.kill("SIGTERM");
          }
        } else {
          // detached creates a new group owned by this invocation alone.
          signalGroup = (signal) => {
            try { process.kill(-child.pid, signal); }
            catch (error) {
              if (error.code !== "ESRCH") { stopFailed = true; child.kill(signal); }
            }
          };
          signalGroup("SIGTERM");
          escalation = setTimeout(() => signalGroup("SIGKILL"), graceMs);
        }
      }
      try { await closed; }
      finally {
        // A descendant with detached stdio may outlive its parent and ignore
        // SIGTERM. Finish the owned group even when parent close arrived first.
        signalGroup?.("SIGKILL");
        if (escalation) clearTimeout(escalation);
      }
      if (stopFailed) { failure ??= "cleanup"; throw new QaProcessError(label, "cleanup"); }
    })();
    return stopPromise;
  }

  function wait({ timeoutMs = 30_000 } = {}) {
    if (waitPromise) return waitPromise;
    if (!validDuration(timeoutMs)) return Promise.reject(new Error("QA process waits require an explicit bounded timeout."));
    waitPromise = (async () => {
      const timer = setTimeout(() => {
        if (!processClosed) { failure ??= "timeout"; void stop().catch(() => {}); }
      }, timeoutMs);
      let result;
      try {
        result = await closed;
        // A timeout never rejects ahead of process/tree shutdown settlement.
        if (stopPromise) await stopPromise;
      } finally { clearTimeout(timer); }
      if (failure) throw new QaProcessError(label, failure);
      if (failOnUnhandledRuntime && runtimeSignals) throw new QaProcessError(label, "runtime");
      if (stopRequested) throw new QaProcessError(label, "stopped");
      if (result.code !== 0 || result.signal) throw new QaProcessError(label, "exit");
      return Buffer.concat(chunks).toString("utf8");
    })();
    return waitPromise;
  }

  function assertNoFailures() {
    if (failure) throw new QaProcessError(label, failure);
    if (failOnUnhandledRuntime && runtimeSignals) throw new QaProcessError(label, "runtime");
    if (!stopRequested && (child.signalCode !== null || (child.exitCode !== null && child.exitCode !== 0))) {
      throw new QaProcessError(label, "exit");
    }
  }

  function assertHealthy() {
    assertNoFailures();
    if (!child.pid) throw new QaProcessError(label, "start");
    if (stopRequested || processClosed || child.exitCode !== null || child.signalCode !== null) {
      throw new QaProcessError(label, stopRequested ? "stopped" : "exit");
    }
  }

  return { child, closed, wait, stop, assertHealthy, assertNoFailures, get unexpectedRuntimeSignals() { return runtimeSignals; } };
}

/** Bound HTTP sockets and combine caller cancellation with a run-owned signal. */
export function createQaFetch({ fetchImpl = globalThis.fetch, signal = null, timeoutMs = 15_000 } = {}) {
  if (typeof fetchImpl !== "function" || !validDuration(timeoutMs)) throw new Error("QA requests require a fetch implementation and bounded timeout.");
  return (input, options = {}) => {
    const runSignal = typeof signal === "function" ? signal() : signal;
    const requestSignal = typeof Request !== "undefined" && input instanceof Request ? input.signal : null;
    return fetchImpl(input, { ...options, signal: AbortSignal.any([options.signal, requestSignal, runSignal, AbortSignal.timeout(timeoutMs)].filter(Boolean)) });
  };
}

/** Resolve the dependency's platform package, never an environment override. */
export function resolveInstalledSupabaseBinary(root, { platform = process.platform, arch = os.arch() } = {}) {
  const platforms = {
    win32: { arm64: ["windows-arm64"], x64: ["windows-x64"] },
    darwin: { arm64: ["darwin-arm64"], x64: ["darwin-x64"] },
    linux: { arm64: ["linux-arm64", "linux-arm64-musl"], x64: ["linux-x64", "linux-x64-musl"] },
  };
  let candidates = platforms[platform]?.[arch];
  if (!candidates) throw new Error("Local Supabase CLI has no supported installed platform binary.");
  if (platform === "linux" && !process.report?.getReport().header.glibcVersionRuntime) candidates = [...candidates].reverse();
  const require = createRequire(path.join(root, "package.json"));
  for (const suffix of candidates) {
    try {
      const directory = path.dirname(require.resolve(`@supabase/cli-${suffix}/package.json`));
      const binary = path.join(directory, "bin", `supabase${platform === "win32" ? ".exe" : ""}`);
      if (existsSync(binary) && statSync(binary).isFile()) return realpathSync(binary);
    } catch { /* Try only other known installed platform packages. */ }
  }
  throw new Error("Local Supabase CLI platform binary is missing. Install the project's optional dependencies.");
}

/** Keep interrupts handled until finally has finished the scoped cleanup. */
export function installQaInterruptHandler(onInterrupt, { target = process } = {}) {
  let signal = null;
  let settled = Promise.resolve();
  const handlers = new Map(["SIGINT", "SIGTERM"].map((name) => [name, () => {
    if (signal) return;
    signal = name;
    settled = Promise.resolve().then(() => onInterrupt?.(name)).catch(() => {});
  }]));
  for (const [name, handler] of handlers) target.on(name, handler);
  return {
    get signal() { return signal; },
    get settled() { return settled; },
    throwIfInterrupted() { if (signal) throw new Error(`QA interrupted by ${signal}; completing owned cleanup.`); },
    dispose() { for (const [name, handler] of handlers) target.removeListener(name, handler); },
  };
}
