import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createMeetupDetailsSchema,
  MEETUP_LOCATION_DETAILS_MAX_LENGTH,
  MEETUP_LOCATION_NAME_MAX_LENGTH,
  MEETUP_MAX_SCHEDULE_AHEAD_MS,
  MEETUP_NOTES_MAX_LENGTH,
  MEETUP_PAST_TOLERANCE_MS,
  requestReservationSchema,
  RESERVATION_MESSAGE_MAX_LENGTH,
} from "../src/features/reservations/validation.ts";

const LISTING_ID = "11111111-1111-4111-8111-111111111111";
const RESERVATION_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-28T04:00:00.000Z");

function validMeetup(overrides = {}) {
  return {
    reservationId: RESERVATION_ID,
    locationName: "UC Main Campus Lobby",
    locationDetails: "Near the security desk",
    scheduledAt: "2026-09-28T05:00:00.000Z",
    notes: "Message me when you arrive.",
    ...overrides,
  };
}

describe("reservation request validation", () => {
  test("trims identifiers and optional messages", () => {
    const result = requestReservationSchema.parse({
      listingId: `  ${LISTING_ID}  `,
      message: "  Can we meet after class?  ",
    });

    assert.deepEqual(result, {
      listingId: LISTING_ID,
      message: "Can we meet after class?",
    });
  });

  test("normalizes missing and whitespace-only messages to null", () => {
    assert.equal(
      requestReservationSchema.parse({ listingId: LISTING_ID }).message,
      null,
    );
    assert.equal(
      requestReservationSchema.parse({ listingId: LISTING_ID, message: " \n " })
        .message,
      null,
    );
  });

  test("enforces the reservation message boundary", () => {
    assert.equal(
      requestReservationSchema.safeParse({
        listingId: LISTING_ID,
        message: "x".repeat(RESERVATION_MESSAGE_MAX_LENGTH),
      }).success,
      true,
    );
    assert.equal(
      requestReservationSchema.safeParse({
        listingId: LISTING_ID,
        message: "x".repeat(RESERVATION_MESSAGE_MAX_LENGTH + 1),
      }).success,
      false,
    );
  });

  test("rejects malformed listing identifiers", () => {
    assert.equal(
      requestReservationSchema.safeParse({ listingId: "not-a-uuid" }).success,
      false,
    );
  });
});

describe("meetup details validation", () => {
  const schema = createMeetupDetailsSchema(NOW);

  test("trims text, converts blank optional fields to null, and normalizes time", () => {
    const result = schema.parse(
      validMeetup({
        locationName: "  UC Main Campus Lobby  ",
        locationDetails: "   ",
        scheduledAt: "2026-09-28T13:00:00+08:00",
        notes: " \n ",
      }),
    );

    assert.equal(result.locationName, "UC Main Campus Lobby");
    assert.equal(result.locationDetails, null);
    assert.equal(result.scheduledAt, "2026-09-28T05:00:00.000Z");
    assert.equal(result.notes, null);
    assert.equal(result.expectedUpdatedAt, null);
  });

  test("preserves the exact meetup version used for an edit", () => {
    // PostgreSQL timestamps can include microseconds; rounding to JavaScript
    // milliseconds would cause a current form to be rejected as stale.
    const expectedUpdatedAt = "2026-09-28T03:45:12.123456+00:00";
    assert.equal(
      schema.parse(validMeetup({ expectedUpdatedAt: `  ${expectedUpdatedAt}  ` }))
        .expectedUpdatedAt,
      expectedUpdatedAt,
    );
  });

  test("allows a missing version for the first meetup and rejects invalid edit versions", () => {
    for (const expectedUpdatedAt of [undefined, null, " \n "]) {
      assert.equal(
        schema.parse(validMeetup({ expectedUpdatedAt })).expectedUpdatedAt,
        null,
      );
    }

    for (const expectedUpdatedAt of [
      "not-a-date",
      "2026-09-28",
      "2026-09-28T03:45:12",
      "2026-02-30T03:45:12.123456+00:00",
      1_000,
    ]) {
      assert.equal(
        schema.safeParse(validMeetup({ expectedUpdatedAt })).success,
        false,
        String(expectedUpdatedAt),
      );
    }
  });

  test("requires a valid reservation UUID", () => {
    assert.equal(
      schema.safeParse(validMeetup({ reservationId: "bad-id" })).success,
      false,
    );
  });

  test("enforces location name boundaries", () => {
    assert.equal(
      schema.safeParse(validMeetup({ locationName: "A" })).success,
      false,
    );
    assert.equal(
      schema.safeParse(validMeetup({ locationName: "AB" })).success,
      true,
    );
    assert.equal(
      schema.safeParse(
        validMeetup({ locationName: "x".repeat(MEETUP_LOCATION_NAME_MAX_LENGTH) }),
      ).success,
      true,
    );
    assert.equal(
      schema.safeParse(
        validMeetup({
          locationName: "x".repeat(MEETUP_LOCATION_NAME_MAX_LENGTH + 1),
        }),
      ).success,
      false,
    );
  });

  test("enforces optional location-detail and notes boundaries", () => {
    assert.equal(
      schema.safeParse(
        validMeetup({
          locationDetails: "x".repeat(MEETUP_LOCATION_DETAILS_MAX_LENGTH),
          notes: "x".repeat(MEETUP_NOTES_MAX_LENGTH),
        }),
      ).success,
      true,
    );
    assert.equal(
      schema.safeParse(
        validMeetup({
          locationDetails: "x".repeat(MEETUP_LOCATION_DETAILS_MAX_LENGTH + 1),
        }),
      ).success,
      false,
    );
    assert.equal(
      schema.safeParse(
        validMeetup({ notes: "x".repeat(MEETUP_NOTES_MAX_LENGTH + 1) }),
      ).success,
      false,
    );
  });

  test("requires a real ISO timestamp with an explicit timezone", () => {
    for (const scheduledAt of [
      "not-a-date",
      "2026-09-28",
      "2026-09-28T13:00",
      "2026-02-30T13:00:00+08:00",
    ]) {
      assert.equal(
        schema.safeParse(validMeetup({ scheduledAt })).success,
        false,
        scheduledAt,
      );
    }
  });

  test("allows five minutes of clock skew but rejects older schedules", () => {
    assert.equal(
      schema.safeParse(
        validMeetup({
          scheduledAt: new Date(
            NOW.getTime() - MEETUP_PAST_TOLERANCE_MS,
          ).toISOString(),
        }),
      ).success,
      true,
    );
    assert.equal(
      schema.safeParse(
        validMeetup({
          scheduledAt: new Date(
            NOW.getTime() - MEETUP_PAST_TOLERANCE_MS - 1,
          ).toISOString(),
        }),
      ).success,
      false,
    );
  });

  test("rejects schedules more than one year ahead", () => {
    assert.equal(
      schema.safeParse(
        validMeetup({
          scheduledAt: new Date(
            NOW.getTime() + MEETUP_MAX_SCHEDULE_AHEAD_MS,
          ).toISOString(),
        }),
      ).success,
      true,
    );
    assert.equal(
      schema.safeParse(
        validMeetup({
          scheduledAt: new Date(
            NOW.getTime() + MEETUP_MAX_SCHEDULE_AHEAD_MS + 1,
          ).toISOString(),
        }),
      ).success,
      false,
    );
  });
});
