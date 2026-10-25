import assert from "node:assert/strict";
import test from "node:test";
import { canonical, compareSchema, expectedSchema } from "../scripts/staging/schema.mjs";
import { validateGeneratedTypes } from "../scripts/staging/types.mjs";
import { stagingPoolOptions } from "../scripts/staging/acceptance.mjs";
import { staging } from "../scripts/staging/lib.mjs";
import { validateStagingCa } from "../scripts/staging/tls.mjs";

test("schema comparison detects unrecorded column/policy/function/grant/bucket changes", () => {
  const before = [{ kind: "column", identity: "public.profiles.role", definition: { notNull: true } },
    { kind: "function", identity: "private.guard()", definition: { body: "select 'a  b'" } }];
  assert.deepEqual(compareSchema(before, before), { missing: [], changed: [], unexpected: [] });
  assert.equal(compareSchema(before, [{ ...before[0], definition: { notNull: false } }, before[1]]).changed.length, 1);
  assert.equal(compareSchema(before, [before[0]]).missing.length, 1);
  assert.equal(compareSchema(before, [...before, { kind: "policy", identity: "unsafe_dashboard_policy", definition: {} }]).unexpected.length, 1);
  assert.equal(compareSchema(before, [before[0], { ...before[1], definition: { body: "select 'a b'" } }]).changed.length, 1,
    "Whitespace inside SQL literals must not be normalized away.");
  assert.throws(() => compareSchema([], []));
  assert.throws(() => compareSchema(before, [...before, before[0]]));
  assert.deepEqual(canonical({ b: "line\r\nend", a: 1 }), { a: 1, b: "line\nend" });
});
test("fresh migration replay produces a complete schema/security contract", { timeout: 60000 }, async () => {
  const rows = await expectedSchema();
  for (const kind of ["column", "constraint", "index", "policy", "function", "trigger", "table-grant", "column-grant", "function-grant", "schema-grant", "bucket"]) {
    assert.ok(rows.some((row) => row.kind === kind), `Missing contract coverage: ${kind}`);
  }
  assert.ok(rows.some((row) => row.identity === "public.student_reports"));
  const conflicts = rows.filter((row) => row.kind === "function" && row.definition.body.includes("using errcode = 'PT409'"));
  assert.deepEqual(conflicts.map((row) => row.identity.split("(")[0]).sort(), [
    "public.accept_reservation", "public.cancel_reservation", "public.complete_sale",
    "public.publish_listing", "public.start_reservation_conversation", "public.update_owned_listing", "public.upsert_meetup",
  ]);
  assert.ok(!rows.some((row) => row.kind === "function" && row.definition.body.includes("using errcode = '40001'")),
    "Business validation must not trigger PostgREST's serialization retry loop.");
  for (const row of conflicts) {
    assert.equal(row.definition.definer, true);
    assert.ok(row.definition.config.some((setting) => setting.startsWith("search_path=")));
    assert.equal(rows.find((grant) => grant.kind === "function-grant" && grant.identity === `${row.identity}:anon`)?.definition, false);
    assert.equal(rows.find((grant) => grant.kind === "function-grant" && grant.identity === `${row.identity}:authenticated`)?.definition, true);
  }
});
test("staging database sessions pin project, database, verified TLS and session pooling", () => {
  const database = new URL("postgresql://aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=require");
  database.username = `postgres.${staging.supabaseProjectRef}`;
  database.password = "test-password";
  const env = { STAGING_PUBLISHABLE_KEY: "sb_publishable_test", STAGING_SERVICE_ROLE_KEY: "private-test-operator",
    STAGING_DATABASE_URL: database.href };
  const { options } = stagingPoolOptions(env, "public-test-certificate");
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.ca, "public-test-certificate");
  assert.ok(!Object.hasOwn(options, "connectionString"));
  for (const value of [env.STAGING_DATABASE_URL.replace(staging.supabaseProjectRef, "production"),
    env.STAGING_DATABASE_URL.replace(":5432", ":6543"), env.STAGING_DATABASE_URL.replace("/postgres?", "/another?"),
    env.STAGING_DATABASE_URL + "&host=db.production.supabase.co"]) assert.throws(() => stagingPoolOptions({ ...env, STAGING_DATABASE_URL: value }));
});
test("generated schema types reject incomplete or executable responses", () => {
  assert.throws(() => validateGeneratedTypes("export type Database = {}"));
  assert.throws(() => validateGeneratedTypes("private-service-response"));
});
test("provider CA rotation cannot silently disable certificate validation", () => {
  assert.throws(() => validateStagingCa("unreviewed certificate"));
});
