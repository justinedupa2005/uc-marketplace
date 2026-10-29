import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, chmod, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { command } from "./process.mjs";

// Downloads only a pinned public tool, never project data. Reuse an already
// installed binary only after the operator verifies it; never overwrite it.
try {
  assert.equal(process.argv.length, 2);
  assert.equal(process.arch, "x64"); assert.ok(["linux", "win32"].includes(process.platform));
  const pins = JSON.parse(await readFile(new URL("../../config/operations-tools.json", import.meta.url), "utf8"));
  const windows = process.platform === "win32", version = pins.resticVersion;
  const filename = `restic_${version}_${windows ? "windows_amd64.zip" : "linux_amd64.bz2"}`;
  const expected = windows ? pins.resticWindowsAmd64Sha256 : pins.resticLinuxAmd64Sha256;
  const directory = fileURLToPath(new URL(`../../.qa/tools/restic-${version}/`, import.meta.url));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, windows ? "restic.exe" : "restic");
  let exists = false; try { await access(target); exists = true; } catch { /* New installation. */ }
  assert.equal(exists, false, "A tool already exists; review it without overwriting.");
  const response = await fetch(`https://github.com/restic/restic/releases/download/v${version}/${filename}`, { signal: AbortSignal.timeout(60000) });
  assert.ok(response.ok && response.body); const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; assert.ok(size < 40000000); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
  const archive = path.join(directory, filename); await writeFile(archive, bytes, { flag: "wx", mode: 0o600 });
  const parts = [];
  const output = chunk => parts.push(chunk);
  if (windows) await command("tar.exe", ["-xOf", archive, `restic_${version}_windows_amd64.exe`], { output });
  else await command("bzip2", ["--decompress", "--stdout", archive], { output });
  await writeFile(target, Buffer.concat(parts), { flag: "wx", mode: 0o700 }); await chmod(target, 0o700);
  assert.match((await command(target, ["version"])).toString(), /^restic 0\.19\.1\b/);
  console.log("Pinned restic installed in ignored .qa/tools; release SHA256 verified. No PATH or system configuration changed.");
} catch { console.error("Backup-tool installation refused or failed; no existing executable was overwritten."); process.exitCode = 1; }
