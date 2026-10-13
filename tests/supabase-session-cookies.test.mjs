import assert from "node:assert/strict";
import test from "node:test";
import { createChunks, createServerClient, stringToBase64URL } from "@supabase/ssr";
import { filterSupabaseSessionCookies } from "../src/lib/supabase/session-cookies.ts";

const url = "https://isolatedfixture.supabase.co";
const key = "sb-isolatedfixture-auth-token";
const session = { access_token: "synthetic-access-credential", refresh_token: "synthetic-refresh-credential", expires_at: 1, user: { id: "untrusted-id", role: "admin" } };
const encode = (value) => `base64-${stringToBase64URL(JSON.stringify(value))}`;

test("structurally complete expired credentials are preserved unchanged, without trusting cookie identity", async () => {
  for (const value of [encode(session), JSON.stringify(session)]) {
    const cookies = [{ name: key, value }, { name: "theme", value: "dark" }];
    const result = await filterSupabaseSessionCookies(cookies, url);
    assert.deepEqual(result.cookies, cookies);
    assert.deepEqual(result.removedCookieNames, []);
  }
});

test("empty, absent, non-string access/refresh tokens and unusable expiry shapes are screened", async () => {
  for (const malformed of [
    ...["", "   ", null, false, 1, {}, []].map((refresh_token) => ({ ...session, refresh_token })),
    ...["", "   ", null, true, 2, {}, []].map((access_token) => ({ ...session, access_token })),
    ...[null, "1", {}, []].map((expires_at) => ({ ...session, expires_at })),
    { access_token: session.access_token, expires_at: 1 },
    { refresh_token: session.refresh_token, expires_at: 1 },
    null, [], "session", 5,
  ]) {
    const result = await filterSupabaseSessionCookies([{ name: key, value: encode(malformed) }], url);
    assert.deepEqual(result.cookies, []);
    assert.deepEqual(result.removedCookieNames, [key]);
  }
});

test("malformed base64, invalid JSON and missing/truncated chunks are screened quietly", async () => {
  for (const cookies of [
    [{ name: key, value: "not-a-session" }],
    [{ name: key, value: "base64-***" }],
    [{ name: key, value: "base64-" }],
    [{ name: `${key}.1`, value: encode(session) }],
    [{ name: `${key}.0`, value: encode(session).slice(0, 40) }, { name: `${key}.2`, value: "orphan" }],
  ]) {
    const result = await filterSupabaseSessionCookies(cookies, url);
    assert.deepEqual(result.cookies, []);
    assert.deepEqual(result.removedCookieNames, cookies.map((cookie) => cookie.name));
  }
});

test("SSR's own chunk algorithm preserves valid sessions and screens invalid chunked refresh credentials", async () => {
  for (const refresh_token of [session.refresh_token, "", null]) {
    const chunks = createChunks(key, encode({ ...session, refresh_token }), 55).reverse();
    assert.ok(chunks.length > 1);
    const result = await filterSupabaseSessionCookies(chunks, url);
    assert.deepEqual(result.cookies, refresh_token ? chunks : []);
    assert.deepEqual(result.removedCookieNames, refresh_token ? [] : chunks.map((cookie) => cookie.name));
  }
});

test("only exact project session names are removed; verifier, flow, other-project and lookalike cookies survive", async () => {
  const unrelated = [
    { name: "theme", value: "dark" },
    { name: "sb-other-auth-token", value: "malformed" },
    { name: `${key}-code-verifier`, value: "PKCE-state" },
    { name: `${key}-code-verifier.0`, value: "PKCE-part" },
    { name: `${key}-flow-abc-code-verifier`, value: "flow-state" },
    { name: `${key}.00`, value: "not-an-SSR-chunk" },
    { name: `${key}.suffix`, value: "not-an-SSR-chunk" },
    { name: `${key}-user`, value: "user-storage" },
  ];
  const result = await filterSupabaseSessionCookies([{ name: key, value: encode({ ...session, refresh_token: "" }) }, ...unrelated], url);
  assert.deepEqual(result.cookies, unrelated);
  assert.deepEqual(result.removedCookieNames, [key]);
  assert.deepEqual((await filterSupabaseSessionCookies(unrelated, url)).removedCookieNames, []);
});

test("base-cookie precedence matches SSR when leftover chunks are present", async () => {
  const cookies = [{ name: key, value: encode(session) }, { name: `${key}.0`, value: "stale-chunk" }];
  assert.deepEqual((await filterSupabaseSessionCookies(cookies, url)).cookies, cookies);
});

test("actual SSR SDK handles screened expired cookies without detached rejection or Auth network calls", async () => {
  let networkCalls = 0;
  const cookies = createChunks(key, encode({ ...session, refresh_token: "" }), 55);
  const filtered = await filterSupabaseSessionCookies(cookies, url);
  const client = createServerClient(url, "sb_publishable_syntheticfixture", {
    global: { fetch: async () => { networkCalls += 1; throw new Error("Malformed cookies must not reach Auth."); } },
    cookies: { getAll: () => filtered.cookies, setAll: () => {} },
  });
  const result = await client.auth.getClaims();
  assert.equal(result.data, null);
  assert.equal(networkCalls, 0);
  // Give the SDK's detached INITIAL_SESSION subscriber an event-loop turn.
  // Node's test runner fails on unhandled rejections rather than hiding them.
  await new Promise((resolve) => setImmediate(resolve));
  await client.auth.stopAutoRefresh();
  await client.removeAllChannels();
});
