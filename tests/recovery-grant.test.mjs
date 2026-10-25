import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server.js";

const fixtureKey = Symbol.for("uc-marketplace.recovery-grant.fixture");
const mockUrl = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const mocks = {
      "server-only": "export {};",
      "next/headers": `export async function cookies() { return globalThis[Symbol.for("uc-marketplace.recovery-grant.fixture")].cookies; }`,
      "@/lib/supabase/server": `export async function createClient() { return globalThis[Symbol.for("uc-marketplace.recovery-grant.fixture")].supabase; }`,
    };
    if (specifier in mocks) return { url: mockUrl(mocks[specifier]), shortCircuit: true };
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});

const grants = await import("../src/lib/auth/recovery-grant.ts");
const guards = await import("../src/lib/auth/server.ts");
const { GET, HEAD: recoveryHead } = await import("../src/app/auth/recovery/route.ts");
const { GET: confirmEmail, HEAD: confirmationHead } = await import("../src/app/auth/confirm/route.ts");
const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const secret = randomBytes(32).toString("hex");
const now = Date.UTC(2026, 9, 12, 0, 0, 0);
const options = { secret, now };
const claims = (method = "otp", patch = {}) => ({ sub: userId, session_id: sessionId, amr: [{ method }], ...patch });

function signPayload(payload) {
  const encoded = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", Buffer.from(secret, "hex")).update(encoded).digest("base64url")}`;
}

const payload = (patch = {}) => ({ version: 1, purpose: "password_recovery", userId, sessionId, issuedAt: now / 1000, expiresAt: now / 1000 + 900, ...patch });

test("real recovery grant binds its signature to a canonical user, session, purpose, and fixed lifetime", () => {
  const marker = grants.issueRecoveryGrant(userId, sessionId, options);
  assert.equal(typeof marker, "string");
  assert.deepEqual(JSON.parse(Buffer.from(marker.split(".")[0], "base64url").toString()), payload());
  assert.equal(grants.verifyRecoveryGrant(marker, userId, sessionId, options), true);
  assert.equal(grants.verifyRecoveryGrant(marker, otherId, sessionId, options), false);
  assert.equal(grants.verifyRecoveryGrant(marker, userId, otherId, options), false);
  assert.equal(grants.verifyRecoveryGrant(marker, userId, sessionId, { ...options, secret: randomBytes(32).toString("hex") }), false);
});

test("recovery grants reject signature tampering, alternate encodings, unbounded inputs, and plain cookies", () => {
  const marker = grants.issueRecoveryGrant(userId, sessionId, options);
  const [encoded, signature] = marker.split(".");
  const replacement = signature[0] === "a" ? "b" : "a";
  for (const value of [
    `${encoded}.${replacement}${signature.slice(1)}`, `${encoded}A.${signature}`,
    `${encoded}.${signature}=`, `${marker}.extra`, marker.replace(".", ".."),
    `${userId}:${sessionId}`, "x".repeat(1025), null, {}, [], "",
  ]) assert.equal(grants.verifyRecoveryGrant(value, userId, sessionId, options), false);
});

test("recovery grant expiry is fixed at fifteen minutes and future-issued grants fail closed", () => {
  const marker = grants.issueRecoveryGrant(userId, sessionId, options);
  assert.equal(grants.verifyRecoveryGrant(marker, userId, sessionId, { ...options, now: now + 899000 }), true);
  assert.equal(grants.verifyRecoveryGrant(marker, userId, sessionId, { ...options, now: now + 900000 }), false);
  assert.equal(grants.verifyRecoveryGrant(marker, userId, sessionId, { ...options, now: now - 1000 }), false);
  for (const patch of [{ expiresAt: now / 1000 + 901 }, { expiresAt: now / 1000 }, { issuedAt: now / 1000 + 1 }, { issuedAt: "now" }, { expiresAt: Number.MAX_SAFE_INTEGER }]) {
    assert.equal(grants.verifyRecoveryGrant(signPayload(payload(patch)), userId, sessionId, options), false);
  }
});

test("signed grants reject a wrong purpose/version, duplicate or extra fields, and noncanonical JSON", () => {
  for (const value of [payload({ purpose: "login" }), payload({ version: 2 }), payload({ role: "admin" }),
    JSON.stringify(payload(), null, 2), JSON.stringify(payload()).replace('"version":1', '"version":1,"version":1'),
    { ...payload(), userId: otherId },
  ]) assert.equal(grants.verifyRecoveryGrant(signPayload(value), userId, sessionId, options), false);
});

