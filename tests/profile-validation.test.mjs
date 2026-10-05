import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import {
  canEditProfileIdentity, canEditProfileYear, formatProfileJoined,
  getAvatarFileError, isOwnedAvatarPath, MAX_AVATAR_BYTES,
} from "../src/features/profiles/rules.ts";
import { hasMatchingListingImageSignature } from "../src/features/listings/validation.ts";

// The application uses Next's @/ alias; resolve its pure validation modules in
// Node too, so password tests exercise the same rules as registration/reset.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { profileDetailsSchema, changePasswordSchema } = await import("../src/features/profiles/validation.ts");
const { passwordSchema } = await import("../src/lib/auth/validation.ts");
const version = "2026-10-06T10:00:00.123456+00:00";
const userId = "11111111-1111-4111-8111-111111111111";

test("profile edits reject empty names, unknown courses, invalid years, and missing versions", () => {
  const values = { fullName: "  Maria Santos  ", course: "BSIT", yearLevel: "4", updatedAt: version };
  assert.deepEqual(profileDetailsSchema.parse(values), { ...values, fullName: "Maria Santos", yearLevel: 4 });
  for (const changed of [
    { fullName: "   " }, { fullName: "x".repeat(101) }, { course: "ADMIN" },
    { yearLevel: "0" }, { yearLevel: "6" }, { yearLevel: "1.5" }, { yearLevel: "abc" },
    { updatedAt: undefined }, { updatedAt: "not-a-time" },
  ]) assert.equal(profileDetailsSchema.safeParse({ ...values, ...changed }).success, false);
  assert.equal(profileDetailsSchema.safeParse({ yearLevel: "5", updatedAt: version }).success, true);
});

test("reviewed identity and pending-year permissions fail closed", () => {
  for (const accountStatus of ["active", "suspended", "disabled"]) {
    for (const verificationStatus of ["unverified", "pending", "verified", "rejected"]) {
      const profile = { role: "student", account_status: accountStatus, verification_status: verificationStatus };
      assert.equal(canEditProfileIdentity(profile), accountStatus === "active" && ["unverified", "rejected"].includes(verificationStatus));
      assert.equal(canEditProfileYear(profile), accountStatus === "active" && verificationStatus !== "pending");
    }
  }
});

test("password changes share registration strength rules and require confirmation/current password", () => {
  const values = { currentPassword: "Current-password-1", password: "New-password-2026!", confirmPassword: "New-password-2026!" };
  assert.equal(changePasswordSchema.safeParse(values).success, true);
  for (const password of ["shortA1!", "lowercase123!", "UPPERCASE123!", "NoDigitsHere!", "NoSymbols1234", "A".repeat(257)]) {
    assert.equal(passwordSchema.safeParse(password).success, false);
    assert.equal(changePasswordSchema.safeParse({ ...values, password, confirmPassword: password }).success, false);
  }
  assert.equal(changePasswordSchema.safeParse({ ...values, currentPassword: "" }).success, false);
  assert.equal(changePasswordSchema.safeParse({ ...values, confirmPassword: "Different-password-2026!" }).success, false);
  assert.equal(changePasswordSchema.safeParse({ ...values, nonce: "12345678" }).success, true);
  assert.equal(changePasswordSchema.safeParse({ ...values, nonce: "not-a-code" }).success, false);
});

test("avatar upload rejects non-images, empty files, and oversized files", () => {
  assert.equal(getAvatarFileError({ type: "image/png", size: MAX_AVATAR_BYTES }), null);
  for (const file of [
    { type: "image/svg+xml", size: 12 }, { type: "application/pdf", size: 12 },
    { type: "image/jpeg", size: 0 }, { type: "image/webp", size: MAX_AVATAR_BYTES + 1 },
  ]) assert.equal(typeof getAvatarFileError(file), "string");
});

test("claimed image type alone cannot pass avatar signature validation", async () => {
  const disguised = new File(["<svg><script>bad()</script></svg>"], "photo.png", { type: "image/png" });
  assert.equal(await hasMatchingListingImageSignature(disguised), false);
  const png = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], "photo.png", { type: "image/png" });
  assert.equal(await hasMatchingListingImageSignature(png), true);
});

test("avatar URLs and cleanup accept only exact owned avatar paths", () => {
  assert.equal(isOwnedAvatarPath(userId, `${userId}/avatar.png`), true);
  assert.equal(isOwnedAvatarPath(userId, `${userId}/22222222-2222-4222-8222-222222222222.webp`), true);
  for (const path of [
    "22222222-2222-4222-8222-222222222222/avatar.png", `${userId}/../avatar.png`,
    `${userId}/school-id.png`, `${userId}/nested/avatar.png`, `${userId}/avatar.svg`,
    `${userId}/avatar.png?token=secret`, `student-verifications/${userId}/avatar.png`,
    `${userId}/AVATAR.PNG`, `${userId}/22222222-2222-4222-8222-222222222222.jpeg`,
  ]) assert.equal(isOwnedAvatarPath(userId, path), false);
});

test("joined dates use the campus timezone without storing formatted values", () => {
  assert.equal(formatProfileJoined("2026-09-30T17:00:00Z"), "October 2026");
  assert.equal(formatProfileJoined("invalid"), null);
});
