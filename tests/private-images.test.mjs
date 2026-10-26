import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  hasPrivateImageSignature, isOwnedPrivateImagePath, parsePrivateImagePaths,
  PRIVATE_IMAGE_MAX_BYTES, readPrivateImage,
} from "../src/features/uploads/private-images.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const owner = "11111111-1111-4111-8111-111111111111";
const parent = "22222222-2222-4222-8222-222222222222";
const nonce = "33333333-3333-4333-8333-333333333333";
const imagePath = `${owner}/${parent}/${nonce}.png`;
const signatures = { "image/png": [137, 80, 78, 71, 13, 10, 26, 10], "image/jpeg": [255, 216, 255], "image/webp": [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80] };
function image(type = "image/png", size = 12, valid = true) {
  const bytes = new Uint8Array(size);
  if (valid) bytes.set((signatures[type] ?? []).slice(0, size));
  return new File([bytes], "synthetic-image", { type });
}

function compile(relative, overrides = {}, expose = "") {
  const filename = path.join(root, relative);
  const nativeRequire = createRequire(filename);
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code + expose)(
    (name) => Object.hasOwn(overrides, name) ? overrides[name] : name.startsWith("@/") || name.startsWith("./") || name.startsWith("next/") ? {} : nativeRequire(name), mod, mod.exports,
  );
  return mod.exports;
}

test("private paths are exact UUID owner/resource paths, never URLs, traversal or foreign resources", () => {
  assert.equal(isOwnedPrivateImagePath(imagePath, owner, parent, "listing"), true);
  const document = `${owner}/${parent}/student-id.webp`;
  assert.equal(isOwnedPrivateImagePath(document, owner, parent, "verification"), true);
  for (const value of [imagePath.replace(owner, nonce), imagePath.replace(parent, nonce), `${imagePath}/extra`, imagePath.replace(nonce, ".."), imagePath.replace(".png", ".svg"), `https://storage.invalid/${imagePath}`, `${imagePath}?token=x`, document]) {
    assert.equal(isOwnedPrivateImagePath(value, owner, parent, "listing"), false);
  }
  assert.equal(isOwnedPrivateImagePath(imagePath, owner, parent, "verification"), false);
});

test("private image manifests are bounded, nonempty, unique string arrays", () => {
  assert.deepEqual(parsePrivateImagePaths(JSON.stringify([imagePath])), [imagePath]);
  for (const value of [null, new File(["not metadata"], "x"), "{}", "null", "[]", "broken", JSON.stringify([imagePath, imagePath]), JSON.stringify([1]), JSON.stringify(["x".repeat(161)]), JSON.stringify(Array.from({ length: 6 }, (_, i) => `${imagePath}${i}`)), " ".repeat(2501)]) {
    assert.equal(parsePrivateImagePaths(value), null);
  }
});

test("stored-image validation accepts each real signature and exactly the existing 5 MiB limit", async () => {
  for (const type of Object.keys(signatures)) assert.equal(await hasPrivateImageSignature(image(type)), true);
  for (const size of [12, PRIVATE_IMAGE_MAX_BYTES]) {
    const file = image("image/png", size);
    const result = await readPrivateImage({ async info() { return { data: { size, contentType: file.type }, error: null }; }, async download() { return { data: file, error: null }; } }, imagePath);
    assert.equal(result?.size, size);
    assert.equal(result?.type, "image/png");
  }
});

test("untrusted, missing, oversized, empty and disallowed Storage metadata is rejected before downloading bytes", async () => {
  for (const data of [null, {}, { size: 0, contentType: "image/png" }, { size: -1, contentType: "image/png" }, { size: PRIVATE_IMAGE_MAX_BYTES + 1, contentType: "image/png" }, { size: "12", contentType: "image/png" }, { size: 1.5, contentType: "image/png" }, { size: 12, contentType: "text/html" }, { size: 12, contentType: "image/svg+xml" }]) {
    assert.equal(await readPrivateImage({ async info() { return { data, error: null }; }, async download() { assert.fail("Invalid metadata must never trigger a download"); } }, imagePath), null);
  }
});