test("missing and short/non-hex recovery secrets never mint or accept a signed grant", () => {
  const marker = grants.issueRecoveryGrant(userId, sessionId, options);
  for (const value of ["", "weak", "a".repeat(32), "g".repeat(64), "a".repeat(63), "a".repeat(130)]) {
    assert.equal(grants.hasRecoveryGrantSecret(value), false);
    assert.equal(grants.issueRecoveryGrant(userId, sessionId, { ...options, secret: value }), null);
    assert.equal(grants.verifyRecoveryGrant(marker, userId, sessionId, { ...options, secret: value }), false);
  }
  assert.equal(grants.issueRecoveryGrant("unbounded-user", sessionId, options), null);
  assert.equal(grants.issueRecoveryGrant(userId, "unbounded-session", options), null);
});

test("callback parsing rejects duplicate keys, mixed flows, wrong types, and invalid opaque values", () => {
  const hash = "a".repeat(64);
  assert.deepEqual(grants.parseRecoveryCallback(new URLSearchParams({ token_hash: hash, type: "recovery" })), { kind: "token_hash", tokenHash: hash });
  assert.deepEqual(grants.parseRecoveryCallback(new URLSearchParams({ code: "code-123", sb_flow_id: "flow-123" })), { kind: "pkce", code: "code-123", flowId: "flow-123" });
  for (const query of [
    `token_hash=${hash}&type=recovery&type=recovery`, `token_hash=${hash}&type=recovery&code=code-123`,
    `token_hash=${hash}&type=recovery&token_hash=${hash}`, `code=code-123&code=code-456`,
    `code=code-123&next=a&next=b`, `token_hash=${hash}`, `token_hash=${hash}&type=email`,
    `token_hash=${hash}&type=recovery&sb_flow_id=flow`, "code=code-123&type=signup",
    `token_hash=${hash}&type=recovery&token=${hash}`, "code=code-123&token=ignored", "token=ignored&type=recovery",
    "code=&type=recovery", "code=code-123&sb_flow_id=invalid%20flow", "code=code%0A123", "",
  ]) assert.equal(grants.parseRecoveryCallback(new URLSearchParams(query)), null);
});

test("direct OTP callback provenance permits OTP claims while PKCE still strictly requires recovery", () => {
  assert.deepEqual(grants.getRecoverySessionIdentity(claims(), userId, "token_hash"), { userId, sessionId });
  assert.equal(grants.getRecoverySessionIdentity(claims(), userId, "pkce"), null);
  assert.deepEqual(grants.getRecoverySessionIdentity(claims("recovery"), userId, "pkce"), { userId, sessionId });
  for (const value of [claims("password"), claims("otp", { sub: otherId }), claims("otp", { session_id: "invalid" }), claims("otp", { amr: [] }), null]) {
    assert.equal(grants.getRecoverySessionIdentity(value, userId, "token_hash"), null);
  }
  assert.equal(guards.hasRecoveryAuthenticationMethod(claims()), false);
  assert.equal(guards.hasRecoveryAuthenticationMethod(claims("recovery")), true);
});

function installFixture({ marker, method = "otp", authError = null, claimPatch = {}, liveUserId = userId, exchangeUserId = userId, exchangeError = null, exchangeThrows = false, signOutError = null, emptySession = false } = {}) {
  const calls = [];
  const values = new Map(marker ? [[guards.RECOVERY_COOKIE_NAME, marker]] : []);
  const fixture = {
    calls, values,
    cookies: {
      get(name) { return values.has(name) ? { value: values.get(name) } : undefined; },
      set(name, value, options) { calls.push(["set", name, options]); values.set(name, value); },
      delete(name) { calls.push(["delete", name]); values.delete(name); },
    },
    supabase: { auth: {
      async verifyOtp(parameters) { calls.push(["verifyOtp", parameters]); if (exchangeThrows) throw new Error("private token response"); return { data: { user: emptySession ? null : { id: exchangeUserId }, session: emptySession ? null : {} }, error: exchangeError }; },
      async exchangeCodeForSession(code, options) { calls.push(["exchangeCodeForSession", code, options]); return { data: { user: { id: exchangeUserId }, session: {} }, error: exchangeError }; },
      async getClaims() { calls.push(["getClaims"]); return { data: { claims: claims(method, claimPatch) }, error: authError }; },
      async getUser() { calls.push(["getUser"]); return { data: { user: liveUserId ? { id: liveUserId } : null }, error: authError }; },
      async signOut(parameters) { calls.push(["signOut", parameters]); return { error: signOutError }; },
    } },
  };
  globalThis[fixtureKey] = fixture;
  return fixture;
}

