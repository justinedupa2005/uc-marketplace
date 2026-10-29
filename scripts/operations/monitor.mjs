import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { policy, registry, validateTarget, validateBackupPolicy, backupFreshness, snapshotId } from "./policy.mjs";
import { connect } from "./database.mjs";
import { prepareCa } from "./backup.mjs";
import { command } from "./process.mjs";
import { resticClient } from "./restic.mjs";

export const logQuery = `select
  countIf(source='edge_logs') as requests,
  countIf(source='edge_logs' and toInt32OrZero(log_attributes['response.status_code'])>=500) as api_errors,
  countIf(source='edge_logs' and startsWith(log_attributes['request.path'],'/auth/v1/')) as auth_requests,
  countIf(source='edge_logs' and startsWith(log_attributes['request.path'],'/auth/v1/') and toInt32OrZero(log_attributes['response.status_code']) in (400,401,403,429)) as auth_failures,
  countIf(source='auth_logs' and upper(severity_text) in ('ERROR','FATAL') and (positionCaseInsensitive(event_message,'smtp')>0 or positionCaseInsensitive(event_message,'mail')>0)) as smtp_errors,
  countIf(source='postgres_logs' and upper(severity_text) in ('ERROR','FATAL','PANIC')) as database_errors,
  countIf(source='storage_logs' and upper(severity_text) in ('ERROR','FATAL')) as storage_errors,
  countIf(source='realtime_logs' and upper(severity_text) in ('ERROR','FATAL')) as realtime_errors,
  countIf(source='edge_logs' and match(log_attributes['request.path'],'^/rest/v1/rpc/(request_reservation|accept_reservation|reject_reservation|cancel_reservation|upsert_meetup|complete_sale)$') and toInt32OrZero(log_attributes['response.status_code'])>=400) as reservation_failures
  from logs where source in ('edge_logs','auth_logs','postgres_logs','storage_logs','realtime_logs') limit 1`;

export const databaseMetricsSql = `select pg_database_size(current_database())::text as database_bytes,
  (select coalesce(sum((metadata->>'size')::bigint),0)::text from storage.objects) as storage_bytes,
  (select count(*) from pg_stat_activity where datname=current_database())::text as connections,
  current_setting('max_connections') as max_connections,
  (select count(*) from pg_stat_activity where datname=current_database() and state='active' and backend_type='client backend' and now()-query_start>interval '30 seconds')::text as slow_active_queries,
  (select count(*) from pg_stat_activity where datname=current_database() and application_name like 'realtime%')::text as realtime_database_connections,
  (select deadlocks from pg_stat_database where datname=current_database())::text as deadlocks_total`;

export function countsOnly(row, names) {
  const result = {};
  assert.ok(row && typeof row === "object");
  for (const name of names) {
    const value = Number(row[name]);
    assert.ok((typeof row[name] === "number" || typeof row[name] === "string" && /^\d+$/.test(row[name])) && Number.isSafeInteger(value) && value >= 0);
    result[name] = value;
  }
  return result;
}

export function evaluateSignals(signals, selected = policy.staging) {
  const incidents = [];
  if (signals.deployment?.state !== "READY") incidents.push("DEPLOYMENT_NOT_READY");
  if (!signals.runtime || signals.runtime.truncated) incidents.push("RUNTIME_COVERAGE_INCOMPLETE");
  else if (signals.runtime.errors || signals.runtime.serverFailures) incidents.push("SERVER_ERRORS");
  if (!signals.database) incidents.push("DATABASE_UNAVAILABLE");
  else {
    const db = signals.database;
    if (db.connections >= db.max_connections * 0.8) incidents.push("DATABASE_CONNECTION_PRESSURE");
    if (db.slow_active_queries > 0) incidents.push("SLOW_ACTIVE_QUERIES");
    if (!selected.databaseBudgetBytes || !selected.storageBudgetBytes) incidents.push("CAPACITY_BUDGETS_UNCONFIGURED");
    else {
      if (db.database_bytes >= selected.databaseBudgetBytes * 0.8) incidents.push("DATABASE_CAPACITY_PRESSURE");
      if (db.storage_bytes >= selected.storageBudgetBytes * 0.8) incidents.push("STORAGE_CAPACITY_PRESSURE");
    }
  }
  if (!signals.logs) incidents.push("SERVICE_LOGS_UNAVAILABLE");
  else {
    const logs = signals.logs;
    if (logs.api_errors >= 5) incidents.push("API_ERROR_SPIKE");
    if (logs.auth_requests >= 20 && logs.auth_failures >= 10 && logs.auth_failures / logs.auth_requests >= 0.2) incidents.push("AUTH_FAILURE_SPIKE");
    if (logs.requests >= 10000) incidents.push("TRAFFIC_REVIEW");
    for (const [name, code] of [["smtp_errors", "SMTP_FAILURES"], ["database_errors", "DATABASE_ERRORS"], ["storage_errors", "STORAGE_ERRORS"], ["realtime_errors", "REALTIME_ERRORS"], ["reservation_failures", "RESERVATION_FAILURES"]]) {
      if (logs[name] > 0) incidents.push(code);
    }
  }
  if (signals.backup?.status !== "healthy") incidents.push("BACKUP_NOT_VERIFIED_FRESH");
  return incidents;
}

