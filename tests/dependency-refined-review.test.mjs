import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reviewDependencyAudits, requireCurrentDevelopmentPolicy } from "../scripts/qa/lib/dependency-review.mjs";

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
const original = readJson("../scripts/qa/dependency-policy-minimatch.json");
const refined = readJson("../scripts/qa/dependency-policy-minimatch-refined.json");
const advisoryRange = ">=7.0.0 <11.0.1";
const expectedPackages = ["@typescript-eslint/eslint-plugin", "@typescript-eslint/parser", "@typescript-eslint/type-utils",
  "@typescript-eslint/typescript-estree", "@typescript-eslint/utils", "eslint-config-next", "minimatch", "typescript-eslint"];
const minimatchNode = "node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch";

function report(entries = {}) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: Object.keys(entries).length };
  for (const value of Object.values(entries)) counts[value.severity] += 1;
  return { auditReportVersion: 2, vulnerabilities: entries, metadata: { vulnerabilities: counts } };
}

function fixture(policy = refined, range = advisoryRange) {
  const entries = {}, lock = { packages: {} };
  for (const [name, approved] of Object.entries(policy.packages)) {
    for (const [node, version] of Object.entries(approved.nodes)) lock.packages[node] = { version, dev: true };
    entries[name] = { name, severity: "moderate", nodes: Object.keys(approved.nodes),
      isDirect: name === "eslint" || name === "eslint-config-next",
      via: name === "minimatch" ? [{ name, url: policy.advisory, severity: "moderate", range }] : [...approved.via],
      fixAvailable: name === "eslint" ? { name, version: "4.0.0", isSemVerMajor: true }
        : { name: "eslint-config-next", version: "15.5.29", isSemVerMajor: true } };
  }
  return { full: report(entries), production: report(), lock, policy: structuredClone(policy) };
}

function review(f, time = "2026-11-07T04:00:00Z") {
  return reviewDependencyAudits(f.full, f.production, f.lock, undefined,
    { now: new Date(time), developmentPolicy: f.policy });
}

test("the reviewed refinement accepts exactly eight moderate development findings with the original expiry", () => {
  const f = fixture();
  const result = review(f);
  assert.equal(result.status, "passed_with_reviewed_development_risk");
  assert.equal(result.productionFindings, 0);
  assert.equal(result.deferredDevelopmentPackages, 8);
  assert.equal(result.advisory, original.advisory);
  assert.equal(result.approvedBy, "justinedupa2005");
  assert.equal(result.expiresOn, "2026-11-08");
  assert.equal(result.expiresAt, "2026-11-07T16:00:00.000Z");
  assert.equal(result.timezone, "Asia/Manila");
});

test("the refinement artifact only removes originally approved packages, nodes and edges without renewing approval", () => {
  assert.equal(refined.evidenceProfile, "github-2026-11-04-refinement");
  assert.equal(refined.evidenceReviewedOn, "2026-11-07");
  for (const key of ["version", "approved", "approvedBy", "scope", "reviewedOn", "expiresOn", "timezone", "advisory", "severity"])
    assert.deepEqual(refined[key], original[key], key);
  assert.equal(refined.reviewedOn, "2026-11-01");
  assert.equal(refined.expiresOn, "2026-11-08");
  assert.deepEqual(Object.keys(refined.packages).sort(), expectedPackages);
  assert.equal(Object.values(original.packages).flatMap(value => Object.keys(value.nodes)).length, 18);
  assert.equal(Object.values(refined.packages).flatMap(value => Object.keys(value.nodes)).length, 8);
  for (const [name, approved] of Object.entries(refined.packages)) {
    assert.ok(original.packages[name], name);
    for (const [node, version] of Object.entries(approved.nodes)) assert.equal(version, original.packages[name].nodes[node], node);
    for (const edge of approved.via) assert.ok(original.packages[name].via.includes(edge), `${name} -> ${edge}`);
    assert.equal(approved.fix, original.packages[name].fix, name);
    const node = name === "minimatch" ? minimatchNode : `node_modules/${name}`;
    const version = name === "minimatch" ? "10.2.6" : name === "eslint-config-next" ? "16.4.3" : "8.68.0";
    assert.deepEqual(approved.nodes, { [node]: version });
  }
  assert.deepEqual(Object.entries(refined.packages).filter(([, value]) => value.fix !== undefined)
    .map(([name, value]) => [name, value.fix]), [["eslint-config-next", "next-config-downgrade"]]);
});

