import assert from "node:assert/strict";
import { test } from "node:test";

import { mapReservationError } from "../src/features/reservations/errors.ts";

test("duplicate conflicts are translated for reservation requests and acceptance", () => {
  assert.equal(
    mapReservationError("request", { code: "23505" }),
    "You already have an active reservation request for this item.",
  );
  assert.equal(
    mapReservationError("accept", { code: "23505" }),
    "This item has already been reserved for another buyer.",
  );
});

test("stale operations receive operation-specific guidance", () => {
  assert.match(
    mapReservationError("request", { code: "P0002" }),
    /no longer available/i,
  );
  assert.match(
    mapReservationError("cancel", { code: "P0002" }),
    /no longer be cancelled/i,
  );
  assert.match(
    mapReservationError("complete", { code: "P0002" }),
    /current status/i,
  );
});

test("permission and validation SQLSTATEs have safe messages", () => {
  assert.match(
    mapReservationError("request", { code: "42501" }),
    /verified, active student/i,
  );
  assert.match(
    mapReservationError("meetup", { code: "22023" }),
    /location, schedule, and notes/i,
  );
  assert.match(
    mapReservationError("meetup", { code: "22P02" }),
    /location, schedule, and notes/i,
  );
  assert.match(
    mapReservationError("meetup", { code: "23514" }),
    /location, schedule, and notes/i,
  );
});

test("serialization conflicts ask the user to refresh", () => {
  assert.match(
    mapReservationError("accept", { code: "40001" }),
    /changed.*refresh/i,
  );
  assert.match(
    mapReservationError("meetup", { code: "40001" }),
    /changed.*reopen.*before saving/i,
  );
});

test("unknown database details are never exposed", () => {
  const secret = "duplicate key value reveals private-row@example.test";
  const result = mapReservationError("meetup", {
    code: "XX999",
    message: secret,
    details: secret,
    hint: secret,
  });

  assert.equal(
    result,
    "Unable to save meetup details. Please refresh and try again.",
  );
  assert.equal(result.includes(secret), false);
});
