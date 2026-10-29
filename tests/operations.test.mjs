import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { persistentSyntheticWorkflow } from "../scripts/operations/drill-fixtures.mjs";
import { validateTarget, validateBackupPolicy, validateObject, expiredSnapshots, backupFreshness, registry, policy } from "../scripts/operations/policy.mjs";
import { controlledEnvironment, command } from "../scripts/operations/process.mjs";
import { storagePack, decodeStoragePack, boundedBody, validateBuckets } from "../scripts/operations/storage.mjs";
import { resticClient } from "../scripts/operations/restic.mjs";
import { countsOnly, evaluateSignals, readLogCounts, verifiedBackupFreshness, monitor } from "../scripts/operations/monitor.mjs";
import { validateExportedSnapshot, publicationRestoreSql } from "../scripts/operations/database.mjs";
import { validateServiceKey, capture } from "../scripts/operations/backup.mjs";

const id = "11111111-1111-4111-8111-111111111111", ref = registry.staging.supabaseProjectRef;
const sha = "a".repeat(64), env = { OPS_ENV: "staging", OPS_PROJECT_REF: ref };
const selected = { ...policy.staging, enabled: true, owner: "Approved backup owner", retentionApproved: true,
  repository: "s3:https://backups.example.test/private/ucm-staging", repositoryId: sha };
const configured = { ...env, RESTIC_REPOSITORY: selected.repository, RESTIC_PASSWORD: "Synthetic-repository-password-for-unit-tests-only" };
const data = Buffer.from("synthetic image bytes"), object = { bucket_id: "listing-images", name: `${id}/${id}/photo.png`, owner_id: id,
  metadata: { size: data.length, mimetype: "image/png" }, updated_at: "2026-10-29 00:00:00+00", version: "synthetic" };
const options = component => ({ projectRef: ref, runId: id, component, maxObjects: 100, maxStorageBytes: 10000000 });
const pack = async (objects = [object], component = "media") => {
  const chunks = [];
  for await (const line of storagePack({ projectRef: ref, id, component, objects, download: async () => data })) chunks.push(line);
  return chunks.join("");
};
const snapshot = (component, time, value = sha) => ({ id: value, hostname: "uc-marketplace-staging", time,
  tags: ["ucm:staging", `component:${component}`, `run:${id}`] });

