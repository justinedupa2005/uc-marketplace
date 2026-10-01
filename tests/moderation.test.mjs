import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ADMIN_PAGE_SIZE,
  getAdminPage,
  getAdminPageCount,
  getAdminPageHref,
  getAdminSearch,
  getListingStatusFilter,
  getReportKind,
  getReportStatusFilter,
  getUserStatusFilter,
  isModerationId,
  STUDENT_REPORT_REASONS,
} from "../src/features/moderation/rules.ts";

test("student reporting accepts only the controlled reasons", () => {
  assert.deepEqual(STUDENT_REPORT_REASONS, [
    "scam", "harassment", "abusive_behavior", "impersonation",
    "unsafe_meetup", "spam", "other",
  ]);
});

test("moderation filters fail closed to useful defaults", () => {
  assert.equal(getUserStatusFilter("suspended"), "suspended");
  assert.equal(getUserStatusFilter("forged"), "all");
  assert.equal(getListingStatusFilter("removed"), "removed");
  assert.equal(getListingStatusFilter("forged"), "all");
  assert.equal(getReportStatusFilter("resolved"), "resolved");
  assert.equal(getReportStatusFilter("forged"), "open");
  assert.equal(getReportStatusFilter("open"), "open");
  assert.equal(getReportKind("student"), "student");
  assert.equal(getReportKind("anything"), "listing");
});

test("admin pagination is bounded and URLs encode filters", () => {
  assert.equal(ADMIN_PAGE_SIZE, 20);
  assert.equal(getAdminPage(["2", "3"]), 2);
  for (const input of [undefined, "0", "-1", "1.5", "1001", "9999999999", " 2 "]) {
    assert.equal(getAdminPage(input), 1);
  }
  assert.equal(getAdminPageCount(0), 1);
  assert.equal(getAdminPageCount(21), 2);
  assert.equal(getAdminPageHref("reports", 2, { kind: "student", status: "pending" }),
    "/admin/reports?kind=student&status=pending&page=2");
  assert.equal(getAdminPageHref("users", Infinity), "/admin/users");
});

test("moderation identifiers and searches reject path/filter injection", () => {
  assert.equal(isModerationId("11111111-1111-4111-8111-111111111111"), true);
  for (const id of ["../admin", "javascript:alert(1)", "11111111-1111-4111-8111-111111111111?x=1"]) {
    assert.equal(isModerationId(id), false);
  }
  assert.equal(getAdminSearch("  A%_\\,B  "), "AB");
  assert.equal(getAdminSearch("x".repeat(100)).length, 80);
});
