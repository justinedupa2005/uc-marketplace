import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertLocalDockerEndpoint, buildLocalQaConfig, qaEnvironmentFromLocalStatus } from "../scripts/qa/lib/local-stack.mjs";

const source = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
const id = "ucmarketplace-qa-0123456789abcdef";
const status = { API_URL: "http://127.0.0.1:54331", DB_URL: "postgresql://postgres:fixture@127.0.0.1:54332/postgres", PUBLISHABLE_KEY: "sb_publishable_fixture", SECRET_KEY: "sb_secret_fixture", MAILPIT_URL: "http://127.0.0.1:54334" };

test("isolated config preserves strong auth and uses distinct, fresh per-run resources", () => {
  const config = buildLocalQaConfig(source, id);
  assert.ok(config.includes(`project_id = "${id}"`));
  for (const port of [54330, 54331, 54332, 54333, 54334, 54337, 54339]) assert.ok(config.includes(String(port)));
  for (const value of ["minimum_password_length = 12", 'password_requirements = "lower_upper_letters_digits_symbols"', "enable_confirmations = true", "otp_length = 8", "otp_expiry = 60", 'max_frequency = "60s"', "email_sent = 100"]) assert.ok(config.includes(value));
  assert.ok(config.includes('site_url = "http://127.0.0.1:3106"'));
  assert.ok(config.includes("[auth.email.template.recovery]"));
  assert.ok(!config.includes('project_id = "UCMarketplace"'));
  assert.throws(() => buildLocalQaConfig(source, "UCMarketplace"), /uniquely/);
  assert.ok(config.length > 0);
});

test("config transformation refuses missing tracked sections instead of guessing", () => {
  assert.throws(() => buildLocalQaConfig(source.replace("port = 54321", "different_port = 54321"), id), /no longer matches/);
});

test("local CLI status secrets stay in the fixture process and remote flags cannot leak", () => {
  const env = qaEnvironmentFromLocalStatus(status, { SUPABASE_ACCESS_TOKEN: "private", QA_ALLOW_REMOTE: "1", QA_ALLOWED_PROJECT_REF: "production", PATH: "preserved" });
  assert.equal(env.QA_SUPABASE_SERVICE_ROLE_KEY, status.SECRET_KEY);
  assert.equal(env.SUPABASE_ACCESS_TOKEN, undefined);
  assert.equal(env.QA_ALLOW_REMOTE, undefined);
  assert.equal(env.QA_ALLOWED_PROJECT_REF, undefined);
  assert.equal(env.PATH, "preserved");
  assert.equal(env.EMAIL_CONFIRMATION_MODE, "code");
});

test("status accepts documented legacy names and structured CLI fields without inferring hosted credentials", () => {
  const structured = { api: { url: status.API_URL, anon_key: "sb_publishable_legacyfixture", service_role_key: status.SECRET_KEY }, db: { url: status.DB_URL } };
  assert.equal(qaEnvironmentFromLocalStatus(structured).QA_MAILPIT_URL, status.MAILPIT_URL);
  assert.throws(() => qaEnvironmentFromLocalStatus({}), /required/);
});

test("status refuses hosted services or a different local stack", () => {
  for (const replacement of [{ API_URL: "https://production.supabase.co" }, { API_URL: "http://127.0.0.1:54321" }, { DB_URL: status.DB_URL.replace("54332", "54322") }, { MAILPIT_URL: "http://127.0.0.1:54324" }]) {
    assert.throws(() => qaEnvironmentFromLocalStatus({ ...status, ...replacement }));
  }
});

test("Docker ownership checks forbid remote TCP/SSH daemons", () => {
  for (const endpoint of ["unix:///var/run/docker.sock", "npipe:////./pipe/docker_engine", "npipe:////./pipe/dockerDesktopLinuxEngine"]) assert.doesNotThrow(() => assertLocalDockerEndpoint(endpoint));
  for (const endpoint of ["ssh://server.example.test", "tcp://127.0.0.1:2375", "tcp://remote:2376", "", null]) assert.throws(() => assertLocalDockerEndpoint(endpoint), /remote Docker/);
});
