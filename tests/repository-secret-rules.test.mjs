import assert from "node:assert/strict";
import test from "node:test";
import { isSecretFilename, secretFindingCodes } from "../scripts/qa/lib/repository-secret-rules.mjs";

test("private environment files and key containers are forbidden independently of Git ignore state", () => {
  for (const name of [".env", "nested/.env.local", "nested\\.env.production", "key.pem", "certificate.pfx", "signing.key", "id_ed25519"]) assert.equal(isSecretFilename(name), true);
  for (const name of [".env.example", ".env.sample", "template.env.txt", "README.md", "package-lock.json"]) assert.equal(isSecretFilename(name), false);
});

test("secret guard detects privileged Supabase, GitHub, AWS and private key patterns without returning values", () => {
  const fixtures = [
    ["sb_" + "secret_" + "x".repeat(30), "supabase-privileged-key"],
    ["ghp_" + "x".repeat(36), "github-token"],
    ["github_" + "pat_" + "x".repeat(60), "github-token"],
    ["AKIA" + "X".repeat(16), "aws-access-key"],
    ["-----BEGIN " + "PRIVATE KEY-----", "private-key"],
    ["SMTP_PASSWORD=" + '"' + "a-long-private-password" + '"', "assigned-private-credential"],
    ["postgresql://admin:" + "private-password@database.example.com/app", "database-credential"],
  ];
  for (const [value, expected] of fixtures) {
    const findings = secretFindingCodes(value);
    assert.ok(findings.includes(expected));
    assert.equal(JSON.stringify(findings).includes(value), false);
  }
});

test("privileged legacy JWT claims fail while public anon tokens and environment references remain allowed", () => {
  const jwt = (role) => [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ role, iss: "supabase" })).toString("base64url"), "syntheticsignature"].join(".");
  assert.deepEqual(secretFindingCodes(jwt("service_role")), ["supabase-privileged-jwt"]);
  assert.deepEqual(secretFindingCodes(jwt("anon")), []);
  assert.deepEqual(secretFindingCodes("const secret = process.env.AUTH_RECOVERY_SECRET;"), []);
});

test("only the exact inert negative fixtures are exempt; test filenames grant no exemption", () => {
  assert.deepEqual(secretFindingCodes("sb_secret_nonprivateQaFixture0000"), []);
  assert.deepEqual(secretFindingCodes('SUPABASE_SERVICE_ROLE_KEY: "private-test-config"'), []);
  assert.ok(secretFindingCodes("sb_" + "secret_nonprivateQaFixture0000_CHANGED").length);
  assert.ok(secretFindingCodes("SMTP_PASSWORD: " + JSON.stringify("private-test-config-CHANGED")).length);
  assert.ok(secretFindingCodes("postgresql://postgres:" + "changed@127.0.0.1:54322/postgres").length);
});

test("unquoted dotenv secrets are detected without flagging normal environment lookups", () => {
  for (const name of ["AUTH_RECOVERY_SECRET", "SMTP_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY"]) {
    assert.deepEqual(secretFindingCodes(`${name}=${"ab".repeat(32)}\n`), ["assigned-private-credential"]);
  }
  assert.deepEqual(secretFindingCodes("AUTH_RECOVERY_SECRET = process.env.AUTH_RECOVERY_SECRET;"), []);
});
