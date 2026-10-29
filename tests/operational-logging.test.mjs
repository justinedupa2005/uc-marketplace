import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  if (specifier === "./events") return next(new URL("../src/lib/observability/events.ts", import.meta.url).href, context);
  return next(specifier, context);
} });
const { operationalRecord, reportOperationalEvent, routeGroup } = await import("../src/lib/observability/events.ts");
const { observedSupabaseFetch } = await import("../src/lib/observability/supabase-fetch.ts");

test("operational logs allow only known event codes and primitive metadata, never identity/request/error contents", () => {
  const privateValue = "DO_NOT_LOG/student-id/private-message/token?email=private@example.test";
  const record = operationalRecord("reservation_failed", { code: privateValue, status: privateValue, operation: privateValue,
    route: privateValue, method: privateValue, message: privateValue, headers: { authorization: privateValue }, password: privateValue });
  assert.ok(!JSON.stringify(record).includes("DO_NOT_LOG"));
  assert.deepEqual(Object.keys(record), ["schema", "event", "level", "code", "status", "operation", "route", "method"]);
  assert.equal(record.code, "unknown");
  assert.equal(operationalRecord("reservation_failed", { code: "42501", operation: "accept", status: 403 }).code, "42501");
  assert.equal(operationalRecord("server_exception").level, "error");
  assert.equal(routeGroup("/(marketplace)/reservations/[reservationId]"), "reservations");
  assert.equal(routeGroup("/private-student-identity"), "other");
});
test("logging cannot make a successful transaction fail when the output sink is unavailable", () => {
  const original = console.warn;
  try { console.warn = () => { throw new Error("sink unavailable"); }; assert.doesNotThrow(() => reportOperationalEvent("reservation_failed")); }
  finally { console.warn = original; }
});
test("observed Supabase fetch preserves the SDK response without consuming bodies or logging URLs, headers and cookies", async () => {
  const lines = [], original = console.warn;
  try {
    console.warn = value => lines.push(value);
    const response = new Response("private-body", { status: 403 });
    const fetcher = observedSupabaseFetch("https://stage.example.test", async () => response);
    assert.equal(await fetcher("https://stage.example.test/rest/v1/private?token=DO_NOT_LOG", { headers: { authorization: "DO_NOT_LOG" } }), response);
    assert.equal(response.bodyUsed, false);
    assert.equal(await response.text(), "private-body");
    assert.equal(JSON.parse(lines[0]).event, "database_request_failed");
    assert.ok(!lines.join().includes("DO_NOT_LOG")); assert.ok(!lines.join().includes("private-body"));
  } finally { console.warn = original; }
});
test("upstream exceptions are sanitized before Next can log an error containing a signed URL or password", async () => {
  const original = console.warn;
  try {
    console.warn = () => {};
    const fetcher = observedSupabaseFetch("https://stage.example.test", async () => { throw new Error("DO_NOT_LOG signed-url/password"); });
    await assert.rejects(fetcher("https://stage.example.test/auth/v1/token"), error => error.message === "Upstream request unavailable." && !error.cause);
  } finally { console.warn = original; }
});
