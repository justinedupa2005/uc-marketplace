import assert from "node:assert/strict";
import { runId } from "./policy.mjs";

export function backblazeEndpoint(value) {
  assert.equal(typeof value, "string", "B2_ENDPOINT_REQUIRED");
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.port && url.pathname === "/" && !url.search && !url.hash,
    "B2_ENDPOINT_INVALID");
  assert.match(url.hostname, /^s3\.[a-z0-9-]+\.backblazeb2\.com$/, "B2_ENDPOINT_INVALID");
  return url.origin;
}

export function syntheticRepository(env, authorized, bucket, id) {
  assert.match(id, runId);
  const endpoint = backblazeEndpoint(env.B2_ENDPOINT);
  assert.match(env.B2_BUCKET_NAME ?? "", /^[a-zA-Z0-9][a-zA-Z0-9-]{4,61}[a-zA-Z0-9]$/, "B2_BUCKET_NAME_INVALID");
  const storage = authorized.apiInfo?.storageApi, allowed = storage?.allowed;
  assert.equal(storage?.s3ApiUrl, endpoint, "B2_ENDPOINT_ACCOUNT_MISMATCH");
  assert.ok(typeof authorized.accountId === "string" && authorized.accountId.length > 0, "B2_ACCOUNT_INVALID");
  assert.ok(typeof authorized.authorizationToken === "string" && authorized.authorizationToken.length > 0, "B2_TOKEN_INVALID");
  // Reject account-wide/master keys. A synthetic drill must never need account,
  // bucket-policy, key-management or object-lock administrative permissions.
  assert.ok(Array.isArray(allowed?.buckets) && allowed.buckets.length === 1, "B2_SINGLE_BUCKET_KEY_REQUIRED");
  assert.equal(allowed.buckets[0].name, env.B2_BUCKET_NAME, "B2_BUCKET_KEY_MISMATCH");
  const capabilities = allowed.capabilities;
  assert.ok(Array.isArray(capabilities) && ["listBuckets", "listFiles", "readFiles", "writeFiles", "deleteFiles"].every(name => capabilities.includes(name)),
    "B2_RESTIC_CAPABILITIES_REQUIRED");
  assert.ok(!capabilities.some(name => /^(?:writeBuckets|deleteBuckets|writeKeys|deleteKeys|bypassGovernance|writeBucket|writeFile)/.test(name) && name !== "writeFiles"),
    "B2_ADMINISTRATIVE_KEY_REFUSED");
  assert.equal(bucket?.accountId, authorized.accountId, "B2_BUCKET_ACCOUNT_MISMATCH");
  assert.equal(bucket?.bucketId, allowed.buckets[0].id, "B2_BUCKET_ID_MISMATCH");
  assert.equal(bucket?.bucketName, env.B2_BUCKET_NAME, "B2_BUCKET_NAME_MISMATCH");
  assert.equal(bucket?.bucketType, "allPrivate", "B2_PRIVATE_BUCKET_REQUIRED");
  const prefix = allowed.namePrefix ?? "";
  assert.ok(prefix === "" || /^(?:[a-zA-Z0-9_-]+\/)+$/.test(prefix), "B2_SAFE_PREFIX_REQUIRED");
  // Always a fresh UUID child of the key's permitted prefix. No caller can
  // supply or adopt a live backup repository, path, project or snapshot.
  return { repository: `s3:${endpoint}/${env.B2_BUCKET_NAME}/${prefix}ucm-synthetic-tests/${id}`,
    prefix: `${prefix}ucm-synthetic-tests/${id}`, region: new URL(endpoint).hostname.split(".")[1] };
}

async function privateJson(fetcher, url, init, authentication = false) {
  const response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (response.status === 401) throw new Error(authentication ? "B2_AUTHENTICATION_FAILED" : "B2_METADATA_PERMISSION_DENIED");
  if (response.status === 403) throw new Error("B2_REQUEST_FORBIDDEN");
  if (response.status === 429) throw new Error("B2_REQUEST_THROTTLED");
  if (response.status >= 500) throw new Error("B2_SERVICE_UNAVAILABLE");
  assert.equal(response.status, 200, "B2_METADATA_REQUEST_FAILED");
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length; assert.ok(size <= 1000000, "B2_METADATA_TOO_LARGE"); chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

export async function verifyBackblaze(env, id, fetcher = fetch) {
  backblazeEndpoint(env.B2_ENDPOINT); // Validate before sending any credentials.
  assert.match(env.B2_KEY_ID ?? "", /^[a-zA-Z0-9]{10,100}$/, "B2_KEY_ID_REQUIRED");
  assert.ok(typeof env.B2_APPLICATION_KEY === "string" && /^[a-zA-Z0-9+/=_-]{20,200}$/.test(env.B2_APPLICATION_KEY), "B2_APPLICATION_KEY_REQUIRED");
  const authorized = await privateJson(fetcher, "https://api.backblazeb2.com/b2api/v4/b2_authorize_account", {
    headers: { Authorization: `Basic ${Buffer.from(`${env.B2_KEY_ID}:${env.B2_APPLICATION_KEY}`).toString("base64")}` },
  }, true);
  const api = new URL(authorized.apiInfo?.storageApi?.apiUrl);
  assert.ok(api.protocol === "https:" && /^api\d+\.backblazeb2\.com$/.test(api.hostname) && api.pathname === "/" &&
    !api.username && !api.password && !api.port && !api.search && !api.hash, "B2_NATIVE_ENDPOINT_INVALID");
  const result = await privateJson(fetcher, new URL("/b2api/v4/b2_list_buckets", api), {
    method: "POST", headers: { Authorization: authorized.authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ accountId: authorized.accountId, bucketName: env.B2_BUCKET_NAME }),
  });
  assert.ok(Array.isArray(result.buckets) && result.buckets.length === 1, "B2_BUCKET_NOT_UNIQUE");
  return syntheticRepository(env, authorized, result.buckets[0], id);
}
