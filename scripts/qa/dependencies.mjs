import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reviewDependencyAudits, dependencyFailureCode, dependencyFailureDetails, requireCurrentDevelopmentPolicy } from "./lib/dependency-review.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
function audit(args) {
  const npm = process.env.npm_execpath;
  if (!npm || !path.isAbsolute(npm) || path.basename(npm) !== "npm-cli.js") throw new Error();
  let output;
  try { output = execFileSync(process.execPath, [npm, "audit", ...args, "--json"], {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 4_000_000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }); } catch (error) {
    if (error.status !== 1 || error.signal || error.code) throw new Error();
    output = error.stdout;
  }
  return JSON.parse(output);
}

try {
  if (process.argv.length !== 2) throw new Error();
  const full = audit([]);
  const production = audit(["--omit=dev"]);
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const policy = JSON.parse(readFileSync(new URL("./dependency-policy.json", import.meta.url), "utf8"));
  // Only the revised eight-node evidence profile is live. The original file is
  // historical approval evidence, never a fallback or automatic renewal.
  const developmentPolicy = requireCurrentDevelopmentPolicy(JSON.parse(readFileSync(new URL("./dependency-policy-minimatch-refined.json", import.meta.url), "utf8")));
  console.log(`DEPENDENCY_REVIEW_JSON:${JSON.stringify(reviewDependencyAudits(full, production, lock, policy, { developmentPolicy }))}`);
} catch (error) {
  console.error(`Dependency security gate failed: ${dependencyFailureCode(error)}. Review current audits and the expiring development policy; private npm diagnostics were withheld.`);
  console.error(`DEPENDENCY_FAILURE_JSON:${JSON.stringify(dependencyFailureDetails(error))}`);
  process.exitCode = 1;
}
