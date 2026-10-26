import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { registry, vercelApi } from "./vercel.mjs";
import { assertStagingProject } from "./staging.mjs";
import { validateHostedInput } from "../staging/e2e-policy.mjs";

export async function withStagingBypass(input, operation, { api = vercelApi, journal = async (file, value, initial) => {
  await mkdir(".qa", { recursive: true });
  await writeFile(file, JSON.stringify(value), initial ? { flag: "wx" } : undefined);
} } = {}) {
  validateHostedInput(input);
  const s = registry.staging, team = `teamId=${s.vercelTeamId}`;
  const projectPath = `/v9/projects/${s.vercelProjectId}?${team}`;
  const endpoint = `/v1/projects/${s.vercelProjectId}/protection-bypass?${team}`;
  const project = await api(projectPath);
  assertStagingProject(project, { linked: true });
  const deployment = await api(`/v13/deployments/${input.deploymentId}?${team}`);
  assert.equal(deployment.projectId, s.vercelProjectId);
  assert.equal(deployment.readyState, "READY");
  assert.equal(deployment.meta?.githubCommitSha, input.sha);
  assert.equal(project.targets?.production?.id, input.deploymentId);
  const before = project.protectionBypass ?? {};
  const note = `Temporary Step 8 ${input.sha.slice(0, 12)} ${randomUUID()}`;
  const file = `.qa/staging-e2e-bypass-${randomUUID()}.json`;
  const record = { projectId: s.vercelProjectId, sha: input.sha, note };
  await journal(file, { ...record, state: "request_pending" }, true);
  // Journal before the single write. On an uncertain response, discover our
  // token by this unique note, never retry generation or revoke others' keys.
  try {
    const created = await api(endpoint, "PATCH", { generate: { note } });
    const matches = Object.entries(created.protectionBypass ?? {}).filter(([key, value]) => !Object.hasOwn(before, key) && value.note === note);
    assert.equal(matches.length, 1);
    const [secret, descriptor] = matches[0];
    assert.match(secret, /^[A-Za-z0-9]{32}$/);
    assert.equal(descriptor.scope, "automation-bypass");
    assertStagingProject(await api(projectPath), { linked: true });
    return await operation(secret);
  } finally {
    let current = await api(projectPath);
    for (const [secret, value] of Object.entries(current.protectionBypass ?? {})) {
      if (!Object.hasOwn(before, secret) && value.note === note) {
        await api(endpoint, "PATCH", { revoke: { secret, regenerate: false } });
      }
    }
    current = await api(projectPath);
    assertStagingProject(current, { linked: true });
    assert.ok(!Object.values(current.protectionBypass ?? {}).some((value) => value.note === note));
    for (const [key, value] of Object.entries(before)) assert.deepEqual(current.protectionBypass?.[key], value);
    await journal(file, { ...record, state: "revoked", previousBypassesPreserved: true }, false);
  }
}
