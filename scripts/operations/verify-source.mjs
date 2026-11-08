import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyScheduleOrigin } from "./schedule.mjs";
try {
  assert.ok(process.env.GITHUB_EVENT_NAME === "workflow_dispatch" && process.env.GITHUB_REF === "refs/heads/staging");
  await verifyScheduleOrigin(process.env);
  // The credential-free main scheduler dispatches staging. Never admit main to
  // the protected environment or mistake its CI for approval of operator code.
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.match(sha, /^[a-f0-9]{40}$/);
  execFileSync(process.execPath, [fileURLToPath(new URL("../staging/verify-ci.mjs", import.meta.url))], {
    env: { ...process.env, GITHUB_REF: "refs/heads/staging", GITHUB_SHA: sha }, stdio: "inherit", windowsHide: true,
  });
} catch { console.error("Operations source is not an approved current staging commit. No backup credentials should be released."); process.exitCode = 1; }