async function withSecret(value, operation) {
  const previous = process.env.AUTH_RECOVERY_SECRET;
  if (value === undefined) delete process.env.AUTH_RECOVERY_SECRET;
  else process.env.AUTH_RECOVERY_SECRET = value;
  try { return await operation(); }
  finally {
    if (previous === undefined) delete process.env.AUTH_RECOVERY_SECRET;
    else process.env.AUTH_RECOVERY_SECRET = previous;
  }
}

function request(query, origin = "http://127.0.0.1:3106", pathname = "/auth/recovery") {
  return new NextRequest(`${origin}${pathname}?${query}`);
}

test("real marker guard accepts signed OTP only for its matching live session", async () => {
  await withSecret(secret, async () => {
    const marker = grants.issueRecoveryGrant(userId, sessionId);
    installFixture({ marker });
    assert.equal(await guards.hasRecoveryMarker(userId), true);
    for (const change of [{ method: "password" }, { claimPatch: { sub: otherId } }, { claimPatch: { session_id: otherId } }, { authError: { code: "session_not_found" } }]) {
      installFixture({ marker, ...change });
      assert.equal(await guards.hasRecoveryMarker(userId), false);
    }
    installFixture({ marker: `${userId}:${sessionId}` });
    assert.equal(await guards.hasRecoveryMarker(userId), false);
    installFixture({ marker: `${userId}:${sessionId}`, method: "recovery" });
    assert.equal(await guards.hasRecoveryMarker(userId), false);
  });
});

test("all unsigned legacy markers and missing-secret signed markers fail closed", async () => {
  const marker = grants.issueRecoveryGrant(userId, sessionId, { secret });
  await withSecret(undefined, async () => {
    installFixture({ marker });
    assert.equal(await guards.hasRecoveryMarker(userId), false);
    installFixture({ marker: `${userId}:${sessionId}`, method: "recovery" });
    assert.equal(await guards.hasRecoveryMarker(userId), false);
    installFixture({ marker: `${userId}:${sessionId}`, method: "otp" });
    assert.equal(await guards.hasRecoveryMarker(userId), false);
  });
});

test("actual direct recovery route signs a grant only after typed OTP verification and matching live Auth", async () => {
  await withSecret(secret, async () => {
    const fixture = installFixture();
    const response = await GET(request(`token_hash=${"a".repeat(64)}&type=recovery`));
    assert.equal(response.headers.get("location"), "/reset-password");
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    const marker = fixture.values.get(guards.RECOVERY_COOKIE_NAME);
    assert.equal(grants.verifyRecoveryGrant(marker, userId, sessionId, { secret }), true);
    assert.deepEqual(fixture.calls[0], ["verifyOtp", { token_hash: "a".repeat(64), type: "recovery" }]);
    assert.ok(fixture.calls.findIndex(([name]) => name === "getClaims") < fixture.calls.findIndex(([name]) => name === "set"));
    assert.ok(fixture.calls.findIndex(([name]) => name === "getUser") < fixture.calls.findIndex(([name]) => name === "set"));
    const cookie = fixture.calls.find(([name]) => name === "set")[2];
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "lax");
    assert.equal(cookie.maxAge, 900);
  });
});

test("both recovery routes refuse missing/short secret before consuming a token or code", async () => {
  for (const value of [undefined, "weak"]) await withSecret(value, async () => {
    for (const query of [`token_hash=${"a".repeat(64)}&type=recovery`, "code=pkce-code"]) {
      const fixture = installFixture();
      const response = await GET(request(query));
      assert.equal(response.headers.get("location"), "/reset-password?error=invalid");
      assert.equal(fixture.calls.some(([name]) => ["verifyOtp", "exchangeCodeForSession", "set"].includes(name)), false);
    }
  });
});

test("ambiguous or wrong-type callbacks never call Auth or mint a grant", async () => {
  await withSecret(secret, async () => {
    for (const query of [`token_hash=${"a".repeat(64)}&type=recovery&code=code`, "code=code&type=signup", "code=code&code=other", `token_hash=${"a".repeat(64)}&type=email`, "code=code&token=ignored", `token_hash=${"a".repeat(64)}&type=recovery&token=ignored`]) {
      const fixture = installFixture();
      const response = await GET(request(query));
      assert.match(response.headers.get("location"), /error=invalid$/);
      assert.deepEqual(fixture.calls, []);
    }
  });
});