test("operations reject production, wrong project refs and implicit targets", () => {
  assert.equal(validateTarget(env), registry.staging);
  for (const value of [{}, { ...env, OPS_ENV: "production" }, { ...env, OPS_PROJECT_REF: registry.production.supabaseProjectRef }]) assert.throws(() => validateTarget(value));
  assert.equal(policy.production.enabled, false); assert.equal(policy.staging.enabled, false);
});
test("private backup capture requires an approved owner, retention, exact encrypted repository and persistent key", () => {
  assert.deepEqual(validateBackupPolicy(configured, selected), selected);
  for (const changes of [{ enabled: false }, { owner: null }, { retentionApproved: false }, { repositoryId: null }, { retentionDays: 0 },
    { verificationRetentionDays: 8 }, { verificationRetentionDays: 1 }, { repository: "s3:http://example.test/private" }, { repository: "rest:https://user:password@example.test/private" }]) {
    assert.throws(() => validateBackupPolicy(configured, { ...selected, ...changes }));
  }
  for (const changes of [{ RESTIC_PASSWORD: "placeholder" }, { RESTIC_REPOSITORY: "s3:https://other.example.test/wrong" }]) assert.throws(() => validateBackupPolicy({ ...configured, ...changes }, selected));
});
test("database snapshots and service keys cannot silently refer to production or arbitrary SQL", () => {
  assert.equal(validateExportedSnapshot("00000003-000000A1-1"), "00000003-000000A1-1");
  for (const value of ["", "snapshot'; drop table public.users;--", "x"]) assert.throws(() => validateExportedSnapshot(value));
  const key = payload => `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
  assert.doesNotThrow(() => validateServiceKey({ OPS_SERVICE_ROLE_KEY: key({ ref, role: "service_role", exp: 9999999999 }) }));
  for (const payload of [{ ref: registry.production.supabaseProjectRef, role: "service_role", exp: 9999999999 }, { ref, role: "anon", exp: 9999999999 }, { ref, role: "service_role", exp: 1 }]) {
    assert.throws(() => validateServiceKey({ OPS_SERVICE_ROLE_KEY: key(payload) }));
  }
});
test("child environments reject command hooks and insecure TLS without forwarding unrelated app credentials", () => {
  assert.deepEqual(controlledEnvironment({ PATH: "safe", SUPABASE_SECRET_KEY: "private", NEXT_PUBLIC_TOKEN: "private", OPS_ENV: "staging" }), { PATH: "safe", OPS_ENV: "staging" });
  for (const key of ["RESTIC_PASSWORD_COMMAND", "RESTIC_PASSWORD_FILE", "RESTIC_REPOSITORY_FILE", "RESTIC_INSECURE_TLS", "NODE_TLS_REJECT_UNAUTHORIZED", "PGSERVICEFILE", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) assert.throws(() => controlledEnvironment({ [key]: "unsafe" }));
});
test("Storage backup validates bucket privacy, safe object paths, image types and strict size limits", () => {
  assert.equal(validateObject(object).size, data.length);
  for (const changes of [{ bucket_id: "public-files" }, { name: "../private" }, { name: "folder/../private" }, { name: "folder//file" }, { name: "folder\\file" },
    { metadata: { size: 0, mimetype: "image/png" } }, { metadata: { size: 5242881, mimetype: "image/png" } }, { metadata: { size: 10, mimetype: "text/html" } }]) assert.throws(() => validateObject({ ...object, ...changes }));
  const buckets = ["listing-images", "avatars", "student-verifications"].map(id => ({ id, public: id === "avatars" }));
  assert.doesNotThrow(() => validateBuckets(buckets)); assert.throws(() => validateBuckets([...buckets, { id: "other", public: false }]));
  assert.throws(() => validateBuckets(buckets.map(row => ({ ...row, public: true }))));
});
test("separate media and verification packs round-trip actual bytes with per-object and whole-stream integrity", async () => {
  const verification = { ...object, bucket_id: "student-verifications" };
  for (const component of ["media", "verification"]) {
    const restored = [];
    const encoded = await pack([object, verification], component);
    const result = await decodeStoragePack(Readable.from([...encoded].map(character => Buffer.from(character))), options(component), async (item, bytes) => restored.push({ item, bytes }));
    assert.equal(result.count, 1); assert.equal(restored.length, 1); assert.deepEqual(restored[0].bytes, data);
    assert.equal(restored[0].item.bucket_id === "student-verifications", component === "verification");
  }
});
test("Storage restoration rejects tampering, truncation, duplicates, wrong source/run, oversized lines and trailing records", async () => {
  const valid = await pack(), lines = valid.trimEnd().split("\n");
  const record = JSON.parse(lines[1]);
  const badHash = [...lines]; badHash[1] = JSON.stringify({ ...record, sha256: "f".repeat(64) });
  const traversal = [...lines]; traversal[1] = JSON.stringify({ ...record, object: { ...object, name: "../outside" } });
  for (const input of [badHash.join("\n") + "\n", traversal.join("\n") + "\n", lines.slice(0, -1).join("\n") + "\n", valid + lines[1] + "\n", `${lines[0]}\n${lines[1]}\n${lines[1]}\n${lines[2]}\n`, "x".repeat(7100001)]) {
    await assert.rejects(decodeStoragePack(Readable.from([input]), options("media"), async () => {}));
  }
  await assert.rejects(decodeStoragePack(Readable.from([valid]), { ...options("media"), runId: "different" }, async () => {}));
  await assert.rejects(decodeStoragePack(Readable.from([valid]), { ...options("media"), maxStorageBytes: 1 }, async () => {}));
});
test("Storage downloads bound streaming size and never accept a missing object as a successful backup", async () => {
  assert.deepEqual(await boundedBody(new Response(data), data.length), data);
  await assert.rejects(boundedBody(new Response(data), 1));
  await assert.rejects(boundedBody(new Response("denied", { status: 403 }), 100));
});
test("retention uses real wall-clock expiry rather than keeping the newest stale verification backup forever", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  const expired = snapshot("verification", "2026-10-01T00:00:00Z");
  const fresh = snapshot("database", "2026-10-29T00:00:00Z", "b".repeat(64));
  assert.deepEqual(expiredSnapshots([expired, fresh], now, 7), [sha]);
  assert.throws(() => expiredSnapshots([{ ...expired, tags: ["unrelated"] }], now, 7));
  assert.equal(backupFreshness([snapshot("database", fresh.time)], now, 26).status, "stale");
  assert.equal(backupFreshness([snapshot("bundle", fresh.time)], now, 26).status, "healthy");
});
test("restic uses a failing-producer-aware encrypted stream, no plaintext files and exact scoped retention IDs", async () => {
  const calls = [];
  const storage = resticClient({}, async (_binary, args) => {
    calls.push(args);
    if (args.includes("version")) return Buffer.from("restic 0.19.1");
    if (args.includes("cat")) return Buffer.from(JSON.stringify({ id: sha, version: 2 }));
    if (args.includes("backup")) return Buffer.from(JSON.stringify({ message_type: "summary", snapshot_id: sha }));
    return Buffer.from("");
  });
  await storage.verify(sha); assert.equal(await storage.backup("database", id, ["node", "safe-producer"]), sha);
  assert.ok(calls.at(-1).includes("--stdin-from-command")); assert.ok(calls.at(-1).includes("run:" + id));
  await storage.forget([sha]); assert.ok(calls.at(-1).includes("--dry-run")); assert.ok(!calls.at(-1).includes("--prune"));
  await storage.forget([sha], true); assert.ok(calls.at(-1).includes("--prune"));
  await assert.rejects(storage.backup("other", id, ["node"]));
  await assert.rejects(storage.forget(["latest"]));
  const failed = resticClient({}, async () => { throw new Error("private diagnostic"); });
  await assert.rejects(failed.backup("database", id, ["node"]));
});
test("process wrapper fails on exit, caps private output and does not execute shell metacharacters", async () => {
  assert.equal((await command(process.execPath, ["-e", "process.stdout.write(process.argv[1])", "not-a-command; $private"])).toString(), "not-a-command; $private");
  await assert.rejects(command(process.execPath, ["-e", "process.exit(3)"]));
  await assert.rejects(command(process.execPath, ["-e", "process.stdout.write('x'.repeat(50))"], { maxBytes: 10 }));
});
test("monitor strips arbitrary provider fields and rejects missing/non-numeric coverage", () => {
  assert.deepEqual(countsOnly({ count: "1", password: "DO_NOT_LOG" }, ["count"]), { count: 1 });
  for (const count of [undefined, null, "", " ", true, "secret", -1, 1.5, Infinity]) assert.throws(() => countsOnly({ count }, ["count"]));
});
test("monitor distinguishes operational failures, suspicious traffic, capacity and missing telemetry", () => {
  const clean = { deployment: { state: "READY" }, runtime: { errors: 0, serverFailures: 0, truncated: false }, database: { connections: 1, max_connections: 100, slow_active_queries: 0, database_bytes: 1, storage_bytes: 1 },
    logs: { requests: 1, auth_requests: 1, auth_failures: 0, api_errors: 0, smtp_errors: 0, database_errors: 0, storage_errors: 0, realtime_errors: 0, reservation_failures: 0 }, backup: { status: "healthy" } };
  assert.deepEqual(evaluateSignals(clean), []);
  const result = evaluateSignals({ ...clean, logs: { ...clean.logs, requests: 10000, auth_requests: 20, auth_failures: 12, smtp_errors: 1, reservation_failures: 1 }, database: { ...clean.database, storage_bytes: 1000000000, connections: 90 } });
  for (const code of ["TRAFFIC_REVIEW", "AUTH_FAILURE_SPIKE", "SMTP_FAILURES", "RESERVATION_FAILURES", "DATABASE_CONNECTION_PRESSURE", "STORAGE_CAPACITY_PRESSURE"]) assert.ok(result.includes(code));
  for (const code of ["DATABASE_UNAVAILABLE", "SERVICE_LOGS_UNAVAILABLE", "RUNTIME_COVERAGE_INCOMPLETE", "BACKUP_NOT_VERIFIED_FRESH"]) assert.ok(evaluateSignals({}).includes(code));
  assert.ok(evaluateSignals({ ...clean, runtime: { truncated: true } }).includes("RUNTIME_COVERAGE_INCOMPLETE"));
});
test("Supabase log collector queries fixed aggregate counts in a bounded window without exporting user records", async () => {
  let requested;
  const names = ["requests", "api_errors", "auth_requests", "auth_failures", "smtp_errors", "database_errors", "storage_errors", "realtime_errors", "reservation_failures"];
  const counts = Object.fromEntries(names.map(name => [name, 0]));
  const result = await readLogCounts({ ...env, OPS_MANAGEMENT_TOKEN: "private-token" }, async (url, init) => {
    requested = url;
    assert.equal(init.redirect, "error"); assert.ok(url.pathname.endsWith("/analytics/endpoints/logs")); assert.ok(!url.pathname.endsWith("logs.all"));
    return new Response(JSON.stringify({ result: [{ ...counts, private_field: "never-export" }] }));
  });
  assert.deepEqual(result, counts);
  assert.equal(Date.parse(requested.searchParams.get("iso_timestamp_end")) - Date.parse(requested.searchParams.get("iso_timestamp_start")), 900000);
  await assert.rejects(readLogCounts({ ...env, OPS_MANAGEMENT_TOKEN: "private-token" }, async () => new Response(JSON.stringify({ error: "denied", result: [] }))));
});
test("a recent completion marker cannot conceal a missing database or Storage snapshot", async () => {
  const time = new Date().toISOString();
  const bundle = snapshot("bundle", time, "d".repeat(64));
  const records = [bundle, snapshot("database", time), snapshot("media", time, "b".repeat(64)), snapshot("verification", time, "c".repeat(64))];
  const manifest = { version: 1, complete: true, projectRef: ref, runId: id, snapshots: { database: sha, media: "b".repeat(64), verification: "c".repeat(64) } };
  const storage = { snapshots: async () => records, dump: async (_id, _kind, output) => output(Buffer.from(JSON.stringify(manifest))) };
  assert.equal((await verifiedBackupFreshness(storage, selected)).status, "healthy");
  await assert.rejects(verifiedBackupFreshness({ ...storage, snapshots: async () => records.slice(0, -1) }, selected));
});
test("unconfigured monitoring fails visibly, never claims a valid backup or attempts alerts", async () => {
  const failed = async () => { throw new Error("DO_NOT_LOG private diagnostic"); };
  const report = await monitor(env, { connect: failed, logs: failed, vercel: failed });
  assert.equal(report.status, "attention_required"); assert.equal(report.signals.backup, null);
  assert.ok(!JSON.stringify(report).includes("DO_NOT_LOG"));
});

test("a failed component cannot create a completion marker, and its read-only snapshot is released", async () => {
  const original = { ...policy.staging };
  Object.assign(policy.staging, selected);
  const executed = [], queries = [];
  let ended = false;
  const tables = ["profiles", "listings", "listing_images", "favorites", "conversations", "messages", "reservations", "meetups", "verifications", "listing_reports", "student_reports"]
    .map(name => ({ schema: "public", name, rls: true }));
  tables.push({ schema: "auth", name: "users", rls: true });
  const client = { async query(query) {
    queries.push(query);
    if (query.includes("pg_export_snapshot")) return { rows: [{ id: "00000003-000000A1-1" }] };
    if (query.includes("from storage.buckets")) return { rows: ["listing-images", "avatars", "student-verifications"].map(id => ({ id, public: id === "avatars" })) };
    if (query.includes("from storage.objects")) return { rows: [] };
    if (query.includes("from pg_class")) return { rows: tables };
    if (query.includes("count(*)")) return { rows: [{ count: "0" }] };
    if (query === "show server_version_num") return { rows: [{ server_version_num: "170011" }] };
    if (query.includes("from pg_publication p")) return { rows: [{ pubname: "supabase_realtime", puballtables: false, pubinsert: true, pubupdate: true, pubdelete: false, pubtruncate: false, tables: [{ schema: "public", table: "messages" }] }] };
    return { rows: [] };
  }, async end() { ended = true; } };
  const service = `header.${Buffer.from(JSON.stringify({ ref, role: "service_role", exp: 9999999999 })).toString("base64url")}.signature`;
  try {
    await assert.rejects(capture({ ...configured, OPS_CONFIRM: `${ref}:backup`, OPS_SERVICE_ROLE_KEY: service }, {
      restic: { verify: async () => {}, check: async () => {} }, connect: async () => ({ client }),
      worker: () => ({ backup: async component => { executed.push(component); if (component === "media") throw new Error("private"); return sha; } }),
    }));
    assert.deepEqual(executed, ["database", "media"]);
    assert.ok(queries.includes("begin isolation level repeatable read read only"));
    assert.ok(queries.includes("rollback")); assert.equal(ended, true);
  } finally { Object.assign(policy.staging, original); }
});

test("schema-scoped backups preserve the database-global Realtime contract separately, without publishing private tables", () => {
  const publication = { pubname: "supabase_realtime", puballtables: false, pubinsert: true, pubupdate: true, pubdelete: false, pubtruncate: false, tables: [{ schema: "public", table: "messages" }] };
  assert.match(publicationRestoreSql(publication), /publish='insert, update'/);
  for (const changes of [{ puballtables: true }, { pubdelete: true }, { tables: [{ schema: "public", table: "verifications" }] }, { pubname: "different" }]) assert.throws(() => publicationRestoreSql({ ...publication, ...changes }));
});

test("persisted restore fixtures remove only the temporary failure injector after all workflow assertions", async () => {
  const original = await readFile(new URL("../supabase/checks/end_to_end_workflow.sql", import.meta.url), "utf8");
  const fixture = persistentSyntheticWorkflow(original);
  assert.match(original, /rollback;\s*$/i);
  assert.match(fixture, /drop trigger qa15_injected_listing_failure on public\.listings;\s*commit;$/i);
  assert.ok(fixture.indexOf("drop trigger qa15_injected_listing_failure") > fixture.indexOf("__all_end_to_end_workflow_checks_passed__"));
  assert.equal((fixture.match(/drop trigger /gi) ?? []).length, 1);
  assert.ok(!fixture.includes("disable trigger"));
  assert.throws(() => persistentSyntheticWorkflow("rollback;"));
});
