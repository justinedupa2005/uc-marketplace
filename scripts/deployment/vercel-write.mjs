// Single-request write transport. The CLI automatically retries some writes;
// use its existing login privately, but never retry an ambiguous provider POST.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import environments from "../../config/environments.json" with { type: "json" };

export function assertVercelWrite({ endpoint, method, body }) {
  const url = new URL(endpoint, "https://api.vercel.com");
  assert.equal(url.origin, "https://api.vercel.com");
  assert.ok(!url.username && !url.password && !url.hash && endpoint.startsWith("/"));
  assert.ok(["POST", "PATCH"].includes(method));
  const ids = [environments.staging.vercelProjectId, environments.production.vercelProjectId];
  if (url.pathname === "/v13/deployments") {
    assert.equal(method, "POST");
    assert.equal(environments.production.deploymentEnabled, false);
    assert.equal(body.project, environments.staging.vercelProjectId);
    assert.equal(body.name, "uc-online-shop-staging");
    assert.equal(body.target, "production");
    assert.equal(body.gitSource?.type, "github");
    assert.match(body.gitSource?.sha ?? "", /^[a-f0-9]{40}$/);
    assert.equal(body.gitSource.ref, body.gitSource.sha);
    assert.ok(Number.isSafeInteger(body.gitSource.repoId) && body.gitSource.repoId > 0);
    assert.deepEqual(body.meta, { approvedStagingSha: body.gitSource.sha, marketplaceEnvironment: "staging" });
    assert.deepEqual(Object.keys(body).sort(), ["gitSource", "meta", "name", "project", "target"]);
  } else {
    assert.ok(ids.some((id) => [
      [`/v9/projects/${id}`, "PATCH"], [`/v10/projects/${id}/env`, "POST"],
      ...(id === environments.staging.vercelProjectId ? [[`/v9/projects/${id}/link`, "POST"],
        [`/v9/projects/${id}/branch`, "PATCH"], [`/v10/projects/${id}/protection-bypass`, "PATCH"]] : []),
    ].some(([pathname, verb]) => url.pathname === pathname && method === verb)));
  }
  assert.ok([...url.searchParams.keys()].every((name) => ["teamId", "upsert"].includes(name)));
  assert.equal([...url.searchParams.keys()].length, new Set(url.searchParams.keys()).size);
  if (url.searchParams.has("teamId")) assert.equal(url.searchParams.get("teamId"), environments.staging.vercelTeamId);
  return url.href;
}

export async function writeVercelOnce(operation, token, fetcher = fetch) {
  const url = assertVercelWrite(operation);
  assert.ok(typeof token === "string" && token.length > 20);
  try {
    const response = await fetcher(url, { method: operation.method, redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(operation.body) });
    const data = response.status === 204 ? {} : await response.json();
    if (!response.ok) return { ok: false, status: response.status,
      code: "VERCEL_WRITE_REJECTED", requiredAction: ["Install GitHub App", "Add a Login Connection"].includes(data.error?.action) ? data.error.action : null };
    return { ok: true, data };
  } catch { return { ok: false, code: "VERCEL_WRITE_UNCERTAIN", automaticRetry: false }; }
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) { input += chunk; assert.ok(input.length < 100_000); }
  const operation = JSON.parse(input);
  assertVercelWrite(operation);
  // Windows operator default matches the installed CLI's XDG data directory.
  // Other operators can inject VERCEL_TOKEN privately, never in arguments/files.
  const token = process.env.VERCEL_TOKEN ?? JSON.parse(await readFile(path.join(process.env.APPDATA,
    "com.vercel.cli", "Data", "auth.json"), "utf8")).token;
  const result = await writeVercelOnce(operation, token);
  // This child is ALWAYS captured by vercel.mjs, not forwarded as CLI output.
  process.stdout.write(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch {
    process.stdout.write(JSON.stringify({ ok: false, code: "VERCEL_WRITE_CONFIGURATION", automaticRetry: false }));
    process.exitCode = 1;
  }
}