test("successful token exchange cannot mint a grant from mismatched users, sessions, or methods", async () => {
  await withSecret(secret, async () => {
    for (const patch of [{ liveUserId: otherId }, { exchangeUserId: otherId }, { claimPatch: { sub: otherId } }, { claimPatch: { session_id: "not-a-session" } }, { method: "password" }, { authError: { code: "unexpected_failure" } }]) {
      const fixture = installFixture(patch);
      const response = await GET(request(`token_hash=${"a".repeat(64)}&type=recovery`));
      assert.match(response.headers.get("location"), /error=invalid$/);
      assert.equal(fixture.calls.some(([name]) => name === "set"), false);
      assert.equal(fixture.calls.some(([name]) => name === "signOut"), true);
    }
  });
});

test("failed/replayed typed recovery token never mints an app grant", async () => {
  await withSecret(secret, async () => {
    for (const patch of [{ exchangeError: { code: "otp_expired" } }, { exchangeThrows: true }]) {
      const fixture = installFixture(patch);
      const response = await GET(request(`token_hash=${"a".repeat(64)}&type=recovery`));
      assert.match(response.headers.get("location"), /error=invalid$/);
      assert.equal(fixture.calls.some(([name]) => ["set", "getClaims", "getUser"].includes(name)), false);
    }
  });
});

test("PKCE route issues signed grants and keeps its strict recovery AMR requirement", async () => {
  await withSecret(secret, async () => {
    const fixture = installFixture({ method: "recovery" });
    const response = await GET(request("code=pkce-code&sb_flow_id=flow-123"));
    assert.equal(response.headers.get("location"), "/reset-password");
    assert.equal(grants.verifyRecoveryGrant(fixture.values.get(guards.RECOVERY_COOKIE_NAME), userId, sessionId, { secret }), true);
    assert.deepEqual(fixture.calls[0], ["exchangeCodeForSession", "pkce-code", { flowId: "flow-123" }]);
    const ordinaryOtp = installFixture({ method: "otp" });
    assert.match((await GET(request("code=pkce-code"))).headers.get("location"), /error=invalid$/);
    assert.equal(ordinaryOtp.calls.some(([name]) => name === "set"), false);
  });
});

test("installed NextRequest loopback normalization cannot move a successful recovery callback's browser origin", async () => {
  await withSecret(secret, async () => {
    const browserOrigin = "http://127.0.0.1:3106";
    const fixture = installFixture();
    const callback = request(`token_hash=${"a".repeat(64)}&type=recovery`, browserOrigin);
    assert.equal(callback.nextUrl.hostname, "localhost", "The installed NextURL normalizes the request host before route code runs");
    const response = await GET(callback);
    assert.equal(response instanceof NextResponse, true);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/reset-password");
    assert.equal(new URL(response.headers.get("location"), browserOrigin).origin, browserOrigin);
    assert.equal(grants.verifyRecoveryGrant(fixture.values.get(guards.RECOVERY_COOKIE_NAME), userId, sessionId, { secret }), true);
  });
});

test("recovery redirect destinations are fixed relative paths across origins and ignore callback redirect hints", async () => {
  await withSecret(secret, async () => {
    for (const origin of ["http://127.0.0.1:3106", "http://localhost:3106", "http://[::1]:3106", "https://marketplace.example.test"]) {
      for (const [patch, expected] of [[{}, "/reset-password"], [{ exchangeError: { code: "otp_expired" } }, "/reset-password?error=invalid"]]) {
        installFixture(patch);
        const callback = request(`token_hash=${"a".repeat(64)}&type=recovery&next=https%3A%2F%2Fattacker.invalid%2Fprivate&redirect_to=%2F%2Fattacker.invalid`, origin);
        callback.headers.set("x-forwarded-host", "attacker.invalid");
        callback.headers.set("host", "attacker.invalid");
        const response = await GET(callback);
        assert.equal(response.status, 307);
        assert.equal(response.headers.get("location"), expected);
        assert.equal(new URL(response.headers.get("location"), origin).origin, origin);
        assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
        assert.doesNotMatch(response.headers.get("location"), /attacker|token_hash|redirect_to/);
      }
    }
  });
});

test("confirmation success keeps the browser origin and signs out the temporary email session", async () => {
  for (const origin of ["http://127.0.0.1:3106", "http://localhost:3106", "http://[::1]:3106", "https://marketplace.example.test"]) {
    for (const query of [`token_hash=${"a".repeat(64)}&type=email`, `token_hash=${"a".repeat(64)}&type=signup`, "code=pkce-code"]) {
      const fixture = installFixture();
      const callback = request(`${query}&next=https%3A%2F%2Fattacker.invalid%2Fprivate`, origin, "/auth/confirm");
      callback.headers.set("x-forwarded-host", "attacker.invalid");
      const response = await confirmEmail(callback);
      assert.equal(response instanceof NextResponse, true);
      assert.equal(response.status, 307);
      assert.equal(response.headers.get("location"), "/login?confirmation=success");
      assert.equal(new URL(response.headers.get("location"), origin).origin, origin);
      assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
      assert.equal(fixture.calls.filter(([name]) => name === "signOut").length, 1);
      assert.deepEqual(fixture.calls.find(([name]) => name === "signOut"), ["signOut", { scope: "local" }]);
      assert.equal(fixture.calls.some(([name]) => name === "set"), false);
    }
  }
});