test("stored bytes, MIME, extension and actual size must agree, and Storage failures fail closed", async () => {
  for (const file of [image("image/png", 12, false), image("image/png", 11), image("image/jpeg", 12), image("text/html", 12)]) {
    assert.equal(await readPrivateImage({ async info() { return { data: { size: 12, contentType: "image/png" }, error: null }; }, async download() { return { data: file, error: null }; } }, imagePath), null);
  }
  const bucket = { async info() { return { data: { size: 12, contentType: "image/png" }, error: null }; }, async download() { throw new Error("private transport diagnostic"); } };
  assert.equal(await readPrivateImage(bucket, imagePath), null);
  assert.equal(await readPrivateImage({ ...bucket, async info() { throw new Error("private metadata diagnostic"); } }, imagePath), null);
  assert.equal(await readPrivateImage({ ...bucket, async download() { assert.fail("A mismatched extension must not be downloaded"); } }, imagePath.replace(".png", ".jpg")), null);
});

function directFixture({ failAt = -1, throwAt = -1 } = {}) {
  const uploaded = [];
  const removed = [];
  const policy = compile("src/features/uploads/private-images.ts");
  const api = compile("src/features/uploads/direct-upload.ts", {
    "./private-images": policy,
    "@/lib/supabase/client": { createClient: () => ({ storage: { from: (bucket) => ({
      async upload(objectPath, file, options) {
        uploaded.push({ bucket, path: objectPath, file, options });
        if (uploaded.length - 1 === throwAt) throw new Error("private network response");
        return { error: uploaded.length - 1 === failAt ? { name: "StorageApiError" } : null };
      },
      async remove(paths) { removed.push(...paths); return { error: null }; },
    }) } }) },
  });
  return { api, uploaded, removed, policy };
}

test("direct uploads use the session client, fixed private bucket, immutable objects and unchanged 5 MiB limit", async () => {
  const fixture = directFixture();
  const file = image("image/png", PRIVATE_IMAGE_MAX_BYTES);
  assert.equal(await fixture.api.validateDirectImages([file]), true);
  assert.equal(await fixture.api.uploadPrivateImages("student-verifications", [imagePath], [file]), true);
  assert.deepEqual(fixture.uploaded[0], { bucket: "student-verifications", path: imagePath, file, options: { contentType: "image/png", cacheControl: "0", upsert: false } });
  assert.deepEqual(fixture.removed, []);
  for (const files of [[], Array(6).fill(image()), [image("image/png", PRIVATE_IMAGE_MAX_BYTES + 1)], [image("text/html")], [image("image/png", 12, false)], [image("image/png", 0)]]) assert.equal(await fixture.api.validateDirectImages(files), false);
});

test("partial and ambiguous upload failures clean up only this attempt's paths before any finalize", async () => {
  for (const options of [{ failAt: 1 }, { throwAt: 1 }]) {
    const fixture = directFixture(options);
    assert.equal(await fixture.api.uploadPrivateImages("listing-images", [imagePath, imagePath.replace(nonce, parent)], [image(), image()]), false);
    assert.deepEqual(fixture.removed, fixture.uploaded.map(({ path: objectPath }) => objectPath));
    assert.equal(fixture.uploaded.length, 2);
  }
});