export async function readLogCounts(env, fetcher = fetch, now = Date.now()) {
  validateTarget(env); assert.ok(env.OPS_MANAGEMENT_TOKEN);
  const url = new URL(`https://api.supabase.com/v1/projects/${registry.staging.supabaseProjectRef}/analytics/endpoints/logs`);
  url.searchParams.set("sql", logQuery);
  url.searchParams.set("iso_timestamp_start", new Date(now - 15 * 60000).toISOString());
  url.searchParams.set("iso_timestamp_end", new Date(now).toISOString());
  const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${env.OPS_MANAGEMENT_TOKEN}` } });
  assert.ok(response.ok);
  const result = await response.json();
  assert.ok(!result.error && Array.isArray(result.result) && result.result.length === 1, "Log coverage is unavailable, not a zero-error success.");
  return countsOnly(result.result[0], ["requests", "api_errors", "auth_requests", "auth_failures", "smtp_errors", "database_errors", "storage_errors", "realtime_errors", "reservation_failures"]);
}

export async function vercelSignals(env, execute = command) {
  const selected = registry.staging;
  // Uses an existing CLI login locally or VERCEL_TOKEN in an authorized runner.
  const entry = env.OPS_VERCEL_CLI || path.join(env.APPDATA || "", "npm/node_modules/vercel/dist/index.js");
  assert.ok(path.isAbsolute(entry));
  const childEnv = { ...process.env, ...(env.OPS_VERCEL_TOKEN ? { VERCEL_TOKEN: env.OPS_VERCEL_TOKEN } : {}) };
  const query = `teamId=${selected.vercelTeamId}`;
  const project = JSON.parse((await execute(process.execPath, [entry, "api", `/v9/projects/${selected.vercelProjectId}?${query}`, "--method", "GET", "--raw", "--non-interactive"], { env: childEnv, timeoutMs: 60000 })).toString());
  assert.equal(project.id, selected.vercelProjectId); assert.equal(project.ssoProtection?.deploymentType, "all");
  const deployment = project.targets?.production;
  assert.match(deployment?.id ?? "", /^dpl_[A-Za-z0-9]+$/);
  const detail = JSON.parse((await execute(process.execPath, [entry, "api", `/v13/deployments/${deployment.id}?${query}`, "--method", "GET", "--raw", "--non-interactive"], { env: childEnv, timeoutMs: 60000 })).toString());
  assert.equal(detail.projectId, selected.vercelProjectId);
  const raw = await execute(process.execPath, [entry, "logs", deployment.id, "--project", selected.vercelProjectId, "--no-follow", "--no-branch", "--json", "--since", "15m", "--limit", "1000", "--non-interactive"], { env: childEnv, timeoutMs: 60000, maxBytes: 8000000 });
  const events = raw.toString().trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  return { deployment: { state: ["READY", "ERROR", "CANCELED", "BUILDING", "QUEUED"].includes(detail.readyState) ? detail.readyState : "unknown" },
    runtime: { entries: events.length, truncated: events.length >= 1000, errors: events.filter(event => ["error", "fatal"].includes(event.level)).length,
      serverFailures: events.filter(event => Number(event.statusCode ?? event.status) >= 500).length } };
}

export async function verifiedBackupFreshness(storage, selected, now = Date.now()) {
  const snapshots = await storage.snapshots(), byId = new Map(snapshots.map(item => [item.id, item]));
  const bundles = snapshots.filter(item => item.tags?.includes("component:bundle")).sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const latest = bundles[0];
  if (!latest) return { status: "stale", ageHours: null };
  const chunks = []; let size = 0;
  await storage.dump(latest.id, "bundle", chunk => { size += chunk.length; assert.ok(size < 1000000); chunks.push(chunk); });
  const manifest = JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(manifest.complete, true); assert.equal(manifest.version, 1); assert.equal(manifest.projectRef, registry.staging.supabaseProjectRef);
  assert.ok(latest.tags.includes(`run:${manifest.runId}`));
  for (const component of ["database", "media", "verification"]) {
    assert.match(manifest.snapshots?.[component] ?? "", snapshotId);
    const referenced = byId.get(manifest.snapshots[component]);
    assert.ok(referenced?.tags?.includes(`run:${manifest.runId}`) && referenced.tags.includes(`component:${component}`) && referenced.tags.includes("ucm:staging"), "Incomplete backup bundle.");
  }
  return backupFreshness([latest], now, selected.backupStaleHours);
}

export async function monitor(env, adapters = {}) {
  validateTarget(env);
  const signals = { database: null, logs: null, deployment: null, runtime: null, backup: null };
  try {
    const { client } = await (adapters.connect ?? connect)(env);
    try { signals.database = countsOnly((await client.query(databaseMetricsSql)).rows[0], ["database_bytes", "storage_bytes", "connections", "max_connections", "slow_active_queries", "realtime_database_connections", "deadlocks_total"]); }
    finally { await client.end(); }
  } catch { /* Missing coverage must remain visible. */ }
  try { signals.logs = await (adapters.logs ?? readLogCounts)(env); } catch { /* No raw API body/errors. */ }
  try { Object.assign(signals, await (adapters.vercel ?? vercelSignals)(env)); } catch { /* No raw runtime logs. */ }
  try {
    const selected = validateBackupPolicy(env), storage = adapters.restic ?? resticClient(env);
    await storage.verify(selected.repositoryId);
    signals.backup = await verifiedBackupFreshness(storage, selected);
  } catch { /* An unconfigured/failed backup is not healthy. */ }
  const incidents = evaluateSignals(signals);
  return { version: 1, environment: "staging", sampledAt: new Date().toISOString(), windowMinutes: 15,
    status: incidents.length ? "attention_required" : "healthy", incidents, signals,
    limits: { realtimeDatabaseConnectionsAreNotClientConnections: true, smtpAcceptanceNotTested: true,
      requestVolumeIsNotUniqueUsers: true, restoreTestNotImplied: true } };
}

export async function notify(report, env, fetcher = fetch) {
  validateTarget(env);
  assert.equal(env.OPS_ALERTS_ENABLED, "1");
  assert.ok(policy.staging.monitoringEnabled && policy.staging.alertWebhookOrigin);
  const url = new URL(env.OPS_ALERT_WEBHOOK_URL);
  assert.equal(url.origin, policy.staging.alertWebhookOrigin); assert.equal(url.protocol, "https:"); assert.ok(!url.username && !url.password);
  assert.ok(Array.isArray(report.incidents) && report.incidents.every(code => ["DEPLOYMENT_NOT_READY", "RUNTIME_COVERAGE_INCOMPLETE", "SERVER_ERRORS", "DATABASE_UNAVAILABLE",
    "DATABASE_CONNECTION_PRESSURE", "SLOW_ACTIVE_QUERIES", "CAPACITY_BUDGETS_UNCONFIGURED", "DATABASE_CAPACITY_PRESSURE", "STORAGE_CAPACITY_PRESSURE",
    "SERVICE_LOGS_UNAVAILABLE", "API_ERROR_SPIKE", "AUTH_FAILURE_SPIKE", "TRAFFIC_REVIEW", "SMTP_FAILURES", "DATABASE_ERRORS", "STORAGE_ERRORS", "REALTIME_ERRORS", "RESERVATION_FAILURES", "BACKUP_NOT_VERIFIED_FRESH"].includes(code)));
  assert.equal(new Date(report.sampledAt).toISOString(), report.sampledAt);
  if (!report.incidents.length) return;
  const response = await fetcher(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ application: "UC Online Shop", environment: "staging", sampledAt: report.sampledAt, incidents: report.incidents }) });
  assert.ok(response.ok, "Alert delivery failed; do not silently retry.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(process.argv.length === 2 || process.argv.length === 3 && process.argv[2] === "--notify");
    const report = await monitor(await prepareCa(process.env));
    if (process.argv[2] === "--notify") await notify(report, process.env);
    console.log(JSON.stringify(report));
    if (report.status !== "healthy") process.exitCode = 1;
  } catch { console.error("Monitoring failed or is unconfigured; private service logs and credentials withheld. Do not interpret missing telemetry as healthy."); process.exitCode = 1; }
}
