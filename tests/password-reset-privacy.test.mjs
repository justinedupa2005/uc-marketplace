import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const fixtureKey = Symbol.for("uc-marketplace.reset-privacy.fixture");
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  if (specifier === "@/lib/supabase/server") return { url: `data:text/javascript,${encodeURIComponent('export async function createClient() { return globalThis[Symbol.for("uc-marketplace.reset-privacy.fixture")].client; }')}`, shortCircuit: true };
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const { requestPasswordReset } = await import("../src/app/(public)/forgot-password/actions.ts");
const { passwordSchema } = await import("../src/lib/auth/validation.ts");

test("valid reset requests never disclose account existence through throttles, outages or SDK failures", async () => {
  const previousOrigin = process.env.NEXT_PUBLIC_APP_URL;
  const originalLog = console.error;
  const logs = [];
  console.error = (...values) => logs.push(values);
  const initial = { status: "idle", message: null };
  let expected;
  try {
    for (const origin of ["https://uc-online-shop.vercel.app", "https://uc-online-shop-staging.vercel.app"]) {
      process.env.NEXT_PUBLIC_APP_URL = origin;
      for (const error of [null, { code: "user_not_found", status: 404 }, { code: "over_email_send_rate_limit", status: 429 },
        { code: "over_request_rate_limit", status: 429 }, { code: "request_timeout", status: 0 },
        { code: "private-email@example.test", status: 500 }, "throw"]) {
        const calls = [];
        globalThis[fixtureKey] = { client: { auth: { async resetPasswordForEmail(email, options) {
          calls.push([email, options]);
          if (error === "throw") throw new Error("private-provider-password");
          return { data: {}, error };
        } } } };
        const form = new FormData();
        form.set("email", " Person@Example.test ");
        const result = await requestPasswordReset(initial, form);
        expected ??= result;
        assert.deepEqual(result, expected);
        assert.equal(result.status, "success");
        assert.match(result.message, /If an account exists/);
        assert.deepEqual(calls, [["person@example.test", { redirectTo: `${origin}/auth/recovery` }]]);
      }
    }
    assert.doesNotMatch(JSON.stringify(logs), /person@|private-email|private-provider-password/);
  } finally {
    console.error = originalLog;
    if (previousOrigin === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previousOrigin;
    delete globalThis[fixtureKey];
  }
});

test("malformed email input is rejected locally without calling Auth", async () => {
  globalThis[fixtureKey] = { client: { auth: { resetPasswordForEmail() { assert.fail("No Auth call expected"); } } } };
  const form = new FormData();
  form.set("email", "not-an-email");
  assert.equal((await requestPasswordReset({ status: "idle", message: null }, form)).status, "error");
  delete globalThis[fixtureKey];
});

test("password complexity rejects whitespace-only or unsupported symbols and retains supported punctuation", () => {
  for (const password of ["Upperlower123 ", "Upperlower123\t", "Upperlower123\n", "Upperlower123😀"]) assert.equal(passwordSchema.safeParse(password).success, false);
  for (const symbol of ["!", "@", ":", "\\", "\"", "'", "`", "~", "["]) assert.equal(passwordSchema.safeParse(`Upperlower123${symbol}`).success, true);
});
