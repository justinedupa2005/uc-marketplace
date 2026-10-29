import assert from "node:assert/strict";

export const syntheticProjectRef = "syntheticrestoretest";
export const syntheticPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=", "base64");

export function persistentSyntheticWorkflow(source) {
  assert.match(source, /rollback;\s*$/i);
  assert.ok(source.includes("create trigger qa15_injected_listing_failure"));
  // The original test deliberately rolls back a temporary failure-injection
  // trigger. To retain its synthetic transaction data for a dump, remove only
  // that test trigger AFTER all 45 checks, before committing the fixture.
  // Application triggers, functions and security assertions stay intact.
  return source.replace(/rollback;\s*$/i, "drop trigger qa15_injected_listing_failure on public.listings;\ncommit;");
}
