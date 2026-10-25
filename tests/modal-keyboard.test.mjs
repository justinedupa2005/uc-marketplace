import assert from "node:assert/strict";
import test from "node:test";
import { tabToModalControl } from "./e2e/qa-helpers.ts";

function modalTraversal(stops) {
  let position = -1;
  const keys = [];
  return {
    page: { keyboard: { async press(key) { keys.push(key); position += 1; } } },
    dialog: { async evaluate() { return ["body", "dialog"].includes(stops[position]); } },
    destination: { async evaluate() { return stops[position] === "destination"; } },
    keys,
  };
}

test("modal traversal permits only native neutral stops before the exact intended control", async () => {
  for (const [key, stops] of [["Tab", ["body", "dialog", "destination"]], ["Shift+Tab", ["dialog", "body", "destination"]]]) {
    const fixture = modalTraversal(stops);
    await tabToModalControl(fixture.page, fixture.dialog, fixture.destination, key);
    assert.deepEqual(fixture.keys, [key, key, key]);
  }
});

test("modal traversal immediately rejects an unexpected interactive or background focus stop", async () => {
  for (const stop of ["inside-control", "background-control"]) {
    const fixture = modalTraversal([stop, "destination"]);
    await assert.rejects(tabToModalControl(fixture.page, fixture.dialog, fixture.destination, "Tab"), /unexpected interactive control/);
    assert.deepEqual(fixture.keys, ["Tab"]);
  }
});

test("modal traversal cannot pass an endless body or dialog focus loop", async () => {
  const fixture = modalTraversal(["body", "dialog", "body", "destination"]);
  await assert.rejects(tabToModalControl(fixture.page, fixture.dialog, fixture.destination, "Tab"), /within three keypresses/);
  assert.equal(fixture.keys.length, 3);
});
