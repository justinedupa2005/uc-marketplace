import assert from "node:assert/strict";
import test from "node:test";
import { createConversationRealtimeLifecycle } from "../src/features/messages/client/realtime-lifecycle.ts";

const ready = { extension: "postgres_changes", status: "ok" };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture() {
  const reads = [];
  const applied = [];
  const states = [];
  const timers = new Map();
  let timerId = 0;
  const lifecycle = createConversationRealtimeLifecycle({
    load: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
    apply: (messages) => applied.push(messages),
    onState: (state) => states.push(state),
    setTimer(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return {
    lifecycle, reads, applied, states, timers,
    async resolve(index, rows = []) { reads[index].resolve(rows); await flush(); },
    async reject(index) { reads[index].reject(new Error("Private transport details must not escape")); await flush(); },
    fire(delay) {
      const timer = [...timers].find(([, value]) => value.delay === delay);
      assert.ok(timer, `expected a ${delay}ms timer`);
      timers.delete(timer[0]);
      timer[1].callback();
    },
  };
}

test("chat waits for CDC then refreshes messages written after the initial channel snapshot", async () => {
  const f = fixture();
  f.lifecycle.channelStatus("SUBSCRIBED");
  await f.resolve(0, ["initial"]);
  assert.deepEqual(f.states, [], "a successful history read and socket join do not prove CDC readiness");
  f.lifecycle.system(ready);
  assert.equal(f.reads.length, 2);
  await f.resolve(1, ["initial", "written-in-readiness-gap"]);
  assert.deepEqual(f.applied, [["initial"], ["initial", "written-in-readiness-gap"]]);
  assert.deepEqual(f.states, ["connected"]);
  assert.equal(f.timers.size, 0);
  f.lifecycle.dispose();
});

test("chat also waits for a joined channel when CDC readiness arrives first", async () => {
  const f = fixture();
  f.lifecycle.system(ready);
  await f.resolve(0, ["before-join"]);
  assert.deepEqual(f.states, []);
  f.lifecycle.channelStatus("SUBSCRIBED");
  await f.resolve(1, ["after-join"]);
  assert.deepEqual(f.states, ["connected"]);
  assert.equal(f.timers.size, 0);
  f.lifecycle.dispose();
});

test("CDC readiness during an in-flight history read queues one fresh read instead of dropping it", async () => {
  const f = fixture();
  f.lifecycle.channelStatus("SUBSCRIBED");
  f.lifecycle.system(ready);
  f.lifecycle.system(ready);
  assert.equal(f.reads.length, 1, "history reads must not overlap");
  await f.resolve(0, ["old-snapshot"]);
  assert.equal(f.reads.length, 2, "readiness requests must coalesce into a fresh read");
  assert.deepEqual(f.states, [], "the pre-readiness snapshot cannot declare the chat connected");
  await f.resolve(1, ["old-snapshot", "gap-message"]);
  assert.deepEqual(f.states, ["connected"]);
  assert.deepEqual(f.applied.at(-1), ["old-snapshot", "gap-message"]);
  f.lifecycle.dispose();
});

test("missing CDC readiness becomes offline after a bounded wait and successful REST reads retain backoff", async () => {
  const f = fixture();
  f.lifecycle.channelStatus("SUBSCRIBED");
  await f.resolve(0);
  f.fire(15_000);
  assert.deepEqual(f.states, ["offline"]);
  await f.resolve(1);
  for (const [index, delay] of [[2, 1_000], [3, 2_000], [4, 4_000]]) {
    f.fire(delay);
    await f.resolve(index);
    assert.deepEqual(f.states, ["offline"]);
  }
  assert.ok([...f.timers.values()].some((timer) => timer.delay === 8_000));
  f.lifecycle.system(ready);
  assert.equal(f.timers.size, 0, "the immediate readiness catch-up cancels the scheduled fallback read");
  await f.resolve(5);
  assert.deepEqual(f.states, ["offline", "connected"]);
  f.lifecycle.dispose();
});

test("a failed current history fetch remains offline until a retry succeeds on a ready listener", async () => {
  const f = fixture();
  f.lifecycle.channelStatus("SUBSCRIBED");
  f.lifecycle.system(ready);
  await f.resolve(0);
  await f.reject(1);
  assert.deepEqual(f.states, ["offline"]);
  f.fire(1_000);
  await f.resolve(2, ["recovered"]);
  assert.deepEqual(f.states, ["offline", "connected"]);
  assert.equal(f.timers.size, 0);
  f.lifecycle.dispose();
});

test("CDC failures are offline and unrelated system events cannot declare the listener ready", async () => {
  const f = fixture();
  f.lifecycle.channelStatus("SUBSCRIBED");
  await f.resolve(0);
  for (const event of [null, undefined, {}, { extension: "system", status: "ok" }, { extension: "broadcast", status: "ok" }]) {
    f.lifecycle.system(event);
  }
  assert.equal(f.reads.length, 1);
  f.lifecycle.system({ extension: "postgres_changes", status: "error", message: "Private server response" });
  await f.resolve(1);
  assert.deepEqual(f.states, ["offline"]);
  f.lifecycle.system(ready);
  await f.resolve(2);
  assert.deepEqual(f.states, ["offline", "connected"]);
  f.lifecycle.dispose();
});

test("a reconnect cannot reuse the previous CDC readiness or an older in-flight history snapshot", async () => {
  const f = fixture();
  f.lifecycle.channelStatus("SUBSCRIBED");
  f.lifecycle.system(ready);
  await f.resolve(0);
  await f.resolve(1);
  f.lifecycle.channelStatus("CHANNEL_ERROR");
  f.lifecycle.channelStatus("SUBSCRIBED");
  await f.resolve(2, ["old-connection-snapshot"]);
  await f.resolve(3, ["rest-without-new-cdc"]);
  assert.deepEqual(f.states, ["connected", "offline"]);
  f.lifecycle.system(ready);
  await f.resolve(4, ["new-connection-snapshot"]);
  assert.deepEqual(f.states, ["connected", "offline", "connected"]);
  f.lifecycle.dispose();
});

test("dispose clears timers and blocks late fetches, readiness events and queued reads", async () => {
  const f = fixture();
  f.lifecycle.channelStatus("SUBSCRIBED");
  f.lifecycle.system(ready);
  f.lifecycle.dispose();
  assert.equal(f.timers.size, 0);
  await f.resolve(0, ["must-not-apply"]);
  f.lifecycle.channelStatus("SUBSCRIBED");
  f.lifecycle.channelStatus("CLOSED");
  f.lifecycle.system(ready);
  assert.equal(f.reads.length, 1);
  assert.deepEqual(f.applied, []);
  assert.deepEqual(f.states, []);
  assert.equal(f.timers.size, 0);
});
