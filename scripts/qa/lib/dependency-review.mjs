import { isDeepStrictEqual } from "node:util";

const severities = ["info", "low", "moderate", "high", "critical"];
const minimatchPackages = ["@eslint-community/eslint-utils", "@eslint/config-array", "@eslint/eslintrc", "@next/eslint-plugin-next",
  "@typescript-eslint/eslint-plugin", "@typescript-eslint/parser", "@typescript-eslint/type-utils", "@typescript-eslint/typescript-estree",
  "@typescript-eslint/utils", "eslint", "eslint-config-next", "eslint-plugin-import", "eslint-plugin-jsx-a11y", "eslint-plugin-react", "minimatch", "typescript-eslint"];
const reviewCodes = new Set(["AUDIT_EVIDENCE_INVALID", "PRODUCTION_FINDINGS", "MINIMATCH_APPROVAL_INVALID_OR_EXPIRED", "MINIMATCH_FINDINGS_CHANGED", "MINIMATCH_NODES_OR_SEVERITY_CHANGED", "MINIMATCH_INSTALL_CHANGED", "MINIMATCH_ADVISORY_CHANGED", "MINIMATCH_EDGES_CHANGED", "MINIMATCH_DIRECT_DEPENDENCY_CHANGED", "MINIMATCH_FIX_CHANGED"]);
const failure = (code = "AUDIT_EVIDENCE_INVALID") => Object.assign(new Error("Dependency review failed: unreviewed, expired, production, or invalid audit evidence. No raw diagnostics were printed."), { reviewCode: reviewCodes.has(code) ? code : "AUDIT_EVIDENCE_INVALID" });

export function dependencyFailureCode(error) { return reviewCodes.has(error?.reviewCode) ? error.reviewCode : "AUDIT_COMMAND_OR_NETWORK_FAILED"; }
export function dependencyFailureDetails(error) {
  const fix = error?.reviewFix;
  const proposal = typeof fix === "boolean" ? fix : fix && minimatchPackages.includes(fix.name)
    && /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[A-Za-z0-9.-]{1,40})?$/.test(fix.version ?? "") && typeof fix.isSemVerMajor === "boolean"
    ? { name: fix.name, version: fix.version, isSemVerMajor: fix.isSemVerMajor } : undefined;
  return { code: dependencyFailureCode(error),
    ...(minimatchPackages.includes(error?.reviewPackage) ? { package: error.reviewPackage } : {}),
    ...(["IN_RANGE_UPDATE", "ESLINT_DOWNGRADE", "NEXT_CONFIG_DOWNGRADE", "UNREVIEWED_FIX"].includes(error?.reviewFixClass) ? { fixClass: error.reviewFixClass } : {}),
    ...(proposal === undefined ? {} : { proposal }) };
}

function vulnerabilities(report) {
  if (report?.auditReportVersion !== 2 || report.error || !report.vulnerabilities
    || typeof report.vulnerabilities !== "object" || Array.isArray(report.vulnerabilities)) throw failure();
  const entries = Object.entries(report.vulnerabilities);
  const counts = report.metadata?.vulnerabilities;
  if (!counts || !severities.every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0)
    || counts.total !== entries.length || severities.reduce((sum, key) => sum + counts[key], 0) !== entries.length) throw failure();
  for (const [name, value] of entries) {
    if (value?.name !== name || !severities.includes(value.severity) || !Array.isArray(value.via)
      || !value.via.length || !Array.isArray(value.nodes) || !value.nodes.length) throw failure();
  }
  for (const severity of severities) if (counts[severity] !== entries.filter(([, value]) => value.severity === severity).length) throw failure();
  return new Map(entries);
}

/** Every production finding fails; development exceptions bind the entire exact chain. */
export function reviewDependencyAudits(fullReport, productionReport, lock, policy, { now = new Date(), developmentPolicy } = {}) {
  const full = vulnerabilities(fullReport);
  if (vulnerabilities(productionReport).size) throw failure("PRODUCTION_FINDINGS");
  if (!full.size) return { status: "passed", productionFindings: 0, deferredDevelopmentPackages: 0 };
  if (developmentPolicy !== undefined) return reviewMinimatch(full, lock, developmentPolicy, now);
  const reviewed = Date.parse(`${policy?.reviewedOn}T00:00:00.000Z`);
  const expiry = Date.parse(`${policy?.expiresOn}T00:00:00.000Z`);
  if (policy?.version !== 1 || !Number.isFinite(reviewed) || !Number.isFinite(expiry)
    || !Number.isFinite(now.getTime()) || now.getTime() < reviewed || now.getTime() >= expiry
    || expiry <= reviewed || expiry - reviewed > 31 * 86_400_000
    || policy.advisory !== "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm"
    || policy.severity !== "high" || !policy.reason || !policy.mitigation
    || !policy.packages || Object.keys(policy.packages).length !== 5 || full.size !== 5) throw failure();
  const expected = ["@next/eslint-plugin-next", "braces", "eslint-config-next", "fast-glob", "micromatch"];
  for (const name of expected) {
    const value = full.get(name);
    const node = `node_modules/${name}`;
    const installed = lock?.packages?.[node];
    if (!value || value.severity !== "high" || value.nodes.length !== 1 || value.nodes[0] !== node
      || installed?.dev !== true || installed.version !== policy.packages[name]) throw failure();
    const visiting = new Set();
    function roots(current) {
      if (visiting.has(current)) throw failure();
      visiting.add(current);
      const finding = full.get(current);
      if (!finding) throw failure();
      for (const via of finding.via) {
        if (typeof via === "string") roots(via);
        else if (current !== "braces" || via?.url !== policy.advisory || via.severity !== "high"
          || via.name !== "braces" || via.range !== "<=3.0.3") throw failure();
      }
      visiting.delete(current);
    }
    roots(name);
    // A compatible fix becoming available invalidates this temporary deferral.
    if (value.fixAvailable && !(value.fixAvailable.name === "eslint-config-next"
      && value.fixAvailable.version === "14.2.35" && value.fixAvailable.isSemVerMajor === true)) throw failure();
  }
  return { status: "passed_with_reviewed_development_risk", productionFindings: 0,
    deferredDevelopmentPackages: full.size, advisory: policy.advisory, expiresOn: policy.expiresOn };
}

