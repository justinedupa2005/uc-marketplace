import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  canAcceptReservation,
  canCancelReservation,
  canCompleteReservationSale,
  canManageMeetup,
  canRejectReservation,
  getMeetupStatusLabel,
  getReservationCapabilities,
  getReservationStatusLabel,
  MEETUP_STATUSES,
  RESERVATION_STATUSES,
} from "../src/features/reservations/rules.ts";

describe("reservation response and cancellation rules", () => {
  test("only a seller can accept or reject a pending request", () => {
    for (const status of RESERVATION_STATUSES) {
      const expected = status === "pending";
      assert.equal(canAcceptReservation("seller", status), expected);
      assert.equal(canRejectReservation("seller", status), expected);
      assert.equal(canAcceptReservation("buyer", status), false);
      assert.equal(canRejectReservation("buyer", status), false);
      assert.equal(canAcceptReservation("other", status), false);
    }
  });

  test("buyers cancel active requests while sellers cancel only accepted ones", () => {
    for (const status of RESERVATION_STATUSES) {
      assert.equal(
        canCancelReservation("buyer", status),
        status === "pending" || status === "accepted",
      );
      assert.equal(
        canCancelReservation("seller", status),
        status === "accepted",
      );
      assert.equal(canCancelReservation("other", status), false);
    }
  });
});

describe("meetup and completion rules", () => {
  test("participants manage meetups only during an accepted transaction", () => {
    for (const role of ["buyer", "seller", "other"]) {
      for (const reservationStatus of RESERVATION_STATUSES) {
        for (const meetupStatus of [null, ...MEETUP_STATUSES]) {
          const expected =
            role !== "other" &&
            reservationStatus === "accepted" &&
            (meetupStatus === null ||
              meetupStatus === "proposed" ||
              meetupStatus === "scheduled");
          assert.equal(
            canManageMeetup(role, reservationStatus, meetupStatus),
            expected,
            `${role}/${reservationStatus}/${meetupStatus}`,
          );
        }
      }
    }
  });

  test("only the seller completes an accepted reservation on a reserved listing", () => {
    assert.equal(
      canCompleteReservationSale("seller", "accepted", "reserved"),
      true,
    );

    for (const [role, reservationStatus, listingStatus] of [
      ["buyer", "accepted", "reserved"],
      ["other", "accepted", "reserved"],
      ["seller", "pending", "reserved"],
      ["seller", "accepted", "available"],
      ["seller", "completed", "sold"],
    ]) {
      assert.equal(
        canCompleteReservationSale(role, reservationStatus, listingStatus),
        false,
      );
    }
  });

  test("unknown roles and statuses fail closed", () => {
    assert.deepEqual(
      getReservationCapabilities({
        role: "administrator",
        reservationStatus: "mystery",
        listingStatus: "reserved",
        meetupStatus: "scheduled",
      }),
      {
        canView: false,
        canMessage: false,
        canAccept: false,
        canReject: false,
        canCancel: false,
        canManageMeetup: false,
        canCompleteSale: false,
      },
    );

    assert.deepEqual(
      getReservationCapabilities({
        role: "buyer",
        reservationStatus: "mystery",
        listingStatus: "reserved",
        meetupStatus: null,
      }),
      {
        canView: false,
        canMessage: false,
        canAccept: false,
        canReject: false,
        canCancel: false,
        canManageMeetup: false,
        canCompleteSale: false,
      },
    );
  });
});

test("status labels cover every known status and fail safely", () => {
  for (const status of RESERVATION_STATUSES) {
    assert.notEqual(getReservationStatusLabel(status), "Unknown");
  }
  for (const status of MEETUP_STATUSES) {
    assert.notEqual(getMeetupStatusLabel(status), "Unknown");
  }

  assert.equal(getReservationStatusLabel("unexpected"), "Unknown");
  assert.equal(getMeetupStatusLabel("unexpected"), "Unknown");
});
