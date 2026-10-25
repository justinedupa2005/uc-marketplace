import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
import { authCookieOptions } from "../src/lib/supabase/cookie-options.ts";

test("HTTPS SDK session cookies are Secure, host-only, SameSite=Lax and remain browser-compatible", () => {
  for (const origin of ["https://uc-online-shop-staging.vercel.app", "https://uc-online-shop.vercel.app"]) {
    assert.deepEqual(authCookieOptions(origin), { path: "/", sameSite: "lax", secure: true });
    assert.equal(authCookieOptions(origin).domain, undefined);
    assert.equal(authCookieOptions(origin).httpOnly, undefined);
  }
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:3100"]) assert.equal(authCookieOptions(origin).secure, false);
});

test("actual SSR SDK applies the shared HTTPS cookie options when writing a session", async () => {
  const writes = [];
  const user = { id: "00000000-0000-4000-8000-000000000001", email: "fixture@example.test" };
  const client = createServerClient("https://staging.example.test", "inert-public-test-key", {
    cookieOptions: authCookieOptions("https://uc-online-shop-staging.vercel.app"),
    cookies: { getAll: () => [], setAll: (cookies) => writes.push(...cookies) },
    global: { fetch: async () => new Response(JSON.stringify({ access_token: "inert-fixture-session", refresh_token: "inert-fixture-refresh",
      token_type: "bearer", expires_in: 3600, user }), { status: 200, headers: { "Content-Type": "application/json" } }) },
  });
  const result = await client.auth.signInWithPassword({ email: user.email, password: "inert-fixture-password" });
  assert.equal(result.error, null);
  assert.ok(writes.length > 0);
  for (const cookie of writes) {
    assert.equal(cookie.options.secure, true);
    assert.equal(cookie.options.sameSite, "lax");
    assert.equal(cookie.options.domain, undefined);
  }
});

test("browser, writable SSR and refresh proxy all use the same cookie policy", async () => {
  for (const name of ["client", "server", "proxy"]) {
    const source = await readFile(new URL(`../src/lib/supabase/${name}.ts`, import.meta.url), "utf8");
    assert.match(source, /cookieOptions:\s*authCookieOptions\(\)/);
  }
});