test("all three actual browser pipelines remove file bytes before calling either Server Action", async () => {
  for (const flow of ["sell", "edit", "verification"]) {
    const fixture = directFixture();
    const form = new FormData();
    const field = flow === "sell" ? "images" : flow === "edit" ? "newImages" : "schoolId";
    form.set(field, image("image/png", PRIVATE_IMAGE_MAX_BYTES));
    form.set("submissionToken", nonce);
    form.set("listingId", parent);
    form.set("privacyConsent", "on");
    let prepared = 0;
    let finalized = 0;
    const assertMetadataOnly = (data) => { for (const value of data.values()) assert.equal(typeof value, "string", "File bytes must not be sent through Vercel"); };
    const actions = {
      async prepareListingUpload(previous, data) { assertMetadataOnly(data); prepared++; return { ...previous, upload: { ownerId: owner, listingId: parent } }; },
      async createListing(previous, data) { assertMetadataOnly(data); assert.ok(JSON.parse(data.get("imagePaths"))[0].startsWith(`${owner}/${parent}/`)); finalized++; return previous; },
      async prepareListingEditUpload(data) { assertMetadataOnly(data); prepared++; return { ownerId: owner }; },
      async updateListing(previous, data) { assertMetadataOnly(data); assert.equal(JSON.parse(data.get("newImagePaths")).length, 1); finalized++; return previous; },
      async prepareVerificationUpload(data) { assertMetadataOnly(data); prepared++; return { message: null, upload: { ownerId: owner, verificationId: parent } }; },
      async submitStudentVerification(previous, data) { assertMetadataOnly(data); assert.equal(data.get("documentPath"), `${owner}/${parent}/student-id.png`); finalized++; return previous; },
    };
    const name = flow === "sell" ? "publishWithDirectUploads" : flow === "edit" ? "saveWithDirectUploads" : "verifyWithDirectUpload";
    const file = flow === "sell" ? "sell/sell-form.tsx" : flow === "edit" ? "listing/[id]/edit/edit-form.tsx" : "verification/verification-form.tsx";
    const pipeline = compile(`src/app/(marketplace)/${file}`, { "./actions": actions, "@/features/uploads/direct-upload": fixture.api, "@/features/uploads/private-images": fixture.policy }, `\nmodule.exports.testAction = ${name};`);
    await pipeline.testAction({ message: null, fieldErrors: {}, submissionId: nonce }, form);
    assert.equal(prepared, 1);
    assert.equal(finalized, 1);
    assert.equal(fixture.uploaded[0].file.size, PRIVATE_IMAGE_MAX_BYTES);
  }
});

function serverFixture({ role = "student", status = "active", verified = "verified", listingStatus = "draft", rpcError = null } = {}) {
  const state = { role, account_status: status, verification_status: verified };
  const row = { id: parent, seller_id: owner, submission_token: nonce, status: listingStatus, updated_at: "2026-10-26T00:00:00+00:00", listing_images: [] };
  const calls = [];
  const policy = compile("src/features/uploads/private-images.ts");
  const validation = compile("src/features/listings/validation.ts");
  const file = image();
  const client = {
    from(table) {
      const filters = [];
      const query = {
        select() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
        insert(values) { calls.push({ kind: "insert", table, values }); return query; },
        async maybeSingle() {
          if (table === "profiles") return { data: { ...state, full_name: "Synthetic Student", student_id_number: "TEST-1234", course: "BSIT", year_level: 1 }, error: null };
          if (table === "categories") return { data: { id: parent }, error: null };
          if (table === "verifications") return { data: null, error: null };
          return { data: filters.every(([key, value]) => row[key] === value) ? row : null, error: null };
        },
        then(resolve, reject) { return Promise.resolve({ data: null, error: null }).then(resolve, reject); },
      };
      return query;
    },
    storage: { from(bucket) { return {
      async info(objectPath) { calls.push({ kind: "info", bucket, path: objectPath }); return { data: { size: file.size, contentType: file.type }, error: null }; },
      async download() { return { data: file, error: null }; },
      async remove(paths) { calls.push({ kind: "remove", bucket, paths }); return { error: null }; },
    }; } },
    async rpc(name, args) { calls.push({ kind: "rpc", name, args }); return { data: name === "publish_listing" ? parent : {}, error: rpcError }; },
  };
  const overrides = {
    "next/cache": { revalidatePath() {} },
    "next/navigation": { redirect(location) { throw Object.assign(new Error("Expected navigation"), { location }); } },
    "@/features/listings/validation": validation,
    "@/features/uploads/private-images": policy,
    "./validation": { studentInformationSchema: { safeParse: () => ({ success: true, data: {} }) } },
    "@/lib/auth/authorization": { async requireVerifiedActiveStudent() {
      if (state.role !== "student" || state.account_status !== "active" || state.verification_status !== "verified") throw new Error("Access denied");
      return { supabase: client, user: { id: owner } };
    } },
    "@/lib/auth/server": { async getValidatedUser() { return { supabase: client, user: { id: owner } }; } },
  };
  return {
    state, row, calls, client,
    create: compile("src/app/(marketplace)/sell/actions.ts", overrides),
    edit: compile("src/app/(marketplace)/listing/[id]/edit/actions.ts", overrides),
    verification: compile("src/app/(marketplace)/verification/actions.ts", overrides),
  };
}

