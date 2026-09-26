import assert from "node:assert/strict";
import test from "node:test";

import {
  canFavoriteListing,
  canOwnerEditListing,
  canOwnerMarkListingSold,
  canOwnerRemoveListing,
  canReportListing,
  canRequestListingReservation,
  canSendExistingConversation,
  canStartListingConversation,
  getListingStatusLabel,
  isNormallyBrowsableListing,
} from "../src/lib/listing-rules.ts";

test("available listings support every normal buyer and owner action", () => {
  assert.equal(isNormallyBrowsableListing("available"), true);
  assert.equal(canFavoriteListing("available"), true);
  assert.equal(canStartListingConversation("available"), true);
  assert.equal(canRequestListingReservation("available"), true);
  assert.equal(canReportListing("available"), true);
  assert.equal(canOwnerEditListing("available"), true);
  assert.equal(canOwnerMarkListingSold("available"), true);
  assert.equal(canOwnerRemoveListing("available"), true);
});

test("reserved listings remain visible but cannot receive a new reservation", () => {
  assert.equal(isNormallyBrowsableListing("reserved"), true);
  assert.equal(canFavoriteListing("reserved"), true);
  assert.equal(canStartListingConversation("reserved"), true);
  assert.equal(canRequestListingReservation("reserved"), false);
  assert.equal(canOwnerEditListing("reserved"), true);
});

test("sold and removed listings reject new buyer interactions", () => {
  for (const status of ["sold", "removed"]) {
    assert.equal(isNormallyBrowsableListing(status), false);
    assert.equal(canFavoriteListing(status), false);
    assert.equal(canStartListingConversation(status), false);
    assert.equal(canRequestListingReservation(status), false);
    assert.equal(canReportListing(status), false);
    assert.equal(canOwnerEditListing(status), false);
    assert.equal(canOwnerMarkListingSold(status), false);
  }

  assert.equal(canOwnerRemoveListing("sold"), true);
  assert.equal(canOwnerRemoveListing("removed"), false);
});

test("existing conversations remain open for sold listings but not removed listings", () => {
  assert.equal(canSendExistingConversation("available"), true);
  assert.equal(canSendExistingConversation("reserved"), true);
  assert.equal(canSendExistingConversation("sold"), true);
  assert.equal(canSendExistingConversation("removed"), false);
  assert.equal(canSendExistingConversation("unexpected"), false);
});

test("status labels stay human readable", () => {
  assert.equal(getListingStatusLabel("available"), "Available");
  assert.equal(getListingStatusLabel("reserved"), "Reserved");
  assert.equal(getListingStatusLabel("sold"), "Sold");
  assert.equal(getListingStatusLabel("removed"), "Removed");
});
