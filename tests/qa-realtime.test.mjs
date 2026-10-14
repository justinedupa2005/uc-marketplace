import assert from "node:assert/strict";
import test from "node:test";
import { createMessageObserver, isMessageObserverReady, isValidRealtimeDenialEvidence, MIN_REALTIME_DENIAL_WINDOW_MS, runRealtimeChecks } from "../scripts/qa/lib/realtime.mjs";

const validEvidence = () => ({
  subscribedAt: 10, positiveControlBeforeAt: 20, windowStartedAt: 30,
  windowEndedAt: 30 + MIN_REALTIME_DENIAL_WINDOW_MS, positiveControlAfterAt: 40 + MIN_REALTIME_DENIAL_WINDOW_MS,
  targetParticipantDeliveries: 8, targetUnauthorizedDeliveries: 0,
  transportFailureCount: 0, protocolFailureCount: 0, postgresFailureCount: 0,
  subscribedAfterWindow: true, postgresReadyAfterWindow: true,
});

test("realtime denial requires a full healthy receive window bracketed by positive deliveries", () => {
  assert.equal(isValidRealtimeDenialEvidence(validEvidence()), true);
  for (const evidence of [null, {}, { targetUnauthorizedDeliveries: 0 }]) {
    assert.equal(isValidRealtimeDenialEvidence(evidence), false);
  }
  for (const field of Object.keys(validEvidence())) {
    const evidence = validEvidence();
    delete evidence[field];
    assert.equal(isValidRealtimeDenialEvidence(evidence), false, `${field} must be present`);
  }
});

test("realtime denial rejects short, unbounded, invalid, and out-of-order observations", () => {
  const invalid = [
    { windowEndedAt: 30 + MIN_REALTIME_DENIAL_WINDOW_MS - 1 },
    { windowEndedAt: 30031, positiveControlAfterAt: 30032 },
    { subscribedAt: 21 }, { positiveControlBeforeAt: 31 },
    { positiveControlAfterAt: 30 + MIN_REALTIME_DENIAL_WINDOW_MS - 1 },
    { subscribedAt: -1 }, { windowStartedAt: "30" }, { windowEndedAt: NaN },
    { positiveControlBeforeAt: Infinity }, { positiveControlAfterAt: null },
  ];
  for (const update of invalid) assert.equal(isValidRealtimeDenialEvidence({ ...validEvidence(), ...update }), false);
});

test("a dropped subscription or unauthorized event cannot pass as realtime denial", () => {
  for (const update of [
    { targetParticipantDeliveries: 0 }, { targetParticipantDeliveries: 1 },
    { targetParticipantDeliveries: 2.5 }, { targetParticipantDeliveries: "8" },
    { targetUnauthorizedDeliveries: 1 }, { targetUnauthorizedDeliveries: "0" },
    { transportFailureCount: 1 }, { protocolFailureCount: 1 }, { postgresFailureCount: 1 },
    { postgresFailureCount: "0" }, { postgresReadyAfterWindow: false }, { postgresReadyAfterWindow: "true" },
    { subscribedAfterWindow: false }, { subscribedAfterWindow: "true" },
  ]) assert.equal(isValidRealtimeDenialEvidence({ ...validEvidence(), ...update }), false);
});

const observerRunId = "b9ce019b-be12-4afd-891a-f4591817ec35";
const observerConversationId = "d2eec5f8-2f24-47d2-89a5-88b8f8b793b4";
const observerControlId = "7f9351eb-e2a7-40a0-9aa9-fb3b80c4ecce";

function fakeObserver(conversationIds = [observerConversationId], forbiddenId = null) {
  const bindings = [];
  let subscribed;
  let connected = true;
  const channel = {
    on(type, filter, callback) { bindings.push({ type, filter, callback }); return channel; },
    subscribe(callback) { subscribed = callback; return channel; },
  };
  const client = { channel: () => channel, realtime: { isConnected: () => connected } };
  const observer = createMessageObserver(client, "competitor", observerRunId, conversationIds, forbiddenId);
  return {
    observer, bindings,
    connect(value) { connected = value; },
    status(value, error) { subscribed(value, error); },
    system(payload) { bindings.filter((binding) => binding.type === "system").forEach((binding) => binding.callback(payload)); },
    change(payload, conversationId = observerConversationId, event = "INSERT") {
      const binding = bindings.find((item) => item.type === "postgres_changes"
        && item.filter.event === event && item.filter.filter === `conversation_id=eq.${conversationId}`);
      assert.ok(binding, "a matching explicit message change binding is required");
      binding.callback(payload);
    },
  };
}

