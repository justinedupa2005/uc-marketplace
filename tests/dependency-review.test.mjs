import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reviewDependencyAudits } from "../scripts/qa/lib/dependency-review.mjs";

const policy = JSON.parse(readFileSync(new URL("../scripts/qa/dependency-policy.json", import.meta.url), "utf8"));
const now = new Date("2026-10-20T12:00:00Z");
function report(entries = {}) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: Object.keys(entries).length };
  for (const value of Object.values(entries)) counts[value.severity] += 1;
  return { auditReportVersion: 2, vulnerabilities: entries, metadata: { vulnerabilities: counts } };
}
function fixture() {
  const chain = { "eslint-config-next": "@next/eslint-plugin-next", "@next/eslint-plugin-next": "fast-glob", "fast-glob": "micromatch", "micromatch": "braces" };
  const entries = {};
  const lock = { packages: {} };
  for (const [name, version] of Object.entries(policy.packages)) {
    const node = `node_modules/${name}`;
    lock.packages[node] = { version, dev: true };
    entries[name] = { name, severity: "high", nodes: [node],
      via: name === "braces" ? [{ name: "braces", url: policy.advisory, severity: "high", range: "<=3.0.3" }] : [chain[name]],
      fixAvailable: { name: "eslint-config-next", version: "14.2.35", isSemVerMajor: true } };
  }
  return { full: report(entries), production: report(), lock, policy: structuredClone(policy) };
}
const review = (f) => reviewDependencyAudits(f.full, f.production, f.lock, f.policy, { now });

test("review accepts only the exact reviewed development chain, never describes it as zero vulnerabilities", () => {
  const result = review(fixture());
  assert.equal(result.status, "passed_with_reviewed_development_risk");
  assert.equal(result.productionFindings, 0);
  assert.equal(result.deferredDevelopmentPackages, 5);
  assert.equal(result.expiresOn, "2026-11-19");
});

test("a clean full and production audit needs no development exception", () => {
  assert.deepEqual(reviewDependencyAudits(report(), report(), {}, null), {
    status: "passed", productionFindings: 0, deferredDevelopmentPackages: 0,
  });
});

test("any production finding fails even if its dependency has a development exception", () => {
  const f = fixture();
  f.production = report({ braces: f.full.vulnerabilities.braces });
  assert.throws(() => review(f), /Dependency review failed/);
});

test("development policy expires, cannot be future dated, and cannot be extended without a fresh bounded review", () => {
  for (const time of ["2026-10-19T23:59:59Z", "2026-11-19T00:00:00Z", "2026-12-01T00:00:00Z"]) {
    const f = fixture();
    assert.throws(() => reviewDependencyAudits(f.full, f.production, f.lock, f.policy, { now: new Date(time) }));
  }
  const f = fixture(); f.policy.expiresOn = "2027-10-20";
  assert.throws(() => review(f));
});

test("new advisories, severity escalation, changed installs, new paths and compatible patches invalidate deferral", () => {
  const mutations = [
    (f) => { f.full.vulnerabilities.braces.via.push({ name: "braces", url: "https://github.com/advisories/GHSA-new", severity: "high", range: "*" }); },
    (f) => { f.full.vulnerabilities.micromatch.severity = "critical"; f.full = report(f.full.vulnerabilities); },
    (f) => { f.lock.packages["node_modules/braces"].dev = false; },
    (f) => { f.lock.packages["node_modules/braces"].version = "3.0.4"; },
    (f) => { f.full.vulnerabilities.braces.nodes.push("node_modules/other/node_modules/braces"); },
    (f) => { f.full.vulnerabilities.braces.fixAvailable = true; },
    (f) => { f.full.vulnerabilities.braces.fixAvailable = { name: "braces", version: "3.0.4", isSemVerMajor: false }; },
    (f) => { f.full.vulnerabilities.micromatch.via = ["micromatch"]; },
    (f) => { f.full = report({ ...f.full.vulnerabilities, extra: { name: "extra", severity: "low", nodes: ["node_modules/extra"], via: ["braces"] } }); },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => review(f)); }
});

test("malformed, truncated or network-error audits cannot be mistaken for clean evidence", () => {
  for (const full of [{}, null, { error: { code: "EACCES" } }, { ...report(), auditReportVersion: 1 },
    { ...report(), vulnerabilities: [] }, { ...report(), metadata: { vulnerabilities: { total: 0 } } }]) {
    const f = fixture(); f.full = full; assert.throws(() => review(f));
  }
  const f = fixture(); f.full.metadata.vulnerabilities.total = 0; assert.throws(() => review(f));
});

