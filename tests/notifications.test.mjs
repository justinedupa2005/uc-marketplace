import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getNotificationDestination,
  getNotificationPage,
  getNotificationsPageHref,
  isNotificationType,
  NOTIFICATION_TYPES,
} from "../src/features/notifications/rules.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const row = (type, overrides = {}) => ({
  type, conversationId: ID, reservationId: ID, ...overrides,
});

test("notification types are controlled and unknown values fail closed", () => {
  assert.equal(NOTIFICATION_TYPES.length, 13);
  for (const type of NOTIFICATION_TYPES) assert.equal(isNotificationType(type), true);
  assert.equal(isNotificationType("arbitrary"), false);
  assert.equal(getNotificationDestination(row("javascript:alert(1)")), null);
});

test("notifications route only to the recipient's relevant feature", () => {
  assert.equal(getNotificationDestination(row("message")), `/messages/${ID}`);
  for (const type of [
    "reservation_requested", "reservation_accepted", "reservation_rejected",
    "reservation_cancelled", "meetup_scheduled", "meetup_updated", "sale_completed",
  ]) {
    assert.equal(getNotificationDestination(row(type)), `/reservations/${ID}`);
  }
  assert.equal(getNotificationDestination(row("verification_approved")), "/profile");
  assert.equal(getNotificationDestination(row("verification_rejected")), "/verification");
  assert.equal(getNotificationDestination(row("listing_removed")), "/my-listings");
  assert.equal(getNotificationDestination(row("account_suspended")), "/account-status");
  assert.equal(getNotificationDestination(row("account_reactivated")), "/profile");
});

test("deleted or malformed related IDs never create unsafe or dead entity links", () => {
  for (const id of [null, "", "../admin", "javascript:alert(1)", "https://evil.invalid", `${ID}?other=1`]) {
    assert.equal(getNotificationDestination(row("message", { conversationId: id })), null);
    assert.equal(getNotificationDestination(row("meetup_updated", { reservationId: id })), null);
  }
  assert.equal(getNotificationDestination({ ...row("message"), url: "https://evil.invalid" }), `/messages/${ID}`);
});

test("pagination rejects unbounded offsets and serializes canonical notification URLs", () => {
  assert.equal(getNotificationPage(undefined), 1);
  assert.equal(getNotificationPage(["2", "3"]), 2);
  for (const page of ["0", "-1", "1.5", "2x", "100001", "999999999999999999999", " 2 "]) {
    assert.equal(getNotificationPage(page), 1);
  }
  assert.equal(getNotificationsPageHref(1), "/notifications");
  assert.equal(getNotificationsPageHref(2), "/notifications?page=2");
  assert.equal(getNotificationsPageHref(Infinity), "/notifications");
});