test("the live CLI selects only the explicit refined policy and cannot fall back to the historical approval", () => {
  const cli = readFileSync(new URL("../scripts/qa/dependencies.mjs", import.meta.url), "utf8");
  assert.match(cli, /new URL\(["']\.\/dependency-policy-minimatch-refined\.json["']/);
  assert.doesNotMatch(cli, /new URL\(["']\.\/dependency-policy-minimatch\.json["']/);
  assert.match(cli, /const developmentPolicy\s*=\s*requireCurrentDevelopmentPolicy\(JSON\.parse\(readFileSync\(/);
  const historical = fixture(original, "<11.0.1");
  historical.policy = structuredClone(refined);
  assert.throws(() => review(historical), /Dependency review failed/);
  const narrowedUnderOriginal = fixture();
  narrowedUnderOriginal.policy = structuredClone(original);
  assert.throws(() => review(narrowedUnderOriginal), /Dependency review failed/);
});

test("the live policy guard rejects historical JSON contents and never mutates the accepted refined policy", () => {
  const accepted = structuredClone(refined);
  const before = structuredClone(accepted);
  assert.equal(requireCurrentDevelopmentPolicy(accepted), accepted);
  assert.deepEqual(accepted, before);

  const missingProfile = structuredClone(refined);
  delete missingProfile.evidenceProfile;
  for (const policy of [original, missingProfile, { ...refined, evidenceProfile: "unknown-profile" }, null, undefined]) {
    const historical = fixture(original, "<11.0.1");
    assert.throws(() => reviewDependencyAudits(historical.full, historical.production, historical.lock, undefined,
      { now: new Date("2026-11-07T04:00:00Z"), developmentPolicy: requireCurrentDevelopmentPolicy(policy) }),
    { reviewCode: "MINIMATCH_APPROVAL_INVALID_OR_EXPIRED" });
  }

  const relabeledHistorical = fixture(original, "<11.0.1");
  relabeledHistorical.policy.evidenceProfile = refined.evidenceProfile;
  relabeledHistorical.policy.evidenceReviewedOn = refined.evidenceReviewedOn;
  assert.equal(requireCurrentDevelopmentPolicy(relabeledHistorical.policy), relabeledHistorical.policy);
  assert.throws(() => review(relabeledHistorical), /Dependency review failed/);
});

test("arbitrary smaller subsets cannot become a new exception even when the supplied policy drops the same package", () => {
  for (const name of expectedPackages) {
    const f = fixture();
    delete f.full.vulnerabilities[name];
    delete f.policy.packages[name];
    f.full = report(f.full.vulnerabilities);
    assert.throws(() => review(f), /Dependency review failed/, name);
  }
});

test("the refinement cannot reintroduce an old affected package or root minimatch 3.1.5", () => {
  const f = fixture();
  const historical = fixture(original, "<11.0.1");
  f.full.vulnerabilities.eslint = historical.full.vulnerabilities.eslint;
  f.policy.packages.eslint = structuredClone(original.packages.eslint);
  Object.assign(f.lock.packages, Object.fromEntries(Object.keys(original.packages.eslint.nodes)
    .map(node => [node, historical.lock.packages[node]])));
  f.full = report(f.full.vulnerabilities);
  assert.throws(() => review(f), /Dependency review failed/);
  for (const changePolicy of [false, true]) {
    const g = fixture();
    g.full.vulnerabilities.minimatch.nodes.push("node_modules/minimatch");
    g.lock.packages["node_modules/minimatch"] = { version: "3.1.5", dev: true };
    if (changePolicy) g.policy.packages.minimatch.nodes["node_modules/minimatch"] = "3.1.5";
    assert.throws(() => review(g), /Dependency review failed/);
  }
});

test("only the precise revised advisory range is accepted, with no wider range or extra advisory", () => {
  for (const range of ["<11.0.1", ">=6.0.0 <11.0.1", ">=7.0.0 <11.0.2", ">=7.0.0 <12", "*", ">=7 <11.0.1"]) {
    const f = fixture();
    f.full.vulnerabilities.minimatch.via[0].range = range;
    assert.throws(() => review(f), /Dependency review failed/, range);
  }
  for (const mutate of [
    f => { f.full.vulnerabilities.minimatch.via[0].url = "https://github.com/advisories/GHSA-new"; },
    f => { f.full.vulnerabilities.minimatch.via[0].name = "different-package"; },
    f => { f.full.vulnerabilities.minimatch.via.push({ name: "minimatch", url: "https://github.com/advisories/GHSA-new", severity: "moderate", range: "*" }); },
  ]) {
    const f = fixture(); mutate(f); assert.throws(() => review(f), /Dependency review failed/);
  }
});

test("changed installed versions, paths, development classification and directness require a new review", () => {
  const mutations = [
    f => { f.lock.packages[minimatchNode].version = "11.0.5"; },
    f => { f.lock.packages["node_modules/@typescript-eslint/parser"].version = "8.72.1"; },
    f => { f.lock.packages[minimatchNode].dev = false; },
    f => { delete f.lock.packages[minimatchNode]; },
    f => { f.full.vulnerabilities.minimatch.nodes = ["node_modules/other/node_modules/minimatch"]; },
    f => { f.full.vulnerabilities.minimatch.nodes.push(minimatchNode); },
    f => { f.full.vulnerabilities.minimatch.isDirect = true; },
    f => { f.full.vulnerabilities["eslint-config-next"].isDirect = false; },
    f => { f.lock.packages[minimatchNode].version = "10.2.7"; f.policy.packages.minimatch.nodes[minimatchNode] = "10.2.7"; },
    f => {
      const node = "node_modules/other/node_modules/minimatch";
      f.full.vulnerabilities.minimatch.nodes = [node];
      f.lock.packages[node] = { version: "10.2.6", dev: true };
      f.policy.packages.minimatch.nodes = { [node]: "10.2.6" };
    },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f); assert.throws(() => review(f), /Dependency review failed/);
  }
});

test("new edges and changes to any reviewed edge are rejected", () => {
  const mutations = [
    f => { f.full.vulnerabilities["@typescript-eslint/type-utils"].via.push("@typescript-eslint/parser"); },
    f => { f.full.vulnerabilities["eslint-config-next"].via.push("eslint"); },
    f => { f.full.vulnerabilities["@typescript-eslint/parser"].via = ["@typescript-eslint/utils"]; },
    f => { f.full.vulnerabilities["typescript-eslint"].via.pop(); },
    f => { f.full.vulnerabilities["@typescript-eslint/parser"].via.push("@typescript-eslint/typescript-estree"); },
    f => {
      f.full.vulnerabilities["@typescript-eslint/parser"].via.push("@typescript-eslint/utils");
      f.policy.packages["@typescript-eslint/parser"].via.push("@typescript-eslint/utils");
    },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f); assert.throws(() => review(f), /Dependency review failed/);
  }
});

test("severity changes, extra findings and every production advisory remain blocked", () => {
  for (const severity of ["low", "high", "critical"]) {
    const f = fixture();
    f.full.vulnerabilities.minimatch.severity = severity;
    f.full = report(f.full.vulnerabilities);
    assert.throws(() => review(f), /Dependency review failed/);
  }
  const advisorySeverity = fixture();
  advisorySeverity.full.vulnerabilities.minimatch.via[0].severity = "high";
  assert.throws(() => review(advisorySeverity), /Dependency review failed/);
  const extra = fixture();
  extra.full = report({ ...extra.full.vulnerabilities, extra: { name: "extra", severity: "low", nodes: ["node_modules/extra"], via: ["minimatch"], isDirect: false } });
  assert.throws(() => review(extra), /Dependency review failed/);
  const production = fixture();
  production.production = report({ minimatch: production.full.vulnerabilities.minimatch });
  assert.throws(() => review(production), /Dependency review failed/);
  assert.throws(() => reviewDependencyAudits(report(), production.production, {}, undefined,
    { now: new Date("2026-11-07T04:00:00Z"), developmentPolicy: refined }), /Dependency review failed/);
});

test("the refinement profile and evidence date are exact and cannot renew or alter the owner approval", () => {
  for (const [key, values] of Object.entries({
    evidenceProfile: [undefined, null, "github-2026-11-05-refinement", "any-subset"],
    evidenceReviewedOn: [undefined, "invalid", "2026-11-06", "2026-11-08", "2026-11-07T00:00:00Z"],
    reviewedOn: ["2026-11-02", "2026-11-07"], expiresOn: ["2026-11-09", "2026-12-08"],
    approved: [false], approvedBy: ["another-owner"], scope: ["all-dependencies"], timezone: ["UTC"],
  })) {
    for (const value of values) {
      const f = fixture(); f.policy[key] = value;
      assert.throws(() => review(f), /Dependency review failed/, `${key}: ${value}`);
    }
  }
  assert.doesNotThrow(() => review(fixture(), "2026-11-07T15:59:59.999Z"));
  for (const time of ["2026-10-31T15:59:59.999Z", "2026-11-06T15:59:59.999Z", "2026-11-07T16:00:00.000Z", "2026-11-08T00:00:00Z", "invalid"])
    assert.throws(() => review(fixture(), time), /Dependency review failed/, time);
});

test("the direct Next-config remedy must remain an older-major downgrade with strong evidence", () => {
  for (const version of ["0.2.4", "12.0.4", "14.2.35", "15.5.29"]) {
    const f = fixture();
    f.full.vulnerabilities["eslint-config-next"].fixAvailable = { name: "eslint-config-next", version, isSemVerMajor: true };
    assert.equal(review(f).deferredDevelopmentPackages, 8);
  }
  for (const proposal of [true, false, undefined, null,
    { name: "eslint-config-next", version: "16.4.3", isSemVerMajor: true },
    { name: "eslint-config-next", version: "16.4.5", isSemVerMajor: false },
    { name: "eslint-config-next", version: "17.0.0", isSemVerMajor: true },
    { name: "eslint", version: "4.0.0", isSemVerMajor: true },
    { name: "eslint-config-next", version: "15.5.29", isSemVerMajor: false },
    { name: "eslint-config-next", version: "15.5.29-beta.1", isSemVerMajor: true },
    { name: "eslint-config-next", version: "invalid", isSemVerMajor: true },
  ]) {
    const f = fixture(); f.full.vulnerabilities["eslint-config-next"].fixAvailable = proposal;
    assert.throws(() => review(f), /Dependency review failed/);
  }
});

test("indirect fix propagation remains metadata and cannot weaken direct remedy or graph checks", () => {
  for (const name of expectedPackages.filter(name => name !== "eslint-config-next")) {
    for (const fix of [true, false, { name: "eslint", version: "4.0.0", isSemVerMajor: true },
      { name: "eslint-config-next", version: "15.5.29", isSemVerMajor: true }]) {
      const f = fixture(); f.full.vulnerabilities[name].fixAvailable = fix;
      assert.equal(review(f).deferredDevelopmentPackages, 8);
    }
  }
});

test("malformed or truncated audit evidence is never accepted as a refined review", () => {
  for (const full of [null, {}, { error: { code: "NETWORK" } }, { ...report(), vulnerabilities: [] },
    { ...report(), auditReportVersion: 1 }, { ...report(), metadata: { vulnerabilities: { total: 0 } } }]) {
    const f = fixture(); f.full = full; assert.throws(() => review(f), /Dependency review failed/);
  }
  const f = fixture(); f.full.metadata.vulnerabilities.total = 7;
  assert.throws(() => review(f), /Dependency review failed/);
});
