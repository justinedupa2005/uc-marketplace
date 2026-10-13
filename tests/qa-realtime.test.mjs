import assert from "node:assert/strict";
import test from "node:test";
import { isValidRealtimeDenialEvidence, MIN_REALTIME_DENIAL_WINDOW_MS, runRealtimeChecks } from "../scripts/qa/lib/realtime.mjs";

const validEvidence = () => ({
  subscribedAt: 10, positiveControlBeforeAt: 20, windowStartedAt: 30,
  windowEndedAt: 30 + MIN_REALTIME_DENIAL_WINDOW_MS, positiveControlAfterAt: 40 + MIN_REALTIME_DENIAL_WINDOW_MS,
  targetParticipantDeliveries: 8, targetUnauthorizedDeliveries: 0,
  transportFailureCount: 0, protocolFailureCount: 0, subscribedAfterWindow: true,
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
    { transportFailureCount: 1 }, { protocolFailureCount: 1 },
    { subscribedAfterWindow: false }, { subscribedAfterWindow: "true" },
  ]) assert.equal(isValidRealtimeDenialEvidence({ ...validEvidence(), ...update }), false);
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
