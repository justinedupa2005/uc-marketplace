import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { backblazeEndpoint, syntheticRepository, verifyBackblaze, b2SecretNames, backblazeConfiguration, backblazeSecretStatus } from "../scripts/operations/backblaze.mjs";
import { backblazeDrill } from "../scripts/operations/backblaze-drill.mjs";
import { backblazeFailure, resticFailureCodes } from "../scripts/operations/diagnostics.mjs";
import { command } from "../scripts/operations/process.mjs";

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

test("B2 failure records expose only fixed phase and code enums, never assertion differences, URLs or arbitrary fields", () => {
  const privateValue = "DO_NOT_LOG/student-id/key/password?token=private";
  const error = Object.assign(new Error(`B2_BUCKET_NAME_MISMATCH\n${privateValue}`), { operationCodes: [privateValue, "S3_ACCESS_DENIED"], token: privateValue });
  assert.deepEqual(backblazeFailure(error, "b2-preflight"), { failureCode: "B2_BUCKET_NAME_MISMATCH", failurePhase: "b2-preflight", operationCodes: ["S3_ACCESS_DENIED"] });
  assert.deepEqual(backblazeFailure(new Error(privateValue), privateValue), { failureCode: "B2_OPERATION_FAILED", failurePhase: "configuration", operationCodes: [] });
  assert.ok(!JSON.stringify(backblazeFailure(error, "b2-preflight")).includes("DO_NOT_LOG"));
  let assertion;
  try { syntheticRepository(env, authorized, { ...bucket, bucketType: "allPublic" }, id); } catch (error) { assertion = error; }
  assert.equal(backblazeFailure(assertion, "b2-preflight").failureCode, "B2_PRIVATE_BUCKET_REQUIRED");
});

test("B2 HTTP errors distinguish authentication, metadata permission, forbidden requests, throttling and provider outages without body disclosure", async () => {
  for (const [status, expected] of [[401, "B2_AUTHENTICATION_FAILED"], [403, "B2_REQUEST_FORBIDDEN"], [429, "B2_REQUEST_THROTTLED"], [503, "B2_SERVICE_UNAVAILABLE"]]) {
    await assert.rejects(verifyBackblaze(env, id, async () => new Response("DO_NOT_LOG private provider error", { status })),
      error => backblazeFailure(error, "b2-preflight").failureCode === expected && !error.message.includes("DO_NOT_LOG"));
  }
  let calls = 0;
  await assert.rejects(verifyBackblaze(env, id, async () => ++calls === 1 ? new Response(JSON.stringify(authorized)) : new Response("DO_NOT_LOG", { status: 401 })),
    error => backblazeFailure(error, "b2-preflight").failureCode === "B2_METADATA_PERMISSION_DENIED");
});

test("failed B2 preflight never initializes or writes an off-site repository and preserves a safe diagnostic", async () => {
  let writes = 0;
  await assert.rejects(backblazeDrill({ ...env, OPS_B2_SYNTHETIC_CONFIRM: "synthetic-only" }, {
    verify: async () => { throw new Error("B2_SINGLE_BUCKET_KEY_REQUIRED\nDO_NOT_LOG"); }, execute: async () => { writes++; },
  }), error => error.message === "Backblaze synthetic drill failed." && !error.cause && error.diagnostic.failurePhase === "b2-preflight" &&
    error.diagnostic.failureCode === "B2_SINGLE_BUCKET_KEY_REQUIRED" && !JSON.stringify(error).includes("DO_NOT_LOG"));
  assert.equal(writes, 0);
});

test("restic diagnostics classify fixed failure categories without returning matching provider text", async () => {
  assert.deepEqual(resticFailureCodes("DO_NOT_LOG token=private AccessDenied"), ["S3_ACCESS_DENIED"]);
  assert.deepEqual(resticFailureCodes("SignatureDoesNotMatch DO_NOT_LOG"), ["S3_SIGNATURE_REJECTED"]);
  assert.deepEqual(resticFailureCodes("private provider message with no known category"), []);
  await assert.rejects(command(process.execPath, ["-e", "process.stderr.write('AccessDenied DO_NOT_LOG token=private'); process.exit(1)"], { resticDiagnostics: true }),
    error => error.message === "Private operation failed." && error.operationCodes[0] === "S3_ACCESS_DENIED" && !JSON.stringify(error).includes("DO_NOT_LOG"));
});

test("B2 repository failures identify their phase without revealing command stderr or continuing to backup", async () => {
  let calls = 0;
  await assert.rejects(backblazeDrill({ ...env, OPS_B2_SYNTHETIC_CONFIRM: "synthetic-only" }, {
    verify: async () => ({ repository: "s3:https://s3.us-west-004.backblazeb2.com/synthetic-bucket/test-only", region: "us-west-004" }),
    execute: async (_binary, args) => { calls++; if (args[0] === "version") return Buffer.from("restic 0.19.1");
      throw Object.assign(new Error("DO_NOT_LOG private bucket/key"), { operationCodes: ["S3_ACCESS_DENIED", "DO_NOT_LOG"] }); },
  }), error => error.diagnostic.failurePhase === "repository-init" && error.diagnostic.operationCodes.join() === "S3_ACCESS_DENIED" && !JSON.stringify(error).includes("DO_NOT_LOG"));
  assert.equal(calls, 2);
});

