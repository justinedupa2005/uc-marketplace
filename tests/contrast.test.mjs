import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function luminance(hex) {
  const components = hex.match(/[a-f0-9]{2}/gi).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
}
function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
const sources = ["src/features/listings/components/filter-bar.tsx", "src/app/(marketplace)/reservations/[reservationId]/page.tsx",
  "src/app/(marketplace)/messages/[id]/page.tsx", "src/features/messages/components/conversation-list-item.tsx",
  "src/features/messages/components/conversation-thread.tsx", "src/features/reservations/components/meetup-card.tsx",
  "src/features/reservations/components/meetup-dialog.tsx", "src/features/reservations/components/request-reservation-dialog.tsx",
  "src/features/reservations/components/reservation-summary-card.tsx"];

test("hosted contrast regression reproduces the rejected light-gray text and gives small text AA headroom", () => {
  assert.ok(contrast("#747685", "#ffffff") < 4.5);
  assert.ok(contrast("#747685", "#f9f9ff") < 4.5);
  for (const background of ["#ffffff", "#f9f9ff", "#f9faff", "#f7f9ff", "#f7f8fc", "#f1f4fb", "#f4f7ff", "#e6eeff"]) {
    assert.ok(contrast("#5b6070", background) >= 4.5, `Muted small text must contrast against ${background}.`);
  }
});
test("marketplace, chat, meetup and reservation components retain readable muted text", async () => {
  for (const source of sources) {
    const text = await readFile(new URL(`../${source}`, import.meta.url), "utf8");
    assert.ok(text.includes("text-[#5b6070]"), `${source} uses the reviewed muted text.`);
    assert.ok(!text.includes("text-[#747685]"), `${source} must not restore the failing small-text color.`);
  }
});
