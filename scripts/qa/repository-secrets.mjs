import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSecretFilename, secretFindingCodes } from "./lib/repository-secret-rules.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const options = { cwd: root, windowsHide: true, timeout: 120_000, maxBuffer: 128 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] };
const issues = new Set();
const add = (scope, codes) => codes.forEach((code) => issues.add(`${scope}:${code}`));
try {
  if (process.argv.slice(2).some((argument) => argument !== "--history")) throw new Error();
  const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], options).toString("utf8").split("\0").filter(Boolean))];
  for (const file of files) {
    const filename = path.resolve(root, file);
    if (!filename.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error();
    let stat;
    try { stat = lstatSync(filename); } catch { continue; } // A tracked deletion is not current content.
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error();
    // Locations and source content stay private; output only fixed finding codes.
    if (isSecretFilename(file)) add("worktree", ["secret-file"]);
    add("worktree", secretFindingCodes(readFileSync(filename).toString("utf8")));
  }
  for (const file of [".env.local", ".env.production.local", "nested/.env.local"]) {
    execFileSync("git", ["check-ignore", "--quiet", "--no-index", file], options);
  }
  let historyBlobs = 0;
  if (process.argv.includes("--history")) {
    const listing = execFileSync("git", ["rev-list", "--objects", "--all"], options).toString("utf8");
    const ids = [...new Set(listing.trim().split("\n").filter(Boolean).map((line) => line.split(" ", 1)[0]))];
    if (!ids.length || ids.some((id) => !/^[0-9a-f]{40}$/.test(id))) throw new Error();
    const objects = execFileSync("git", ["cat-file", "--batch"], { ...options, input: `${ids.join("\n")}\n` });
    let cursor = 0;
    while (cursor < objects.length) {
      const end = objects.indexOf(10, cursor);
      if (end < 0) throw new Error();
      const header = /^([0-9a-f]{40}) (blob|tree|commit|tag) ([0-9]+)$/.exec(objects.subarray(cursor, end).toString("ascii"));
      if (!header) throw new Error();
      const length = Number(header[3]);
      const start = end + 1;
      if (!Number.isSafeInteger(length) || start + length >= objects.length || objects[start + length] !== 10) throw new Error();
      if (header[2] === "blob") {
        historyBlobs += 1;
        add("history", secretFindingCodes(objects.subarray(start, start + length).toString("utf8")));
      }
      cursor = start + length + 1;
    }
  }
  if (issues.size) {
    console.error(`Repository secret review failed (${[...issues].sort().join(", ")}). Values, paths and source snippets were withheld.`);
    process.exitCode = 1;
  } else console.log(`Repository secret-pattern checks passed: ${files.length} current files, ${historyBlobs} historical blobs. Known patterns only; keep GitHub secret scanning and push protection enabled.`);
} catch {
  console.error("Repository secret review could not complete; no private diagnostics were printed.");
  process.exitCode = 1;
}