test("B2 configuration trims paste boundaries without changing stored inputs or accepting internal whitespace", () => {
  const wrapped = Object.fromEntries(Object.entries(env).map(([name, value]) => [name, `\r\n ${value} \n`]));
  const before = { ...wrapped };
  assert.deepEqual(backblazeConfiguration(wrapped), env);
  assert.deepEqual(wrapped, before);
  for (const name of b2SecretNames) assert.deepEqual(backblazeSecretStatus(wrapped)[name], { present: true, surroundingWhitespace: true });
  assert.deepEqual(backblazeSecretStatus({ B2_KEY_ID: "DO_NOT_LOG\n", OTHER: "DO_NOT_LOG" }), {
    B2_KEY_ID: { present: true, surroundingWhitespace: true }, B2_APPLICATION_KEY: { present: false, surroundingWhitespace: false },
    B2_BUCKET_NAME: { present: false, surroundingWhitespace: false }, B2_ENDPOINT: { present: false, surroundingWhitespace: false },
  });
  assert.throws(() => backblazeConfiguration({ ...env, B2_KEY_ID: "synthetic KeyId" }), /B2_KEY_ID_INVALID/);
  assert.throws(() => backblazeConfiguration({ ...env, B2_APPLICATION_KEY: "synthetic-key with-internal-whitespace" }), /B2_APPLICATION_KEY_INVALID/);
});

test("B2 configuration distinguishes missing input from invalid input before any API request", async () => {
  let requests = 0;
  for (const name of b2SecretNames) for (const value of [undefined, "", "\r\n "]) {
    await assert.rejects(verifyBackblaze({ ...env, [name]: value }, id, async () => { requests++; }), error =>
      backblazeFailure(error, "configuration").failureCode === `${name}_REQUIRED`);
  }
  for (const [name, value] of [["B2_KEY_ID", "invalid internal spaces"], ["B2_APPLICATION_KEY", "not:a:valid:application:key"]]) {
    await assert.rejects(verifyBackblaze({ ...env, [name]: value }, id, async () => { requests++; }), error =>
      backblazeFailure(error, "configuration").failureCode === `${name}_INVALID`);
  }
  assert.equal(requests, 0);
});

test("native B2 authentication receives exactly the normalized credential pair and selected bucket", async () => {
  const wrapped = Object.fromEntries(Object.entries(env).map(([name, value]) => [name, `\n${value}\r\n`]));
  let requests = 0;
  const result = await verifyBackblaze(wrapped, id, async (_url, init) => {
    requests++;
    if (requests === 1) {
      assert.equal(init.headers.Authorization, `Basic ${Buffer.from(`${env.B2_KEY_ID}:${env.B2_APPLICATION_KEY}`).toString("base64")}`);
      return new Response(JSON.stringify(authorized));
    }
    assert.equal(JSON.parse(init.body).bucketName, env.B2_BUCKET_NAME);
    return new Response(JSON.stringify({ buckets: [bucket] }));
  });
  assert.equal(requests, 2); assert.ok(result.repository.includes(`/${env.B2_BUCKET_NAME}/`));
});

test("the B2 drill passes the same normalized credentials to native preflight and restic without modifying the caller", async () => {
  const wrapped = Object.fromEntries(Object.entries(env).map(([name, value]) => [name, `\n${value}\r\n`]));
  const source = { ...wrapped, OPS_B2_SYNTHETIC_CONFIRM: "synthetic-only" }, before = { ...source };
  let authenticated = false, resticChecked = false;
  await assert.rejects(backblazeDrill(source, {
    verify: async selected => {
      assert.deepEqual(selected, env); authenticated = true;
      return { repository: "s3:https://s3.us-west-004.backblazeb2.com/synthetic-bucket/test-only", region: "us-west-004" };
    },
    execute: async (_binary, args, options) => {
      assert.equal(options.env.AWS_ACCESS_KEY_ID, env.B2_KEY_ID);
      assert.equal(options.env.AWS_SECRET_ACCESS_KEY, env.B2_APPLICATION_KEY);
      resticChecked = true;
      if (args[0] === "version") return Buffer.from("restic 0.19.1");
      throw new Error("Stop before any off-site writes.");
    },
  }), error => error.diagnostic.failurePhase === "repository-init");
  assert.equal(authenticated, true); assert.equal(resticChecked, true); assert.deepEqual(source, before);
});

test("synthetic Backblaze is a protected direct job with four explicit step-only secret bindings, not a reusable workflow", async () => {
  const workflow = (await readFile(new URL("../.github/workflows/security-qa.yml", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const marker = "\n  synthetic-backblaze:\n", index = workflow.indexOf(marker); assert.ok(index > 0);
  const job = workflow.slice(index), credentialStep = job.slice(job.indexOf("      - name: Encrypt and restore only generated images"));
  assert.match(job, /\n    environment: staging\n/);
  assert.ok(!/^    uses:/m.test(job)); assert.ok(!/^\s+secrets:\s+inherit\s*$/m.test(job));
  for (const name of b2SecretNames) {
    const binding = name + ": ${{ secrets." + name + " }}";
    assert.ok(credentialStep.includes(binding)); assert.equal(workflow.split(binding).length - 1, 1);
    assert.ok(!job.slice(0, job.indexOf("      - name: Encrypt and restore only generated images")).includes("secrets." + name));
  }
  assert.ok(!workflow.slice(0, index).includes("secrets.B2_"));
});