function messageChange(overrides = {}, eventType = "INSERT") {
  return {
    schema: "public", table: "messages", eventType,
    new: {
      id: "f2b796bf-8bdf-4256-b62a-4422b30a7789",
      conversation_id: observerConversationId,
      sender_id: "c0c5299c-5938-4084-8db3-a724d7697caa",
      body: "Synthetic authorized QA message",
      created_at: "2026-10-13T00:00:00.000Z", read_at: null,
      ...overrides,
    },
  };
}

test("message observer waits for PostgreSQL CDC readiness after SUBSCRIBED", () => {
  const fake = fakeObserver();
  assert.deepEqual(fake.bindings.find((binding) => binding.type === "system").filter, {});
  assert.equal(isMessageObserverReady(fake.observer), false);
  fake.status("SUBSCRIBED");
  assert.equal(fake.observer.postgresChangesStatus, null);
  assert.equal(isMessageObserverReady(fake.observer), false, "a channel join alone must not authorize the first write");
  fake.system({ extension: "postgres_changes", status: "ok" });
  assert.equal(isMessageObserverReady(fake.observer), true);
});

test("message observer also handles CDC readiness arriving before the join callback", () => {
  const fake = fakeObserver();
  fake.system({ extension: "postgres_changes", status: "ok" });
  assert.equal(isMessageObserverReady(fake.observer), false);
  fake.status("SUBSCRIBED");
  assert.equal(isMessageObserverReady(fake.observer), true);
  assert.ok(Number.isFinite(fake.observer.subscribedAt));
});

test("Broadcast replication-ready and unrelated system events do not prove CDC readiness", () => {
  const fake = fakeObserver();
  fake.status("SUBSCRIBED");
  for (const payload of [
    { extension: "system", status: "ok", message: "Replication connection established" },
    { extension: "broadcast", status: "ok" },
    { status: "ok" }, {},
  ]) {
    fake.system(payload);
    assert.equal(isMessageObserverReady(fake.observer), false);
    assert.equal(fake.observer.postgresChangesStatus, null);
    assert.equal(fake.observer.postgresFailures, 0);
  }
});

test("CDC errors and malformed statuses fail closed without retaining private system payloads", () => {
  for (const status of ["error", "timeout", "private-status-sensitive", null, undefined, 1]) {
    const fake = fakeObserver();
    fake.status("SUBSCRIBED");
    fake.system({ extension: "postgres_changes", status,
      message: "jwt-sensitive postgres://credential:secret@private.test",
      channel: "private-channel-sensitive", nested: { private: "private-body-sensitive" } });
    assert.equal(fake.observer.postgresFailures, 1);
    assert.equal(isMessageObserverReady(fake.observer), false);
    assert.doesNotMatch(JSON.stringify(fake.observer), /jwt-sensitive|credential|secret|private\.test|private-channel-sensitive|private-body-sensitive|private-status-sensitive/);
    fake.system({ extension: "postgres_changes", status: "ok" });
    assert.equal(isMessageObserverReady(fake.observer), false, "a later success must not erase the earlier CDC failure");
  }
});

test("message observer readiness requires a connected healthy channel and valid payloads", () => {
  const fake = fakeObserver();
  fake.status("SUBSCRIBED");
  fake.system({ extension: "postgres_changes", status: "ok" });
  assert.equal(isMessageObserverReady(fake.observer), true);
  fake.connect(false);
  assert.equal(isMessageObserverReady(fake.observer), false);
  fake.connect(true);
  for (const field of ["protocolFailures", "postgresFailures"]) {
    fake.observer[field] = 1;
    assert.equal(isMessageObserverReady(fake.observer), false);
    fake.observer[field] = 0;
  }
  fake.observer.failures.push("CHANNEL_ERROR");
  assert.equal(isMessageObserverReady(fake.observer), false);
});

test("message observer still validates exact message change bindings and INSERT/UPDATE payloads", () => {
  const fake = fakeObserver([observerConversationId, observerControlId], observerConversationId);
  assert.deepEqual(fake.bindings.filter((binding) => binding.type === "postgres_changes").map((binding) => binding.filter), [
    { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${observerConversationId}` },
    { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${observerConversationId}` },
    { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${observerControlId}` },
    { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${observerControlId}` },
  ]);
  fake.change(messageChange());
  fake.change(messageChange({ read_at: "2026-10-13T00:00:01.000Z" }, "UPDATE"), observerConversationId, "UPDATE");
  assert.equal(fake.observer.events.length, 2);
  assert.equal(fake.observer.events[0].eventType, "INSERT");
  assert.equal(fake.observer.events[1].eventType, "UPDATE");
  assert.ok(fake.observer.events.every((event) => Number.isFinite(event.receivedAt)));
  assert.equal(fake.observer.forbiddenConversationId, observerConversationId);
  for (const payload of [
    messageChange({ id: "not-a-uuid" }), messageChange({ sender_id: "not-a-uuid" }),
    messageChange({ conversation_id: observerControlId }), messageChange({ body: null }),
    messageChange({ created_at: "invalid" }), messageChange({ read_at: "invalid" }),
    { ...messageChange(), schema: "private" }, { ...messageChange(), table: "profiles" },
    { ...messageChange(), eventType: "DELETE" }, { ...messageChange(), new: null },
  ]) fake.change(payload);
  assert.equal(fake.observer.protocolFailures, 10);
  assert.equal(fake.observer.events.length, 2, "invalid changes must not enter the delivery evidence");
});

