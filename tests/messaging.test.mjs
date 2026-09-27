import assert from "node:assert/strict";
import test from "node:test";

import {
  MESSAGE_MAX_LENGTH,
  isValidMessageBody,
  mergeConversationMessages,
  normalizeMessageBody,
} from "../src/lib/message-utils.ts";

function message(id, createdAt, overrides = {}) {
  return {
    id,
    senderId: "00000000-0000-4000-8000-000000000001",
    body: `Message ${id}`,
    createdAt,
    readAt: null,
    ...overrides,
  };
}

test("message bodies are trimmed and bounded", () => {
  assert.equal(normalizeMessageBody("  hello\n"), "hello");
  assert.equal(isValidMessageBody(" \n\t "), false);
  assert.equal(isValidMessageBody("x".repeat(MESSAGE_MAX_LENGTH)), true);
  assert.equal(isValidMessageBody("x".repeat(MESSAGE_MAX_LENGTH + 1)), false);
});

test("messages merge in chronological order with deterministic ties", () => {
  const merged = mergeConversationMessages(
    [
      message("b", "2026-09-27T10:01:00.000Z"),
      message("c", "2026-09-27T10:02:00.000Z"),
    ],
    [
      message("a", "2026-09-27T10:01:00.000Z"),
      message("d", "2026-09-27T10:00:00.000Z"),
    ],
  );

  assert.deepEqual(
    merged.map(({ id }) => id),
    ["d", "a", "b", "c"],
  );
});

test("realtime echoes deduplicate by database message id", () => {
  const original = message("same-id", "2026-09-27T10:00:00.000Z");
  const merged = mergeConversationMessages(
    [original],
    [original, { ...original, readAt: "2026-09-27T10:03:00.000Z" }],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].readAt, "2026-09-27T10:03:00.000Z");
});

test("read receipts stay monotonic when a stale send response arrives", () => {
  const readMessage = message("same-id", "2026-09-27T10:00:00.000Z", {
    readAt: "2026-09-27T10:03:00.000Z",
  });
  const staleResponse = {
    ...readMessage,
    body: "Stale body must not replace persisted content",
    readAt: null,
  };

  const [merged] = mergeConversationMessages([readMessage], [staleResponse]);

  assert.equal(merged.readAt, "2026-09-27T10:03:00.000Z");
  assert.equal(merged.body, readMessage.body);
});

test("merging does not mutate the existing message array", () => {
  const current = [message("one", "2026-09-27T10:00:00.000Z")];
  const snapshot = structuredClone(current);

  mergeConversationMessages(current, [
    message("two", "2026-09-27T10:01:00.000Z"),
  ]);

  assert.deepEqual(current, snapshot);
});
