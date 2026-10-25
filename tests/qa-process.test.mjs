import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import test from "node:test";
import { createQaFetch, installQaInterruptHandler, launchQaProcess, resolveInstalledSupabaseBinary } from "../scripts/qa/lib/process.mjs";

const worker = (source, options = {}) => launchQaProcess({ command: process.execPath, args: ["-e", source], label: "Controlled QA worker", ...options });

test("QA processes return private stdout in memory and discard stderr", async () => {
  const handle = worker("process.stdout.write('private-stdout'); process.stderr.write('private-stderr')");
  assert.equal(await handle.wait(), "private-stdout");
  assert.deepEqual(await handle.closed, { code: 0, signal: null, spawnFailed: false, stopped: false });
});

test("QA process failure messages omit raw command output and paths", async () => {
  const handle = worker("process.stdout.write('private-stdout-token'); process.stderr.write('private-stderr-token'); process.exitCode=4");
  await assert.rejects(handle.wait(), (error) => {
    assert.equal(error.reason, "exit");
    assert.doesNotMatch(error.message, /private-stdout-token|private-stderr-token|node\.exe/);
    return true;
  });
  const missing = launchQaProcess({ command: path.join(process.cwd(), "missing-qa-executable"), label: "Controlled QA worker" });
  await assert.rejects(missing.wait(), (error) => error.reason === "start" && !error.message.includes("missing-qa-executable"));
});

test("failed QA children expose structured failure metadata without their private output", async () => {
  const payload = { version: 1, status: "failed", phase: "api", code: "42501", httpStatus: 403,
    assertion: 12, processReason: null, cleanupFailed: false, secret: "private-token" };
  const output = `private-SDK-output\nQA_FAILURE_JSON:${JSON.stringify(payload)}\n`;
  const handle = worker(`process.stdout.write(${JSON.stringify(output)});process.stderr.write('private-error');process.exitCode=1`);
  await assert.rejects(handle.wait(), (error) => error.reason === "exit");
  const failure = handle.getAcceptanceFailure();
  assert.equal(failure.phase, "api");
  assert.equal(failure.assertion, 12);
  assert.doesNotMatch(JSON.stringify(failure), /private-/);
  const ordinary = worker("process.stdout.write('private-SDK-output');process.exitCode=1");
  await assert.rejects(ordinary.wait());
  assert.equal(ordinary.getAcceptanceFailure(), null);
});

test("QA children expose the newest safe stdout phase without private output or stderr injection", async () => {
  const phase = (name) => `QA_PHASE_JSON:${JSON.stringify({ version: 1, status: "running", phase: name })}\n`;
  const output = `private-SDK-output\n${phase("api")}${phase("browser")}QA_PHASE_JSON:${JSON.stringify({ version: 1, status: "running", phase: "cleanup", secret: "private-token" })}\nQA_PHASE_JSON:not-json\n`;
  const handle = worker(`process.stdout.write(${JSON.stringify(output)});process.stderr.write(${JSON.stringify(phase("cleanup"))});process.exitCode=1`);
  await assert.rejects(handle.wait(), (error) => error.reason === "exit");
  assert.deepEqual(handle.getAcceptancePhase(), { version: 1, status: "running", phase: "browser" });
  assert.doesNotMatch(JSON.stringify(handle.getAcceptancePhase()), /private-|cleanup/);
  const ordinary = worker("process.stdout.write('private-SDK-output');process.exitCode=0");
  await ordinary.wait();
  assert.equal(ordinary.getAcceptancePhase(), null);
});

test("QA phase progress is readable while the child is still running", async () => {
  const line = `QA_PHASE_JSON:${JSON.stringify({ version: 1, status: "running", phase: "build" })}\n`;
  const handle = worker(`process.stdout.write(${JSON.stringify(line)});setInterval(()=>{},1000)`);
  try {
    await new Promise((resolve) => handle.child.stdout.once("data", resolve));
    assert.doesNotThrow(() => handle.assertHealthy());
    assert.deepEqual(handle.getAcceptancePhase(), { version: 1, status: "running", phase: "build" });
  } finally { await handle.stop(); }
});

