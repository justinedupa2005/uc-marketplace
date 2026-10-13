import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Exercise the real guards with controlled Auth/database adapters. These tests
// do not claim to exercise Next request caching, cookies, or Supabase RLS.
const fixtureKey = Symbol.for("uc-marketplace.auth-security.fixture");
const mockUrl = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const mocks = {
      "server-only": "export {};",
      react: "export const cache = fn => fn;",
      "next/navigation": `export function redirect(location) { const error = new Error("NEXT_REDIRECT"); error.location = location; throw error; }`,
      "@/lib/auth/server": `const fixture = () => globalThis[Symbol.for("uc-marketplace.auth-security.fixture")]; export async function getValidatedUser() { return fixture().authenticate(); } export async function hasRecoveryMarker() { return fixture().recovery; }`,
    };
    if (specifier in mocks) return { url: mockUrl(mocks[specifier]), shortCircuit: true };
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const guards = await import("../src/lib/auth/authorization.ts");
const { getSafeNextPath, isProtectedPathname } = await import("../src/lib/auth/redirects.ts");
const { registrationSchema, passwordSchema, resetPasswordSchema } = await import("../src/lib/auth/validation.ts");
const id = "11111111-1111-4111-8111-111111111111";
const profile = (role = "student", verification = "verified", account = "active") => ({ role, verification_status: verification, account_status: account });

function installFixture(row, options = {}) {
  const calls = [];
  const supabase = {
    from(table) {
      calls.push(["from", table]);
      return { select(columns) {
        calls.push(["select", columns]);
        return { eq(column, value) {
          calls.push(["eq", column, value]);
          return { async maybeSingle() {
            if (options.databaseThrows) throw new Error("private database diagnostic");
            return { data: row, error: options.databaseError ?? null };
          } };
        } };
      } };
    },
  };
  globalThis[fixtureKey] = {
    recovery: Boolean(options.recovery),
    async authenticate() {
      if (options.authThrows) throw options.authThrows;
      return { supabase, user: options.anonymous ? null : { id }, error: options.authError ?? null };
    },
  };
  return { calls, supabase };
}

async function redirectLocation(run) {
  try { await run(); assert.fail("The operation must redirect before returning protected data."); }
  catch (error) { assert.equal(error.message, "NEXT_REDIRECT"); return error.location; }
}

test("authorization profile parser rejects missing, malformed, and unknown security states", () => {
  for (const value of [null, undefined, "admin", {}, [], { ...profile(), role: "owner" }, { ...profile(), verification_status: "approved" }, { ...profile(), account_status: "enabled" }]) {
    assert.equal(guards.parseAuthorizationProfile(value), null);
  }
  const parsed = guards.parseAuthorizationProfile({ ...profile(), email: "private@example.invalid", access_token: "not-a-token" });
  assert.deepEqual(parsed, profile());
  assert.equal(Object.keys(parsed).length, 3);
});

test("active admin and verified student predicates derive only from database role/state", () => {
  for (const role of ["student", "admin"]) for (const verification of ["unverified", "pending", "verified", "rejected"]) for (const account of ["active", "suspended", "disabled"]) {
    const value = profile(role, verification, account);
    assert.equal(guards.isActiveAdmin(value), role === "admin" && account === "active");
    assert.equal(guards.isVerifiedActiveStudent(value), role === "student" && verification === "verified" && account === "active");
    assert.equal(guards.needsStudentVerification(value), role === "student" && account === "active" && verification !== "verified");
  }
  assert.equal(guards.isActiveAdmin(null), false);
  assert.equal(guards.isVerifiedActiveStudent(null), false);
});

