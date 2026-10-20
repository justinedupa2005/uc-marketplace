/** Narrow regression guard, not a claim to detect every possible secret format. */
export function secretFindingCodes(text) {
  // This one inert literal is an existing security-audit negative-test fixture.
  // Do not exempt test directories or arbitrary strings labelled as fixtures.
  const value = text.replace(/\bsb_secret_nonprivateQaFixture0000\b/g, "[inert-negative-test]");
  const findings = new Set();
  if (/\bsb_secret_[A-Za-z0-9_-]{16,}/.test(value)) findings.add("supabase-privileged-key");
  for (const token of value.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) ?? []) {
    try {
      const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      if (["service_role", "supabase_admin"].includes(claims.role)) findings.add("supabase-privileged-jwt");
    } catch { /* Arbitrary JWT-shaped text is not proof of a privileged token. */ }
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/.test(value)) findings.add("private-key");
  if (/\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/.test(value)) findings.add("github-token");
  if (/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(value)) findings.add("aws-access-key");
  for (const match of value.matchAll(/(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|AUTH_RECOVERY_SECRET|SMTP_PASSWORD|SMTP_PASS|GITHUB_TOKEN|GH_TOKEN|_authToken)["']?\s*[:=]\s*["']([A-Za-z0-9_+\/=.!-]{16,})["']/g)) {
    if (match[1] !== "private-test-config") findings.add("assigned-private-credential");
  }
  // dotenv files often omit quotes. Do not interpret JS environment references
  // as literal credentials, but still catch unquoted historical assignments.
  for (const match of value.matchAll(/(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|AUTH_RECOVERY_SECRET|SMTP_PASSWORD|SMTP_PASS|GITHUB_TOKEN|GH_TOKEN|_authToken)\s*=\s*([A-Za-z0-9_+\/=.!-]{16,})(?=\s*(?:$|[#;]))/gm)) {
    if (match[1] !== "private-test-config" && !match[1].startsWith("process.env.")) findings.add("assigned-private-credential");
  }
  for (const match of value.matchAll(/postgres(?:ql)?:\/\/[^\s"'`<>]+:[^\s"'`<>]+@[^\s"'`<>]+/g)) {
    try {
      const url = new URL(match[0]);
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      const inertFixture = (url.username === "postgres" && ["test", "fixture"].includes(url.password)
        && (loopback || ["db.disposableqa.supabase.co", "db.production.supabase.co"].includes(url.hostname)))
        || (url.username === "credential" && url.password === "secret" && url.hostname === "private.test");
      if (!(inertFixture || (url.username === "postgres" && url.password === "postgres" && loopback))) findings.add("database-credential");
    } catch { findings.add("database-credential"); }
  }
  return [...findings].sort();
}

export function isSecretFilename(filename) {
  const name = filename.replaceAll("\\", "/").split("/").at(-1);
  return (/^\.env(?:\.|$)/.test(name) && !/\.(?:example|sample|template)$/.test(name))
    || /\.(?:pem|key|p12|pfx|jks|keystore)$/.test(name)
    || /^(?:id_rsa|id_ed25519|credentials\.json|service-account\.json)$/.test(name);
}