test("QA timeout settles after the owned child has closed", async () => {
  const handle = worker("setInterval(()=>{},1000)");
  let closed = false;
  handle.child.once("close", () => { closed = true; });
  await assert.rejects(handle.wait({ timeoutMs: 150 }), (error) => error.reason === "timeout");
  assert.equal(closed, true);
  assert.equal((await handle.closed).stopped, true);
  await handle.stop();
});

test("QA bounds the combined stdout and stderr bytes before stopping", async () => {
  for (const stream of ["stdout", "stderr"]) {
    const handle = worker(`process.${stream}.write('private-output'.repeat(1000));setInterval(()=>{},1000)`, { outputLimitBytes: 1000 });
    await assert.rejects(handle.wait(), (error) => error.reason === "output" && !error.message.includes("private-output"));
    assert.equal((await handle.closed).stopped, true);
  }
});

test("QA detects unhandled runtime signals split across either captured stream", async () => {
  for (const stream of ["stdout", "stderr"]) {
    const handle = worker(`process.${stream}.write('unhandledRej');setTimeout(()=>process.${stream}.write('ection private-detail'),30)`, { failOnUnhandledRuntime: true });
    await assert.rejects(handle.wait(), (error) => error.reason === "runtime" && !error.message.includes("private-detail"));
    assert.equal(handle.unexpectedRuntimeSignals, 1);
  }
  const monitored = worker("process.stderr.write('uncaughtException');process.exitCode=0");
  assert.equal(await monitored.wait(), "");
  assert.equal(monitored.unexpectedRuntimeSignals, 1);
});

test("QA server health exposes unexpected exits without requiring wait", async () => {
  for (const code of [0, 7]) {
    const handle = worker(`process.exitCode=${code}`);
    await handle.closed;
    await handle.stop();
    assert.throws(() => handle.assertHealthy(), (error) => error.reason === "exit");
    if (code) assert.throws(() => handle.assertNoFailures(), (error) => error.reason === "exit");
    else assert.doesNotThrow(() => handle.assertNoFailures());
  }
});

test("QA retains runtime and private output failures when the caller never waits", async () => {
  const runtime = worker("process.stderr.write('uncaughtException private-runtime-detail')", { failOnUnhandledRuntime: true });
  await runtime.closed;
  await runtime.stop();
  assert.throws(() => runtime.assertNoFailures(), (error) => error.reason === "runtime" && !error.message.includes("private-runtime-detail"));
  const limited = worker("process.stdout.write('private-output-detail'.repeat(1000));setInterval(()=>{},1000)", { outputLimitBytes: 1000 });
  await limited.closed;
  await limited.stop();
  assert.throws(() => limited.assertNoFailures(), (error) => error.reason === "output" && !error.message.includes("private-output-detail"));
});

test("QA distinguishes healthy running servers from deliberate clean stops", async () => {
  const handle = worker("setInterval(()=>{},1000)");
  try { assert.doesNotThrow(() => handle.assertHealthy()); }
  finally { await handle.stop(); }
  assert.doesNotThrow(() => handle.assertNoFailures());
  assert.throws(() => handle.assertHealthy(), (error) => error.reason === "stopped");
});

test("QA request cancellation switches from aborted run work to fresh cleanup work", async () => {
  const run = new AbortController();
  const cleanup = new AbortController();
  let currentSignal = run.signal;
  const calls = [];
  const request = createQaFetch({ signal: () => currentSignal, fetchImpl: async (_input, options) => { calls.push(options.signal); return { ok: true }; } });
  await request("http://127.0.0.1:54331");
  run.abort();
  assert.equal(calls[0].aborted, true);
  currentSignal = cleanup.signal;
  await request("http://127.0.0.1:54331");
  assert.equal(calls[1].aborted, false);
  cleanup.abort();
  assert.equal(calls[1].aborted, true);
});

