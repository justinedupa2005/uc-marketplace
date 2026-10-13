import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { analyzeSources, auditRepository } from "../scripts/qa/security-hygiene.mjs";

test("production source client graphs contain no server-only dependencies or privileged secrets", () => {
  const result = auditRepository(fileURLToPath(new URL("../", import.meta.url)));
  assert.ok(result.sourceCount > 0);
  assert.deepEqual(result.issues, []);
});

test("client-boundary audit follows transitive runtime imports but stops at server action references", () => {
  const files = new Map([
    ["src/client.tsx", '"use client"; import { safe } from "@/helper"; import { update } from "@/actions"; import type { PrivateType } from "@/private";'],
    ["src/helper.ts", 'export { value } from "./private";'],
    ["src/private.ts", 'import "server-only"; export const value = process.env.PRIVATE_API_TOKEN;'],
    ["src/actions.ts", '"use server"; import "server-only"; export async function update() {}'],
  ]);
  const issues = analyzeSources(files);
  assert.ok(issues.some((issue) => issue.code === "client-imports-server-module" && issue.dependency === "src/private.ts"));
  assert.ok(issues.some((issue) => issue.code === "client-imports-private-environment"));
  assert.equal(issues.some((issue) => issue.dependency === "src/actions.ts"), false);
  files.set("src/helper.ts", "export const safe = true;");
  assert.deepEqual(analyzeSources(files), []);
});

test("hygiene audit catches private public-environment variables and computed browser access", () => {
  for (const code of ['"use client"; const key = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;', '"use client"; const key = process.env["SUPABASE_SECRET_KEY"];', '"use client"; const key = process.env[name];', '"use client"; const values = process.env; const key = values.PRIVATE_API_KEY;', '"use client"; const { PRIVATE_API_KEY } = process.env;']) assert.ok(analyzeSources(new Map([["src/client.ts", code]])).length > 0);
  assert.deepEqual(analyzeSources(new Map([["src/client.ts", '"use client"; const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;']])), []);
});

test("recovery signing configuration is allowed only outside the browser import graph", () => {
  const server = 'import "server-only"; export const secret = process.env.AUTH_RECOVERY_SECRET;';
  assert.deepEqual(analyzeSources(new Map([["src/recovery.ts", server]])), []);
  const files = new Map([["src/recovery.ts", server], ["src/client.ts", '"use client"; import { secret } from "./recovery";']]);
  assert.ok(analyzeSources(files).some((issue) => issue.code === "client-imports-private-environment"));
  assert.ok(analyzeSources(new Map([["src/server.ts", "const key = process.env.NEXT_PUBLIC_AUTH_RECOVERY_SECRET;"]])).some((issue) => issue.code === "unreviewed-public-environment"));
});

test("hygiene audit detects privileged embedded tokens without rejecting public anon tokens", () => {
  const token = (role) => [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ role, iss: "supabase", exp: 9999999999 })).toString("base64url"), "testsignature"].join(".");
  assert.equal(analyzeSources(new Map([["src/secret.ts", `const key = "${token("service_role")}";`]])).some((issue) => issue.code === "embedded-privileged-secret"), true);
  assert.deepEqual(analyzeSources(new Map([["src/public.ts", `const key = "${token("anon")}";`]])), []);
  assert.equal(analyzeSources(new Map([["src/secret.ts", 'const key = "sb_secret_nonprivateQaFixture0000";']])).some((issue) => issue.code === "embedded-privileged-secret"), true);
});

test("hygiene review distinguishes mock datasets/debugging from legitimate input placeholders and diagnostics", () => {
  assert.equal(analyzeSources(new Map([["src/profile.ts", "const mockProfiles = [{ fullName: 'Mock' }];"]])).some((issue) => issue.code === "production-mock-dataset"), true);
  assert.equal(analyzeSources(new Map([["src/profile.ts", "console.log('temporary debugging');"]])).some((issue) => issue.code === "production-debug-log"), true);
  assert.deepEqual(analyzeSources(new Map([["src/form.tsx", 'const form = <input placeholder="Search listings" />; console.warn("Unable to load listings", { code: "unavailable" });']])), []);
});