test("destination matrix restricts marketplace and admin access while preserving private account pages", () => {
  const accountPages = ["/profile", "/profile/edit", "/profile/change-password", "/notifications?page=2"];
  for (const role of ["student", "admin"]) for (const verification of ["unverified", "pending", "verified", "rejected"]) for (const account of ["active", "suspended", "disabled"]) {
    const value = profile(role, verification, account);
    const defaultPath = account !== "active" ? "/account-status" : role === "admin" ? "/admin/verifications" : verification !== "verified" ? "/verification" : "/marketplace";
    assert.equal(guards.getAuthorizedDestination(value), defaultPath);
    for (const path of accountPages) assert.equal(guards.getAuthorizedDestination(value, path), path);
    for (const path of ["/marketplace", "/sell", "/messages", "/reservations", "/users/" + id]) {
      assert.equal(guards.getAuthorizedDestination(value, path), role === "student" && verification === "verified" && account === "active" ? path : defaultPath);
    }
    for (const path of ["/admin", "/admin/verifications", "/admin/users", "/admin/listings", "/admin/reports"]) {
      assert.equal(guards.getAuthorizedDestination(value, path), role === "admin" && account === "active" ? path : defaultPath);
    }
  }
  assert.equal(guards.getAuthorizedDestination(null, "/profile"), "/account-status");
  assert.equal(guards.getAuthorizedDestination(profile(), "/administrator"), "/marketplace");
});

test("safe next destinations reject open redirects, encoded separators, fragments, and non-private routes", () => {
  const unsafe = [null, undefined, 1, "", "https://attacker.invalid/", "//attacker.invalid/", "/\\attacker.invalid", "/marketplace#secret", "/login", "/auth/recovery", "/administer", "/profilex", "/marketplace/../../login", "/marketplace\n", "/marketplace%2f..", "/marketplace%252F..", "/marketplace%255c..", "/marketplace?" + "x".repeat(2049)];
  for (const value of unsafe) assert.equal(getSafeNextPath(value, ""), "", String(value));
  for (const value of ["/marketplace?search=calculator&condition=good", "/admin/reports?page=2", "/users/" + id, "/profile/change-password", "/messages/" + id]) assert.equal(getSafeNextPath(value), value);
  assert.equal(getSafeNextPath("/marketplace?search=https%3A%2F%2Fattacker.invalid"), "/marketplace?search=https%3A%2F%2Fattacker.invalid");
  assert.equal(getSafeNextPath("/marketplace/../profile"), "/profile");
  for (const root of ["/marketplace", "/favorites", "/reservations", "/sell", "/profile", "/users", "/messages", "/my-listings", "/listing", "/notifications", "/verification", "/admin"]) {
    assert.equal(isProtectedPathname(root), true);
    assert.equal(isProtectedPathname(`${root}/child`), true);
    assert.equal(isProtectedPathname(`${root}-lookalike`), false);
  }
});

test("access context validates the live user's own minimal profile instead of metadata", async () => {
  const fixture = installFixture(profile());
  const result = await guards.getCurrentAccessContext();
  assert.deepEqual(result.profile, profile());
  assert.deepEqual(fixture.calls, [["from", "profiles"], ["select", "role, verification_status, account_status"], ["eq", "id", id]]);
  for (const [row, options, issue] of [[null, {}, "missing"], [{ role: "owner" }, {}, "invalid"], [profile(), { databaseError: { code: "42501" } }, "unavailable"], [profile(), { databaseThrows: true }, "unavailable"]]) {
    installFixture(row, options);
    const unavailable = await guards.getCurrentAccessContext();
    assert.equal(unavailable.profile, null);
    assert.equal(unavailable.profileIssue, issue);
  }
});

test("expired sessions and Auth outages never return an authorized context", async () => {
  installFixture(profile(), { anonymous: true });
  assert.equal(await redirectLocation(() => guards.requireAuthenticatedProfile("/messages")), "/login?next=%2Fmessages");
  installFixture(profile(), { authThrows: { name: "AuthRetryableFetchError", status: 503 } });
  assert.equal(await redirectLocation(() => guards.requireActiveAdmin()), "/login?next=%2Fadmin%2Fverifications&auth=unavailable");
  installFixture(null);
  assert.equal(await redirectLocation(() => guards.requireAuthenticatedProfile()), "/account-status");
});

test("marketplace guards reject admin, unverified, pending, rejected, suspended, and disabled profiles", async () => {
  for (const role of ["student", "admin"]) for (const verification of ["unverified", "pending", "verified", "rejected"]) for (const account of ["active", "suspended", "disabled"]) {
    const value = profile(role, verification, account);
    installFixture(value);
    if (role === "student" && verification === "verified" && account === "active") assert.equal((await guards.requireVerifiedActiveStudent()).user.id, id);
    else assert.equal(await redirectLocation(() => guards.requireVerifiedActiveStudent()), account !== "active" ? "/account-status" : role === "admin" ? "/admin/verifications" : "/verification");
  }
});

