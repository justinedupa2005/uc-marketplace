import assert from "node:assert/strict";
import test from "node:test";

async function multipartText(value) {
  const form = new FormData();
  form.set("body", value);
  // Construct and parse the actual multipart encoding in memory; no fetch,
  // network connection, database access, or application mutation is involved.
  const request = new Request("http://127.0.0.1/qa-form-transport", { method: "POST", body: form });
  const parsed = await request.formData();
  const body = parsed.get("body");
  assert.equal(typeof body, "string");
  return body;
}

test("native multipart form transport canonicalizes LF textarea newlines to CRLF", async () => {
  const draft = "First line\nSecond line";
  const transported = await multipartText(draft);
  assert.equal(transported, "First line\r\nSecond line");
  assert.notEqual(transported, draft, "A persisted-message LF equality filter can hide a legitimately encoded row");
  assert.equal(transported.replace(/\r\n/g, "\n"), draft);
});

test("newline canonicalization preserves spaces, tabs, blank lines and trailing text exactly", async () => {
  const draft = "  First line with trailing spaces  \n\tTabbed second line\t\n\n  Last line  \n";
  const transported = await multipartText(draft);
  assert.equal(transported, "  First line with trailing spaces  \r\n\tTabbed second line\t\r\n\r\n  Last line  \r\n");
  const canonical = transported.replace(/\r\n/g, "\n");
  assert.equal(canonical, draft);
  assert.notEqual(canonical, draft.trim());
  assert.notEqual(canonical, draft.replace(/\s+/g, " "));
});

test("already-CRLF form text stays consistent without doubled carriage returns", async () => {
  const draft = "  First line  \r\n\tSecond line\t\r\n\r\nThird line  ";
  const transported = await multipartText(draft);
  assert.equal(transported, draft);
  assert.equal(transported.includes("\r\r\n"), false);
  assert.equal(transported.replace(/\r\n/g, "\n"), draft.replace(/\r\n/g, "\n"));
});
