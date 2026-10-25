import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Inspect the runner rather than importing its side-effectful native entrypoint.
// These checks guard orchestration boundaries; native execution remains the
// separate disposable Docker acceptance gate.
const source = await readFile(new URL("../scripts/qa/local.mjs", import.meta.url), "utf8");

function position(marker) {
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, `Missing local QA safety boundary: ${marker}`);
  return index;
}

function ordered(...markers) {
  const positions = markers.map(position);
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index] > positions[index - 1], `QA boundary order changed: ${markers[index]}`);
  }
}

test("local QA resolves Docker and validates its local endpoint before stack startup", () => {
  ordered(
    "await assertQaDotenvSafety(root)",
    "dockerPath = resolveQaDockerBinary()",
    'runQuiet(dockerPath, ["context", "inspect"]',
    "assertLocalDockerEndpoint(contexts[0]?.Endpoints?.docker?.Host)",
    'runQuiet(dockerPath, ["info", "--format"',
    'await cli(["start"',
  );
  assert.match(source, /if \(process\.env\.DOCKER_HOST\) assertLocalDockerEndpoint\(process\.env\.DOCKER_HOST\)/);
});

test("Docker PATH repair is confined to a copied child environment", () => {
  ordered("const cliEnvironment = Object.fromEntries", "dockerPath = resolveQaDockerBinary()", "cliEnvironment[pathKey] =");
  assert.match(source, /if \(process\.platform === "win32"\)/);
  assert.match(source, /cliEnvironment\[pathKey\] = `\$\{path\.dirname\(dockerPath\)\};/);
  assert.doesNotMatch(source, /process\.env(?:\.(?:PATH|Path)|\[["'](?:PATH|Path)["']\])\s*=/);
  assert.doesNotMatch(source, /setx|SetEnvironmentVariable|reg(?:\.exe)?["']?\s+(?:add|delete)/i);
});

test("all local quality gates complete before the disposable stack is created", () => {
  assert.match(source, /publishableKey: "sb_publishable_ucmarketplace_anonymous_ci"/);
  assert.match(source, /recoverySecret: randomBytes\(32\)\.toString\("hex"\)/);
  ordered(
    "for (const gate of LOCAL_QUALITY_GATES)",
    "runQuiet(process.execPath, gate.args, gate.label",
    "quality.unit = parseUnitResult(output)",
    "if (!quality.unit) throw",
    "quality.embeddedDatabase = parseEmbeddedDbResult(output)",
    "if (!quality.embeddedDatabase) throw",
    "quality.gates.push(gate.id)",
    "workingDirectory = await mkdtemp",
    'await cli(["start"',
  );
});

test("native catalogs run after the passing messaging gate and before full acceptance", () => {
  ordered(
    "qaEnvironmentFromLocalStatus(JSON.parse",
    "await connection.connect()",
    "if (messaging.count < 1 || messaging.failures.length) throw",
    'await connection.query(await readFile(path.join(root, "supabase/staged/',
    "for (const file of NATIVE_CATALOG_CHECKS)",
    "if (catalog.count < 1 || catalog.failures.length) throw",
    "quality.nativeCatalogAssertions += catalog.count",
    "const privateOutput = await runQuiet",
  );
  assert.match(source, /finally \{ await connection\.end\(\); \}/);
});

test("full local QA rejects API-only evidence instead of claiming browser acceptance", () => {
  const parse = position("completedSummary = parseAcceptanceSummary(privateOutput)");
  const exportEvidence = position("JSON.stringify({ ...completedSummary, quality,");
  const between = source.slice(parse, exportEvidence);
  assert.match(between, /completedSummary\.mode\s*!==\s*["']full_local["']/);
  assert.match(between, /throw new Error\(/);
});

test("local QA independently requires a fresh complete browser report before exporting counts", () => {
  ordered(
    "const acceptanceStartedAt = Date.now()",
    "const privateOutput = await runQuiet",
    "completedSummary = parseAcceptanceSummary(privateOutput)",
    'completedSummary.mode !== "full_local"',
    "if ((await stat(browserReport)).mtimeMs < acceptanceStartedAt) throw",
    'quality.browser = parseBrowserAcceptance(JSON.parse(await readFile(browserReport, "utf8")))',
    "if (!quality.browser) throw",
    "await interrupts.settled",
    "JSON.stringify({ ...completedSummary, quality,",
  );
  assert.match(source, /const browserReport = path\.join\(root, "node_modules\/\.cache\/uc-qa-browser\/report\.json"\)/);
});

test("owned stack cleanup must succeed before sanitized passing evidence is written", () => {
  ordered(
    "completedSummary = parseAcceptanceSummary(privateOutput)",
    "await interrupts.settled",
    'runQuiet(cliPath, ["stop", "--project-id", projectId, "--workdir", workingDirectory',
    "if (completedSummary && !process.exitCode && !interrupts.signal)",
    "JSON.stringify({ ...completedSummary, quality,",
    "Full isolated QA passed:",
  );
  assert.match(source, /No other project was stopped\.\`\); process\.exitCode = 1/);
  assert.match(source, /No passing summary was exported\./);
  assert.doesNotMatch(source, /["'](?:--no-backup|--all|db reset|reset)["']/);
});