function listingMetadata(objectPath = imagePath) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ submissionToken: nonce, listingId: parent, title: "Synthetic textbook", description: "Only synthetic testing information.", categoryId: parent, price: "10", condition: "good", expectedUpdatedAt: "2026-10-26T00:00:00+00:00", imagePaths: JSON.stringify([objectPath]), imageOrder: JSON.stringify([{ kind: "new", value: nonce }]), newImageTokens: JSON.stringify([nonce]), newImagePaths: JSON.stringify([objectPath]) })) form.set(key, value);
  return form;
}

test("actual listing finalize action reauthorizes suspension between prepare and finalize", async () => {
  const fixture = serverFixture();
  const initial = { submissionId: nonce, message: null, fieldErrors: {} };
  const prepared = await fixture.create.prepareListingUpload(initial, listingMetadata());
  assert.ok(prepared.upload);
  fixture.state.account_status = "suspended";
  await assert.rejects(fixture.create.createListing(initial, listingMetadata()), /Access denied/);
  assert.equal(fixture.calls.filter(({ kind }) => kind === "info").length, 0);
  assert.equal(fixture.calls.some(({ name }) => name === "publish_listing"), false);
});

test("actual listing finalize rejects foreign owner/resource references and mismatched submission tokens before Storage access", async () => {
  for (const objectPath of [imagePath.replace(owner, nonce), imagePath.replace(parent, nonce), `${imagePath}/extra`]) {
    const fixture = serverFixture();
    const result = await fixture.create.createListing({ submissionId: nonce }, listingMetadata(objectPath));
    assert.ok(result.message);
    assert.equal(fixture.calls.length, 0);
  }
  const fixture = serverFixture();
  const form = listingMetadata(); form.set("submissionToken", owner);
  assert.ok((await fixture.create.createListing({ submissionId: nonce }, form)).message);
  assert.equal(fixture.calls.length, 0);
});

test("actual listing finalize validates stored bytes then publishes, and reconciles a completed retry without touching objects", async () => {
  const fixture = serverFixture();
  await assert.rejects(fixture.create.createListing({ submissionId: nonce }, listingMetadata()), (error) => error.location === `/listing/${parent}?created=1`);
  assert.equal(fixture.calls.some(({ kind }) => kind === "info"), true);
  assert.equal(fixture.calls.some(({ name }) => name === "publish_listing"), true);
  assert.equal(fixture.calls.some(({ kind }) => kind === "remove"), false);
  const retry = serverFixture({ listingStatus: "available" });
  await assert.rejects(retry.create.createListing({ submissionId: nonce }, listingMetadata()), (error) => error.location === `/listing/${parent}?created=1`);
  assert.equal(retry.calls.length, 0);
});