test("admin guards reject every student state and every non-active admin", async () => {
  for (const role of ["student", "admin"]) for (const verification of ["unverified", "pending", "verified", "rejected"]) for (const account of ["active", "suspended", "disabled"]) {
    const value = profile(role, verification, account);
    installFixture(value);
    if (role === "admin" && account === "active") {
      assert.equal((await guards.requireActiveAdmin()).user.id, id);
      assert.equal((await guards.getActiveAdmin()).user.id, id);
    } else {
      assert.equal(await guards.getActiveAdmin(), null);
      assert.equal(await redirectLocation(() => guards.requireActiveAdmin()), guards.getAuthorizedDestination(value));
    }
  }
});

test("restricted accounts can read their own account but active mutation guards block them", async () => {
  for (const account of ["suspended", "disabled"]) {
    installFixture(profile("student", "verified", account));
    assert.equal((await guards.requireAuthenticatedProfile()).user.id, id);
    assert.equal(await redirectLocation(() => guards.requireActiveProfile("/profile/edit")), "/account-status");
  }
});

test("recovery sessions cannot reuse ordinary profile, marketplace, or admin guards", async () => {
  for (const value of [profile(), profile("admin")]) {
    installFixture(value, { recovery: true });
    assert.equal(await redirectLocation(() => guards.requireAuthenticatedProfile()), "/reset-password");
    assert.equal(await redirectLocation(() => guards.requireActiveAdmin()), "/reset-password");
    assert.equal(await guards.getActiveAdmin(), null);
    assert.equal(await redirectLocation(() => guards.redirectAuthenticatedUser()), "/reset-password");
  }
});

test("authenticated login/register visitors are sent to their authorized landing page", async () => {
  for (const value of [profile(), profile("admin"), profile("student", "pending"), profile("student", "rejected"), profile("student", "verified", "suspended"), null]) {
    installFixture(value);
    assert.equal(await redirectLocation(() => guards.redirectAuthenticatedUser()), guards.getAuthorizedDestination(value));
  }
  installFixture(null, { anonymous: true });
  assert.equal(await guards.redirectAuthenticatedUser(), undefined);
  installFixture(null, { authThrows: new Error("Auth outage") });
  assert.equal(await guards.redirectAuthenticatedUser(), undefined);
});

test("registration strips privilege metadata and normalizes only allowed student identity values", () => {
  const values = { fullName: "  QA Student  ", studentIdNumber: "qa-1234", course: "BSIT", yearLevel: "3", email: "  QA@EXAMPLE.INVALID  ", password: "Qa-secure-password-2026!", confirmPassword: "Qa-secure-password-2026!", role: "admin", verification_status: "verified", account_status: "active" };
  const parsed = registrationSchema.parse(values);
  assert.equal(parsed.fullName, "QA Student");
  assert.equal(parsed.studentIdNumber, "QA-1234");
  assert.equal(parsed.email, "qa@example.invalid");
  assert.equal(parsed.yearLevel, 3);
  for (const protectedField of ["role", "verification_status", "account_status"]) assert.equal(Object.hasOwn(parsed, protectedField), false);
  for (const patch of [{ studentIdNumber: "QA--1234" }, { studentIdNumber: "-QA1234" }, { studentIdNumber: "QA1234-" }, { course: "ADMIN" }, { yearLevel: 0 }, { yearLevel: 6 }, { yearLevel: 1.5 }, { email: "invalid" }, { fullName: " " }]) assert.equal(registrationSchema.safeParse({ ...values, ...patch }).success, false);
});

test("registration and recovery passwords enforce identical strength and confirmation contracts", () => {
  const strong = "Qa-secure-password-2026!";
  assert.equal(passwordSchema.safeParse(strong).success, true);
  for (const password of ["Short1!", "lowercaseonly123!", "UPPERCASEONLY123!", "NoDigitsHerePlease!", "NoSymbolsHere123", "A".repeat(257)]) {
    assert.equal(passwordSchema.safeParse(password).success, false);
    assert.equal(resetPasswordSchema.safeParse({ password, confirmPassword: password }).success, false);
  }
  assert.equal(resetPasswordSchema.safeParse({ password: strong, confirmPassword: strong }).success, true);
  assert.equal(resetPasswordSchema.safeParse({ password: strong, confirmPassword: "Different-password-2026!" }).success, false);
});