test("owned closure clears CDC readiness without recording an expected transport failure", () => {
  const fake = fakeObserver();
  fake.status("SUBSCRIBED");
  fake.system({ extension: "postgres_changes", status: "ok" });
  fake.observer.closing = true;
  fake.status("CLOSED");
  assert.equal(fake.observer.postgresChangesStatus, null);
  assert.equal(fake.observer.failures.length, 0);
  assert.equal(isMessageObserverReady(fake.observer), false);
  fake.status("SUBSCRIBED");
  assert.equal(isMessageObserverReady(fake.observer), false, "rejoining cannot reuse stale CDC readiness");
  fake.system({ extension: "postgres_changes", status: "ok" });
  assert.equal(isMessageObserverReady(fake.observer), false, "late readiness cannot reopen an owned closed observer");
});

test("unexpected channel termination clears CDC readiness and ignores secret-bearing SDK errors", () => {
  for (const status of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) {
    const fake = fakeObserver();
    fake.status("SUBSCRIBED");
    fake.system({ extension: "postgres_changes", status: "ok" });
    fake.status(status, new Error("jwt-sensitive postgres://credential:secret@private.test"));
    assert.equal(fake.observer.postgresChangesStatus, null);
    assert.deepEqual(fake.observer.failures, [status]);
    assert.equal(isMessageObserverReady(fake.observer), false);
    assert.doesNotMatch(JSON.stringify(fake.observer), /jwt-sensitive|credential|secret|private\.test/);
  }
});

test("realtime acceptance rejects shared fixture identities before any query or write", async () => {
  const id = "38e21c20-28ed-4f81-93d5-884663217bae";
  let queries = 0;
  const context = {
    runId: "b9ce019b-be12-4afd-891a-f4591817ec35",
    accounts: { seller: { id }, buyer: { id }, competitor: { id } },
    config: { publishableKey: "sb_publishable_fixture", serviceRoleKey: "fixture-service-key" },
    pool: { query() { queries += 1; throw new Error("must not query"); } },
  };
  await assert.rejects(runRealtimeChecks(context), /three|distinct identities/);
  assert.equal(queries, 0);
});

test("realtime acceptance rejects privileged subscriber keys before querying", async () => {
  let queries = 0;
  const context = {
    runId: "b9ce019b-be12-4afd-891a-f4591817ec35",
    accounts: {
      seller: { id: "c0c5299c-5938-4084-8db3-a724d7697caa" },
      buyer: { id: "0635e251-1689-4ac7-a938-44b97ba2f98c" },
      competitor: { id: "232b5085-ac73-4c04-a9bd-7e487e2f387b" },
    },
    config: { publishableKey: "sb_secret_do-not-use", serviceRoleKey: "sb_secret_do-not-use" },
    pool: { query() { queries += 1; throw new Error("must not query"); } },
  };
  await assert.rejects(runRealtimeChecks(context), /public key/);
  assert.equal(queries, 0);
});

test("unexpected realtime service errors are sanitized and never recorded as live success", async () => {
  const context = {
    runId: "b9ce019b-be12-4afd-891a-f4591817ec35",
    accounts: {
      seller: { id: "c0c5299c-5938-4084-8db3-a724d7697caa" },
      buyer: { id: "0635e251-1689-4ac7-a938-44b97ba2f98c" },
      competitor: { id: "232b5085-ac73-4c04-a9bd-7e487e2f387b" },
    },
    config: { publishableKey: "sb_publishable_fixture", serviceRoleKey: "fixture-service-key" },
    pool: { async query() { throw new Error("postgres://credential:secret@private.test jwt-sensitive"); } },
  };
  await assert.rejects(runRealtimeChecks(context), (error) => {
    assert.match(error.message, /no live acceptance was recorded/);
    assert.doesNotMatch(error.message, /credential|secret|private.test|jwt-sensitive/);
    return true;
  });
});