function reviewMinimatch(full, lock, policy, now) {
  // This is the single owner-approved seven-day exception, not a general
  // severity threshold or a renewable allowlist. Historical braces logic above
  // remains separately testable; the current CLI selects only this policy.
  const expected = minimatchPackages;
  const reviewed = Date.parse(`${policy?.reviewedOn}T00:00:00+08:00`), expiry = Date.parse(`${policy?.expiresOn}T00:00:00+08:00`);
  if (policy?.version !== 1 || policy.approved !== true || policy.approvedBy !== "justinedupa2005" || policy.scope !== "development-only"
    || policy.reviewedOn !== "2026-11-01" || policy.expiresOn !== "2026-11-08" || policy.timezone !== "Asia/Manila"
    || !Number.isFinite(now.getTime()) || now.getTime() < reviewed || now.getTime() >= expiry || expiry - reviewed !== 7 * 86400000
    || policy.advisory !== "https://github.com/advisories/GHSA-g3hv-75wg-m249" || policy.severity !== "moderate" || !policy.reason || !policy.mitigation) throw failure("MINIMATCH_APPROVAL_INVALID_OR_EXPIRED");
  if (full.size !== expected.length || !isDeepStrictEqual(Object.keys(policy.packages ?? {}).sort(), [...expected].sort())) throw failure("MINIMATCH_FINDINGS_CHANGED");
  for (const name of expected) {
    const value = full.get(name), approved = policy.packages[name];
    if (!value || value.severity !== "moderate" || !approved?.nodes || !Array.isArray(approved.via)
      || !isDeepStrictEqual([...value.nodes].sort(), Object.keys(approved.nodes).sort())) throw failure("MINIMATCH_NODES_OR_SEVERITY_CHANGED");
    for (const node of value.nodes) {
      const installed = lock?.packages?.[node];
      if (installed?.dev !== true || installed.version !== approved.nodes[node]) throw failure("MINIMATCH_INSTALL_CHANGED");
    }
    const via = value.via.map(item => {
      if (typeof item === "string") {
        if (!expected.includes(item)) throw failure("MINIMATCH_ADVISORY_CHANGED");
        return item;
      }
      if (name !== "minimatch" || item?.name !== "minimatch" || item.url !== policy.advisory
        || item.severity !== "moderate" || item.range !== "<11.0.1") throw failure("MINIMATCH_ADVISORY_CHANGED");
      return item.url;
    });
    if (!isDeepStrictEqual(via.sort(), [...approved.via].sort())) throw failure("MINIMATCH_EDGES_CHANGED");
    // Arborist propagates fixAvailable through transitive via/effects cycles;
    // traversal/cache order changes those suggestions without changing risk.
    // Bind the two actual project-level remedy classes, not indirect display
    // metadata. All 16 packages' paths, versions, edges and advisory stay bound.
    const direct = name === "eslint" || name === "eslint-config-next";
    if (value.isDirect !== direct) throw failure("MINIMATCH_DIRECT_DEPENDENCY_CHANGED");
    if (!direct) continue;
    const fix = value.fixAvailable;
    const offered = typeof fix?.version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(fix.version);
    const installedMajor = Number(approved.nodes[`node_modules/${name}`].split(".")[0]);
    const expectedClass = name === "eslint" ? "eslint-downgrade" : "next-config-downgrade";
    // npm may pick 0.2.4, 12.0.4, etc. for the same Next-config finding. The
    // meaningful assessment is an incompatible *older major*, not which old
    // release an unordered calculation picks. Never accept an in-range fix,
    // same/newer major, changed remedy package, missing evidence or weak flag.
    const olderMajor = offered && fix.name === name && fix.isSemVerMajor === true && Number(offered[1]) < installedMajor;
    if (approved.fix !== expectedClass || !olderMajor) throw Object.assign(failure("MINIMATCH_FIX_CHANGED"), {
      reviewPackage: name, reviewFix: fix, reviewFixClass: fix === true ? "IN_RANGE_UPDATE" : "UNREVIEWED_FIX" });
  }
  return { status: "passed_with_reviewed_development_risk", productionFindings: 0, deferredDevelopmentPackages: full.size,
    advisory: policy.advisory, approvedBy: policy.approvedBy, expiresOn: policy.expiresOn, expiresAt: new Date(expiry).toISOString(), timezone: policy.timezone };
}
