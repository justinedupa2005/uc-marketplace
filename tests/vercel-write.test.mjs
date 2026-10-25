import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { assertVercelWrite, writeVercelOnce } from "../scripts/deployment/vercel-write.mjs";
import { deploymentPayload } from "../scripts/deployment/staging.mjs";
import { registry } from "../scripts/deployment/vercel.mjs";

const operation = () => ({ endpoint: `/v13/deployments?teamId=${registry.staging.vercelTeamId}`, method: "POST", body: deploymentPayload("a".repeat(40), 12345) });
const token = () => randomBytes(32).toString("hex");

test("write transport accepts only registered project operations, never external hosts or production deployment", () => {
  assert.equal(new URL(assertVercelWrite(operation())).origin, "https://api.vercel.com");
  for (const patch of [{ endpoint: "https://evil.test/v13/deployments" }, { endpoint: "//evil.test/v13/deployments" },
    { endpoint: "/v13/deployments?teamId=another-team" }, { method: "DELETE" },
    { body: { ...operation().body, project: registry.production.vercelProjectId } },
    { body: { ...operation().body, env: { PRIVATE_VALUE: "not-uploaded" } } },
    { body: { ...operation().body, files: [] } }, { body: { ...operation().body, gitSource: { type: "github", ref: "main", sha: "a".repeat(40) } } }]) {
    assert.throws(() => assertVercelWrite({ ...operation(), ...patch }));
  }
  assert.throws(() => assertVercelWrite({ endpoint: `/v9/projects/${registry.production.vercelProjectId}/link`, method: "POST", body: {} }));
});

test("successful immutable deployment is one HTTPS request with no redirects or credential arguments", async () => {
  const secret = token(); let calls = 0;
  const result = await writeVercelOnce(operation(), secret, async (url, options) => {
    calls += 1; assert.equal(new URL(url).hostname, "api.vercel.com");
    assert.equal(options.redirect, "error"); assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    assert.equal(JSON.stringify(options.body).includes(secret), false);
    return new Response(JSON.stringify({ id: "dpl_synthetic" }), { status: 200 });
  });
  assert.equal(calls, 1); assert.deepEqual(result, { ok: true, data: { id: "dpl_synthetic" } });
});

test("HTTP failures and ambiguous network failures are never automatically retried or disclosed", async () => {
  const secret = token();
  for (const status of [400, 401, 429, 500, 503]) {
    let calls = 0;
    const result = await writeVercelOnce(operation(), secret, async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: secret, action: "Install GitHub App" } }), { status });
    });
    assert.equal(calls, 1); assert.equal(result.ok, false); assert.equal(result.status, status);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  let calls = 0;
  const result = await writeVercelOnce(operation(), secret, async () => { calls += 1; throw new Error(secret); });
  assert.equal(calls, 1); assert.deepEqual(result, { ok: false, code: "VERCEL_WRITE_UNCERTAIN", automaticRetry: false });
});

test("rejected targets cannot read credentials or initiate a request", async () => {
  let calls = 0;
  await assert.rejects(writeVercelOnce({ ...operation(), endpoint: "/v13/deployments?redirect=evil" }, token(), async () => { calls += 1; }));
  assert.equal(calls, 0);
});
