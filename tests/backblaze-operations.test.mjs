import assert from "node:assert/strict";
import { test } from "node:test";
import { backblazeEndpoint, syntheticRepository, verifyBackblaze } from "../scripts/operations/backblaze.mjs";
import { backblazeDrill } from "../scripts/operations/backblaze-drill.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const env = { B2_ENDPOINT: "s3.us-west-004.backblazeb2.com", B2_BUCKET_NAME: "synthetic-bucket", B2_KEY_ID: "syntheticKeyId",
  B2_APPLICATION_KEY: "synthetic-application-key-for-unit-tests" };
const authorized = { accountId: "synthetic-account", authorizationToken: "private-authorization", apiInfo: { storageApi: {
  apiUrl: "https://api004.backblazeb2.com", s3ApiUrl: `https://${env.B2_ENDPOINT}`,
  allowed: { buckets: [{ name: env.B2_BUCKET_NAME, id: "synthetic-bucket-id" }], namePrefix: "marketplace/",
    capabilities: ["listBuckets", "listFiles", "readFiles", "writeFiles", "deleteFiles"] },
} } };
const bucket = { accountId: authorized.accountId, bucketId: "synthetic-bucket-id", bucketName: env.B2_BUCKET_NAME, bucketType: "allPrivate" };

test("Backblaze synthetic repositories use only matched HTTPS B2 endpoints and fresh UUID children", () => {
  const target = syntheticRepository(env, authorized, bucket, id);
  assert.equal(target.repository, `s3:https://${env.B2_ENDPOINT}/${env.B2_BUCKET_NAME}/marketplace/ucm-synthetic-tests/${id}`);
  assert.equal(target.region, "us-west-004");
  assert.throws(() => syntheticRepository(env, authorized, bucket, "existing-live-repository"));
  for (const value of ["http://s3.us-west-004.backblazeb2.com", "https://user:secret@s3.us-west-004.backblazeb2.com",
    "https://s3.us-west-004.backblazeb2.com.evil.test", "https://s3.us-west-004.backblazeb2.com/path", "https://s3.us-west-004.backblazeb2.com?secret=x"])
    assert.throws(() => backblazeEndpoint(value));
});

test("Backblaze drill rejects public buckets, master/admin keys, account mismatch, unsafe prefixes and missing capabilities", () => {
  for (const changes of [{ bucketType: "allPublic" }, { accountId: "other" }, { bucketId: "other" }, { bucketName: "other" }])
    assert.throws(() => syntheticRepository(env, authorized, { ...bucket, ...changes }, id));
  for (const changes of [{ buckets: null }, { buckets: [] }, { namePrefix: "../live/" }, { namePrefix: "live" }, { capabilities: ["writeFiles"] },
    { capabilities: [...authorized.apiInfo.storageApi.allowed.capabilities, "writeBuckets"] },
    { capabilities: [...authorized.apiInfo.storageApi.allowed.capabilities, "writeKeys"] },
    { buckets: [{ name: "other", id: bucket.bucketId }] }]) {
    const changed = { ...authorized, apiInfo: { storageApi: { ...authorized.apiInfo.storageApi, allowed: { ...authorized.apiInfo.storageApi.allowed, ...changes } } } };
    assert.throws(() => syntheticRepository(env, changed, bucket, id));
  }
  assert.throws(() => syntheticRepository({ ...env, B2_ENDPOINT: "s3.us-east-005.backblazeb2.com" }, authorized, bucket, id));
});

test("Backblaze metadata verification queries only the selected bucket and never follows redirects", async () => {
  const calls = [];
  const target = await verifyBackblaze(env, id, async (url, init) => {
    calls.push({ url: String(url), init }); assert.equal(init.redirect, "error");
    return new Response(JSON.stringify(calls.length === 1 ? authorized : { buckets: [bucket] }));
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.backblazeb2.com/b2api/v4/b2_authorize_account");
  assert.deepEqual(JSON.parse(calls[1].init.body), { accountId: authorized.accountId, bucketName: env.B2_BUCKET_NAME });
  assert.equal(target.prefix, `marketplace/ucm-synthetic-tests/${id}`);
});

test("Backblaze metadata failures and unexpected native endpoints fail before any object writes", async () => {
  for (const response of [new Response("private credentials", { status: 403 }), new Response("x".repeat(1000001))])
    await assert.rejects(verifyBackblaze(env, id, async () => response));
  let calls = 0;
  await assert.rejects(verifyBackblaze(env, id, async () => {
    calls++; return new Response(JSON.stringify({ ...authorized, apiInfo: { storageApi: { ...authorized.apiInfo.storageApi, apiUrl: "https://attacker.test" } } }));
  }));
  assert.equal(calls, 1);
});

test("synthetic B2 drills require explicit confirmation and reject injected real Supabase credentials before network access", async () => {
  await assert.rejects(backblazeDrill({}));
  for (const name of ["OPS_DATABASE_URL", "OPS_SERVICE_ROLE_KEY", "OPS_MANAGEMENT_TOKEN"])
    await assert.rejects(backblazeDrill({ OPS_B2_SYNTHETIC_CONFIRM: "synthetic-only", [name]: "private-never-read" }));
});