const minimatchPolicy = JSON.parse(readFileSync(new URL("../scripts/qa/dependency-policy-minimatch.json", import.meta.url), "utf8"));
function minimatchFixture() {
  const entries = {}, lock = { packages: {} };
  for (const [name, value] of Object.entries(minimatchPolicy.packages)) {
    for (const [node, version] of Object.entries(value.nodes)) lock.packages[node] = { version, dev: true };
    entries[name] = { name, severity: "moderate", nodes: Object.keys(value.nodes),
      via: name === "minimatch" ? [{ name, url: minimatchPolicy.advisory, severity: "moderate", range: "<11.0.1" }] : [...value.via],
      fixAvailable: value.fix === true ? true : value.fix === "eslint-downgrade" ? { name: "eslint", version: "4.0.0", isSemVerMajor: true }
        : { name: "eslint-config-next", version: "0.2.4", isSemVerMajor: true } };
  }
  return { full: report(entries), production: report(), lock, developmentPolicy: structuredClone(minimatchPolicy) };
}
const reviewMinimatch = (f, time = "2026-11-01T04:00:00Z") => reviewDependencyAudits(f.full, f.production, f.lock, policy,
  { now: new Date(time), developmentPolicy: f.developmentPolicy });

test("the explicitly approved minimatch deferral binds all 16 moderate development packages and expires in Philippine time", () => {
  const result = reviewMinimatch(minimatchFixture());
  assert.equal(result.status, "passed_with_reviewed_development_risk");
  assert.equal(result.productionFindings, 0); assert.equal(result.deferredDevelopmentPackages, 16);
  assert.equal(result.approvedBy, "justinedupa2005"); assert.equal(result.expiresOn, "2026-11-08");
  assert.equal(result.expiresAt, "2026-11-07T16:00:00.000Z"); assert.equal(result.timezone, "Asia/Manila");
  assert.doesNotThrow(() => reviewMinimatch(minimatchFixture(), "2026-11-07T15:59:59Z"));
  for (const time of ["2026-10-31T15:59:59Z", "2026-11-07T16:00:00Z", "2026-11-08T00:00:00Z"])
    assert.throws(() => reviewMinimatch(minimatchFixture(), time));
});

test("the seven-day exception cannot authorize production risk, new advisories, changed dependencies, fixes or renewal", () => {
  const mutations = [
    f => { f.production = report({ minimatch: f.full.vulnerabilities.minimatch }); },
    f => { f.full.vulnerabilities.minimatch.severity = "high"; f.full = report(f.full.vulnerabilities); },
    f => { f.full.vulnerabilities.minimatch.via.push({ name: "minimatch", url: "https://github.com/advisories/GHSA-new", severity: "moderate", range: "*" }); },
    f => { f.full.vulnerabilities.minimatch.via[0].range = "<11.0.4"; },
    f => { f.full.vulnerabilities.minimatch.nodes.push("node_modules/new/node_modules/minimatch"); },
    f => { f.lock.packages["node_modules/minimatch"].dev = false; },
    f => { f.lock.packages["node_modules/minimatch"].version = "3.1.6"; },
    f => { f.full.vulnerabilities.eslint.via.push("minimatch"); },
    f => { f.full.vulnerabilities.minimatch.fixAvailable = { name: "minimatch", version: "11.0.3", isSemVerMajor: false }; },
    f => { f.full.vulnerabilities.minimatch.fixAvailable = true; },
    f => { f.full.vulnerabilities["eslint-plugin-import"].fixAvailable = false; },
    f => { delete f.full.vulnerabilities["eslint-plugin-react"]; f.full = report(f.full.vulnerabilities); },
    f => { f.full.vulnerabilities.extra = { name: "extra", severity: "low", via: ["minimatch"], nodes: ["node_modules/extra"] }; f.full = report(f.full.vulnerabilities); },
    f => { f.developmentPolicy.approved = false; },
    f => { f.developmentPolicy.approvedBy = "unapproved-owner"; },
    f => { f.developmentPolicy.scope = "all-dependencies"; },
    f => { f.developmentPolicy.expiresOn = "2026-11-09"; },
    f => { f.developmentPolicy.reviewedOn = "2026-11-02"; f.developmentPolicy.expiresOn = "2026-11-09"; },
  ];
  for (const mutate of mutations) { const f = minimatchFixture(); mutate(f); assert.throws(() => reviewMinimatch(f)); }
  for (const full of [{}, { ...report(), error: { code: "NETWORK" } }, { ...report(), vulnerabilities: [] }]) {
    const f = minimatchFixture(); f.full = full; assert.throws(() => reviewMinimatch(f));
  }
});
