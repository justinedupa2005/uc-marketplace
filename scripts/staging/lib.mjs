import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const registry = JSON.parse(await readFile(path.join(root, "config/environments.json"), "utf8"));
export const staging = registry.staging;

export function validateStagingTarget(env) {
  if (!/^[a-z]{20}$/.test(staging.supabaseProjectRef)
      || staging.supabaseProjectRef === registry.production.supabaseProjectRef
      || env.STAGING_PROJECT_REF !== staging.supabaseProjectRef) {
    throw new Error("Explicit registered staging project confirmation is required.");
  }
  if (env.STAGING_ALLOW_MUTATIONS !== "1") throw new Error("Staging writes require STAGING_ALLOW_MUTATIONS=1.");
  if (!env.STAGING_MANAGEMENT_TOKEN) throw new Error("A staging-scoped Management API token is required.");
  return staging.supabaseProjectRef;
}

export function createManagementApi(env, fetcher = fetch) {
  const ref = validateStagingTarget(env);
  return async function api(suffix, { method = "GET", body } = {}) {
    // No caller-supplied host/ref, redirects, query parameters or arbitrary API paths.
    const methods = { "": "GET", "/database/query": "POST", "/database/query/read-only": "POST", "/config/auth": "GET", "/api-keys": "GET", "/types/typescript?included_schemas=public": "GET" };
    if (methods[suffix] !== method) {
      throw new Error("Unrecognized staging API operation.");
    }
    let response;
    try {
      response = await fetcher(`https://api.supabase.com/v1/projects/${ref}${suffix}`, {
        method, redirect: "error", signal: AbortSignal.timeout(60_000),
        headers: { Authorization: `Bearer ${env.STAGING_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error("Staging API transport failed; private details withheld."); }
    if (!response.ok) throw new Error(`Staging API operation rejected (HTTP ${response.status}); private details withheld.`);
    try { return await response.json(); } catch { throw new Error("Staging API returned an invalid response."); }
  };
}

export async function verifyStagingProject(api) {
  const project = await api("");
  if ((project.id ?? project.ref) !== staging.supabaseProjectRef || project.name !== staging.supabaseProjectName
      || project.status !== "ACTIVE_HEALTHY") throw new Error("Staging project identity or health check failed.");
}

export async function loadMigrations(directory = path.join(root, "supabase/migrations")) {
  const names = (await readdir(directory)).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error("No versioned migrations found.");
  return Promise.all(names.map(async (filename) => {
    const query = (await readFile(path.join(directory, filename), "utf8")).replaceAll("\r\n", "\n");
    if (!/^(?:\s|--[^\n]*\n)*begin;/i.test(query) || !/commit;\s*$/i.test(query)) {
      throw new Error("Staging migrations must have explicit outer begin/commit boundaries.");
    }
    return { version: filename.slice(0, 14), name: filename.slice(15, -4), query,
      checksum: createHash("sha256").update(query).digest("hex") };
  }));
}

export function planMigrations(migrations, applied) {
  const byVersion = new Map(migrations.map((item) => [item.version, item]));
  for (const item of applied) {
    const local = byVersion.get(item.version);
    if (!local || item.checksum !== local.checksum) throw new Error("Staging migration history drift detected; review manually without resetting data.");
  }
  const versions = new Set(applied.map((item) => item.version));
  const pending = migrations.filter((item) => !versions.has(item.version));
  if (pending.some((item) => applied.some((entry) => entry.version > item.version))) {
    throw new Error("Out-of-order staging migration refused.");
  }
  return pending;
}

export function migrationQuery(migration) {
  if (!/^\d{14}$/.test(migration.version) || !/^[a-z0-9_]+$/.test(migration.name)
      || !/^[a-f0-9]{64}$/.test(migration.checksum)) throw new Error("Invalid migration identity.");
  const delimiter = "$uc_staging_migration$";
  if (migration.query.includes(delimiter)) throw new Error("Migration contains a reserved SQL delimiter.");
  const history = `
insert into supabase_migrations.schema_migrations (version,name,statements)
values ('${migration.version}','${migration.name}',array[${delimiter}${migration.query}${delimiter}]);
insert into supabase_migrations.uc_staging_checksums (version,checksum)
values ('${migration.version}','${migration.checksum}');
commit;`;
  // The schema changes and history entry commit together. An ambiguous timeout
  // can be diagnosed by rerunning the read-only plan; never retry a write blindly.
  return migration.query.replace(/commit;\s*$/i, history);
}

export function validateFixtureCredentials(value) {
  const roles = ["admin", "pending", "seller", "buyer", "suspended"];
  if (!value || Object.keys(value).length !== roles.length || roles.some((role) => typeof value[role] !== "string"
      || value[role].length < 24 || value[role].length > 128
      || !/[a-z]/.test(value[role]) || !/[A-Z]/.test(value[role]) || !/\d/.test(value[role]))) {
    throw new Error("Provide strong, unique synthetic account passwords through private stdin.");
  }
  if (new Set(Object.values(value)).size !== roles.length) throw new Error("Synthetic account passwords must be unique.");
  return roles.map((role) => ({ role, email: `staging-${role}@example.test`, password: value[role] }));
}

export function fixtureStoragePaths(accountId, recordId) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(accountId) || !uuid.test(recordId)) throw new Error("Synthetic Storage paths require UUID identities.");
  return {
    verification: `${accountId}/${recordId}/student-id.png`,
    listing: `${accountId}/${recordId}/${recordId}.png`,
  };
}
