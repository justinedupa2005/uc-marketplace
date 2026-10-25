const severities = ["info", "low", "moderate", "high", "critical"];
const failure = () => new Error("Dependency review failed: unreviewed, expired, production, or invalid audit evidence. No raw diagnostics were printed.");

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
export function reviewDependencyAudits(fullReport, productionReport, lock, policy, { now = new Date() } = {}) {
  const full = vulnerabilities(fullReport);
  if (vulnerabilities(productionReport).size) throw failure();
  if (!full.size) return { status: "passed", productionFindings: 0, deferredDevelopmentPackages: 0 };
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