test("actual listing edit preserves optimistic concurrency and retains objects after ambiguous database responses", async () => {
  const fixture = serverFixture({ listingStatus: "available", rpcError: { code: "network_error" } });
  const result = await fixture.edit.updateListing({ message: null, fieldErrors: {} }, listingMetadata());
  assert.match(result.message, /couldn't confirm/);
  assert.equal(fixture.calls.some(({ name }) => name === "update_owned_listing"), true);
  assert.equal(fixture.calls.some(({ kind }) => kind === "remove"), false);
  const changed = serverFixture({ listingStatus: "available" });
  const form = listingMetadata(); form.set("expectedUpdatedAt", "2026-10-25T00:00:00+00:00");
  assert.match((await changed.edit.updateListing({}, form)).message, /changed/);
  assert.equal(changed.calls.some(({ kind }) => kind === "info"), false);
  assert.equal(changed.calls.some(({ name }) => name === "update_owned_listing"), false);
});

test("actual verification finalize requires privacy consent, eligible status, exact own document path and server validation", async () => {
  const form = new FormData();
  form.set("verificationId", parent);
  form.set("documentPath", `${owner}/${parent}/student-id.png`);
  const fixture = serverFixture({ verified: "unverified" });
  assert.match((await fixture.verification.submitStudentVerification({}, form)).message, /privacy/);
  assert.equal(fixture.calls.length, 0);
  form.set("privacyConsent", "on");
  fixture.state.account_status = "suspended";
  assert.match((await fixture.verification.submitStudentVerification({}, form)).message, /cannot submit/);
  assert.equal(fixture.calls.some(({ kind }) => kind === "info"), false);
  assert.equal(fixture.calls.some(({ name }) => name === "submit_verification"), false);
  assert.deepEqual(fixture.calls.filter(({ kind }) => kind === "remove").map(({ paths }) => paths), [[`${owner}/${parent}/student-id.png`]]);
  fixture.calls.length = 0;
  fixture.state.account_status = "active";
  form.set("documentPath", `${nonce}/${parent}/student-id.png`);
  assert.match((await fixture.verification.submitStudentVerification({}, form)).message, /does not belong/);
  assert.equal(fixture.calls.length, 0);
  form.set("documentPath", `${owner}/${parent}/student-id.png`);
  await assert.rejects(fixture.verification.submitStudentVerification({}, form), (error) => error.location === "/verification");
  assert.equal(fixture.calls.some(({ kind, bucket }) => kind === "info" && bucket === "student-verifications"), true);
  assert.equal(fixture.calls.some(({ name }) => name === "submit_verification"), true);
});

test("admin document endpoint streams a 5 MiB private image and retains its authentication and no-store boundary", async () => {
  let allowed = false;
  let downloads = 0;
  const bytes = new Uint8Array(PRIVATE_IMAGE_MAX_BYTES);
  const access = {
    VERIFICATION_ID_PATTERN: /^[a-f0-9-]{36}$/,
    async getActiveAdmin() {
      if (!allowed) return null;
      const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { return { data: { document_path: `${owner}/${parent}/student-id.png` }, error: null }; } };
      return { supabase: { from: () => query, storage: { from: (bucket) => {
        assert.equal(bucket, "student-verifications");
        return { async download() {
          downloads++;
          return { error: null, data: {
            arrayBuffer() { assert.fail("Do not construct a buffered function response"); },
            stream() { return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }); },
          } };
        } };
      } } } };
    },
  };
  const route = compile("src/app/(marketplace)/admin/verifications/[id]/document/route.ts", { "../../admin-access": access });
  const request = new Request("http://localhost/admin/document");
  const context = { params: Promise.resolve({ id: parent }) };
  assert.equal((await route.GET(request, context)).status, 403);
  assert.equal(downloads, 0);
  allowed = true;
  const response = await route.GET(request, context);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.has("location"), false, "Do not redirect to a shareable signed document URL");
  assert.equal((await response.arrayBuffer()).byteLength, PRIVATE_IMAGE_MAX_BYTES);
});
