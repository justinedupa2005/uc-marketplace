import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { validateObject, runId, buckets } from "./policy.mjs";

const maxLine = 7100000;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export const inventoryDigest = objects => digest(JSON.stringify(objects));

export async function boundedBody(response, maximum) {
  assert.ok(response.ok && response.body, "Storage read failed.");
  assert.ok(!response.headers.get("content-length") || Number(response.headers.get("content-length")) <= maximum);
  const chunks = []; let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length; assert.ok(size <= maximum, "Oversized Storage response."); chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch { await response.body.cancel().catch(() => {}); throw new Error("Storage read failed."); }
}

export async function* storagePack({ projectRef, id, component, objects, download }) {
  assert.match(id, runId); assert.ok(["media", "verification"].includes(component));
  assert.match(projectRef, /^[a-z]{20}$/);
  const hash = createHash("sha256"); let count = 0, bytes = 0;
  const line = value => { const data = `${JSON.stringify(value)}\n`; hash.update(data); return data; };
  yield line({ format: "ucm-storage-v1", projectRef, runId: id, component });
  const seen = new Set();
  for (const raw of objects) {
    const object = validateObject(raw);
    if ((object.bucket_id === "student-verifications") !== (component === "verification")) continue;
    const key = `${object.bucket_id}/${object.name}`;
    assert.ok(!seen.has(key)); seen.add(key);
    const data = await download(object);
    assert.ok(Buffer.isBuffer(data) && data.length === object.size);
    yield line({ object, sha256: digest(data), data: data.toString("base64") });
    count++; bytes += data.length;
  }
  yield `${JSON.stringify({ end: true, count, bytes, sha256: hash.digest("hex") })}\n`;
}

// Decode only authenticated restic output, and still reject traversal, duplicate
// objects, malformed/truncated streams, tampering and oversized data.
export async function decodeStoragePack(stream, expected, restore) {
  let pending = "", header, footer, count = 0, bytes = 0;
  const hash = createHash("sha256"), seen = new Set();
  async function consume(line) {
    assert.ok(!footer && line.length <= maxLine);
    const value = JSON.parse(line);
    if (!header) {
      assert.deepEqual(value, { format: "ucm-storage-v1", projectRef: expected.projectRef, runId: expected.runId, component: expected.component });
      header = value;
    } else if (value.end === true) {
      assert.deepEqual(value, { end: true, count, bytes, sha256: hash.digest("hex") }); footer = value; return;
    } else {
      const object = validateObject(value.object);
      assert.equal(object.bucket_id === "student-verifications", expected.component === "verification");
      const key = `${object.bucket_id}/${object.name}`;
      assert.ok(!seen.has(key) && count < expected.maxObjects); seen.add(key);
      assert.ok(typeof value.data === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(value.data));
      const data = Buffer.from(value.data, "base64");
      assert.equal(data.toString("base64"), value.data); assert.equal(data.length, object.size); assert.equal(digest(data), value.sha256);
      count++; bytes += data.length; assert.ok(bytes <= expected.maxStorageBytes);
      await restore(object, data);
    }
    hash.update(`${line}\n`);
  }
  for await (const chunk of stream) {
    // Generated pack records are ASCII (object names are constrained and bytes
    // are base64), so chunk boundaries cannot split multi-byte characters.
    pending += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    let index;
    while ((index = pending.indexOf("\n")) !== -1) { const line = pending.slice(0, index); pending = pending.slice(index + 1); await consume(line); }
    assert.ok(pending.length <= maxLine);
  }
  assert.ok(header && footer && !pending, "Incomplete Storage backup.");
  return { count, bytes };
}

export async function writeStream(stream, value) {
  if (!stream.write(value)) await once(stream, "drain");
}

export function validateBuckets(rows) {
  assert.deepEqual(rows.map(row => row.id).sort(), [...buckets].sort());
  assert.ok(rows.every(row => row.public === (row.id === "avatars")), "Preserve the existing public-avatar/private-listing/private-verification policy.");
}