test("QA requests preserve caller and Request cancellation and add a bounded deadline", async () => {
  const caller = new AbortController();
  const requestOwner = new AbortController();
  const signals = [];
  const request = createQaFetch({ timeoutMs: 20, fetchImpl: async (_input, options) => { signals.push(options.signal); return { ok: true }; } });
  await request("http://127.0.0.1:54331", { signal: caller.signal });
  await request(new Request("http://127.0.0.1:54331", { signal: requestOwner.signal }));
  await request("http://127.0.0.1:54331");
  caller.abort();
  requestOwner.abort();
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, true);
  await pause(40);
  assert.equal(signals[2].aborted, true);
  assert.throws(() => createQaFetch({ timeoutMs: 0 }), /bounded timeout/);
});

test("QA stop is idempotent and does not stop a different owned worker", async () => {
  const target = worker("setInterval(()=>{},1000)");
  const other = worker("setInterval(()=>{},1000)");
  try {
    await Promise.all([target.stop(), target.stop()]);
    let otherClosed = false;
    other.closed.then(() => { otherClosed = true; });
    await pause(30);
    assert.equal(otherClosed, false);
    assert.equal((await target.closed).stopped, true);
  } finally { await other.stop(); }
});

test("QA stops descendants belonging to its own worker tree or process group", async () => {
  const leafSource = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
  const parentSource = `const {spawn}=require('node:child_process');const leaf=spawn(process.execPath,['-e',${JSON.stringify(leafSource)}],{stdio:'ignore',windowsHide:true});process.stdout.write(String(leaf.pid));setInterval(()=>{},1000)`;
  const parent = worker(parentSource);
  let pid;
  try {
    const value = await new Promise((resolve) => parent.child.stdout.once("data", (chunk) => resolve(chunk.toString())));
    pid = Number(value);
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    await pause(100);
    await parent.stop({ graceMs: 100 });
    const alive = () => {
      try {
        process.kill(pid, 0);
        // A reparented Linux zombie has exited and cannot run or hold ports.
        if (process.platform === "linux") return readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[2] !== "Z";
        return true;
      } catch { return false; }
    };
    for (let attempt = 0; attempt < 50 && alive(); attempt++) await pause(20);
    assert.equal(alive(), false);
  } finally { await parent.stop(); }
});

test("QA interrupt handling records once, awaits shutdown, and removes only its listeners", async () => {
  const target = new EventEmitter();
  const existing = () => {};
  target.on("SIGINT", existing);
  const received = [];
  const interrupts = installQaInterruptHandler(async (signal) => { await pause(10); received.push(signal); }, { target });
  try {
    target.emit("SIGTERM");
    target.emit("SIGINT");
    assert.equal(interrupts.signal, "SIGTERM");
    assert.throws(() => interrupts.throwIfInterrupted(), /QA interrupted by SIGTERM/);
    await interrupts.settled;
    assert.deepEqual(received, ["SIGTERM"]);
  } finally { interrupts.dispose(); }
  assert.deepEqual(target.listeners("SIGINT"), [existing]);
  assert.equal(target.listenerCount("SIGTERM"), 0);
});

test("QA resolves the installed native Supabase dependency without executable overrides", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const previous = process.env.SUPABASE_CLI_BINARY_OVERRIDE;
  process.env.SUPABASE_CLI_BINARY_OVERRIDE = "an-untrusted-override";
  try {
    const binary = resolveInstalledSupabaseBinary(root);
    assert.equal(existsSync(binary), true);
    assert.match(binary, /[\\/]@supabase[\\/]cli-[^\\/]+[\\/]bin[\\/]supabase(?:\.exe)?$/);
    assert.notEqual(binary, "an-untrusted-override");
    assert.throws(() => resolveInstalledSupabaseBinary(root, { platform: "unsupported", arch: "x64" }), /supported installed platform/);
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_CLI_BINARY_OVERRIDE;
    else process.env.SUPABASE_CLI_BINARY_OVERRIDE = previous;
  }
});