test("confirmation errors, recovery claims and signout failure retain a fixed same-origin failure destination", async () => {
  for (const patch of [
    { exchangeError: { code: "otp_expired" } }, { exchangeThrows: true }, { authError: { code: "unexpected_failure" } },
    { method: "recovery" }, { claimPatch: { sub: null } }, { signOutError: { code: "unexpected_failure" } },
  ]) {
    const fixture = installFixture(patch);
    const response = await confirmEmail(request(`token_hash=${"a".repeat(64)}&type=email`, "http://127.0.0.1:3106", "/auth/confirm"));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/login?confirmation=failed");
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(fixture.calls.some(([name]) => name === "set"), false);
  }
  const fixture = installFixture();
  const response = await confirmEmail(request(`token_hash=${"a".repeat(64)}&type=recovery`, "http://127.0.0.1:3106", "/auth/confirm"));
  assert.equal(response.headers.get("location"), "/login?confirmation=failed");
  assert.equal(fixture.calls.some(([name]) => ["verifyOtp", "exchangeCodeForSession", "getClaims", "set"].includes(name)), false);
});

test("confirmation rejects duplicate, mixed, malformed and error-bearing callback credentials before Auth", async () => {
  const hash = "a".repeat(64);
  for (const query of [`token_hash=${hash}&type=email&code=code`, `token_hash=${hash}&type=email&type=signup`,
    `token_hash=${hash}&type=email&token=other`, `token_hash=${hash}&type=email&error=expired`,
    "code=one&code=two", "code=code&type=recovery", "code=code&error_code=otp_expired", "code=code%0A", "token_hash=short&type=email", ""]) {
    const fixture = installFixture();
    const response = await confirmEmail(request(query, undefined, "/auth/confirm"));
    assert.equal(response.headers.get("location"), "/login?confirmation=failed");
    assert.deepEqual(fixture.calls, []);
  }
});

test("both callback HEAD handlers never consume one-use tokens or create sessions", () => {
  for (const operation of [confirmationHead, recoveryHead]) {
    const fixture = installFixture();
    const response = operation();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.deepEqual(fixture.calls, []);
  }
});

test("error-bearing recovery callbacks cannot consume credentials or mint grants", async () => {
  await withSecret(secret, async () => {
    for (const parameter of ["error", "error_code", "error_description"]) {
      const fixture = installFixture();
      const response = await GET(request(`token_hash=${"a".repeat(64)}&type=recovery&${parameter}=expired`));
      assert.match(response.headers.get("location"), /error=invalid$/);
      assert.deepEqual(fixture.calls, []);
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    }
  });
});

test("typed email-change confirmation does not mint recovery privileges", async () => {
  const fixture = installFixture();
  const response = await confirmEmail(request(`token_hash=${"a".repeat(64)}&type=email_change`, undefined, "/auth/confirm"));
  assert.equal(response.headers.get("location"), "/login?confirmation=success");
  assert.equal(fixture.calls[0][1].type, "email_change");
  assert.equal(fixture.calls.some(([name]) => name === "set"), false);
});

test("first secure email-change confirmation waits for the other inbox without touching an existing session", async () => {
  const fixture = installFixture({ emptySession: true });
  const response = await confirmEmail(request(`token_hash=${"a".repeat(64)}&type=email_change`, undefined, "/auth/confirm"));
  assert.equal(response.headers.get("location"), "/login?confirmation=pending");
  assert.deepEqual(fixture.calls.map(([name]) => name), ["verifyOtp"]);
});

test("confirmation cannot report success for a missing session or mismatched exchange user", async () => {
  for (const patch of [{ emptySession: true }, { exchangeUserId: otherId }]) {
    const fixture = installFixture(patch);
    const response = await confirmEmail(request(`token_hash=${"a".repeat(64)}&type=email`, undefined, "/auth/confirm"));
    assert.equal(response.headers.get("location"), "/login?confirmation=failed");
    assert.equal(fixture.calls.some(([name]) => name === "set"), false);
  }
});
