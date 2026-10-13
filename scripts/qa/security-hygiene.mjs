import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const publicVariables = new Set(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_APP_URL", "NODE_ENV"]);
const privateVariable = /(?:SERVICE_ROLE|SUPABASE_SECRET|DATABASE_URL|DB_PASSWORD|DATABASE_PASSWORD|PRIVATE_KEY|ADMIN_PASSWORD)/i;
const mockDataName = /^(?:mock|fake|dummy|sample)(?:Profiles?|Listings?|Favorites?|Messages?|Reservations?|Meetups?|Notifications?|Reports?|Users?|Dashboard)(?:Data)?$/i;
const posix = (value) => value.replaceAll("\\", "/");

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filename) : [filename];
  });
}

function literalText(node) {
  return node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
}

function envName(node) {
  if (ts.isPropertyAccessExpression(node) && node.expression.getText() === "process.env") return node.name.text;
  if (ts.isElementAccessExpression(node) && node.expression.getText() === "process.env") return literalText(node.argumentExpression) ?? "<dynamic>";
  if (ts.isPropertyAccessExpression(node) && node.getText() === "process.env") {
    const parent = node.parent;
    // Explicit property reads are reviewed individually. Exporting, spreading,
    // destructuring, or aliasing the entire environment is not a safe browser
    // contract, even if an eventual read uses a different identifier.
    if (!((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node)) return "<dynamic>";
  }
  return null;
}

function runtimeImports(source) {
  const values = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const bindings = node.importClause?.namedBindings;
      const typeOnlyNamed = bindings && ts.isNamedImports(bindings) && !node.importClause.name && bindings.elements.every((element) => element.isTypeOnly);
      if (!typeOnlyNamed) values.push(literalText(node.moduleSpecifier));
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) values.push(literalText(node.moduleSpecifier));
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText() === "require")) values.push(literalText(node.arguments[0]));
    ts.forEachChild(node, visit);
  }
  visit(source);
  return values.filter(Boolean);
}

function directives(source) {
  const values = new Set();
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    values.add(statement.expression.text);
  }
  return values;
}

function containsPrivilegedToken(value) {
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(value)) return true;
  for (const token of value.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) ?? []) {
    try {
      const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      if (["service_role", "supabase_admin"].includes(claims.role)) return true;
    } catch { /* A JWT-shaped string is not by itself a privileged secret. */ }
  }
  return false;
}

// AST/import-graph checks are a regression guard, not a substitute for live
// Auth/RLS/Storage tests. No source text or suspected secret is included in logs.
export function analyzeSources(files) {
  const modules = new Map();
  const issues = [];
  for (const [filename, code] of files) {
    const normalized = posix(filename);
    const source = ts.createSourceFile(normalized, code, ts.ScriptTarget.Latest, true, normalized.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const imports = runtimeImports(source);
    const marks = directives(source);
    const environment = [];
    function visit(node) {
      const name = envName(node);
      if (name) {
        environment.push(name);
        if (privateVariable.test(name)) issues.push({ file: normalized, code: "privileged-production-environment" });
        if (name.startsWith("NEXT_PUBLIC_") && !publicVariables.has(name)) issues.push({ file: normalized, code: "unreviewed-public-environment" });
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && mockDataName.test(node.name.text)) issues.push({ file: normalized, code: "production-mock-dataset" });
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText() === "console" && ["log", "debug", "trace"].includes(node.expression.name.text)) issues.push({ file: normalized, code: "production-debug-log" });
      const text = literalText(node);
      if (text && containsPrivilegedToken(text)) issues.push({ file: normalized, code: "embedded-privileged-secret" });
      ts.forEachChild(node, visit);
    }
    visit(source);
    modules.set(normalized, { imports, marks, environment });
  }
  function resolveLocal(importer, specifier) {
    const base = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : specifier.startsWith(".") ? posix(path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier))) : null;
    if (!base) return null;
    return [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`].find((candidate) => modules.has(candidate)) ?? null;
  }
  for (const [root, module] of modules) {
    if (!module.marks.has("use client")) continue;
    const visited = new Set();
    function inspect(filename) {
      if (visited.has(filename)) return;
      visited.add(filename);
      const current = modules.get(filename);
      // Next compiles an action import into a reference. Its implementation is
      // not part of the browser module graph, so this boundary is intentional.
      if (filename !== root && current.marks.has("use server")) return;
      if (current.imports.includes("server-only") || current.imports.some((value) => ["next/headers", "next/server"].includes(value))) issues.push({ file: root, dependency: filename, code: "client-imports-server-module" });
      if (current.environment.some((name) => !publicVariables.has(name))) issues.push({ file: root, dependency: filename, code: "client-imports-private-environment" });
      for (const specifier of current.imports) {
        const dependency = resolveLocal(filename, specifier);
        if (dependency) inspect(dependency);
      }
    }
    inspect(root);
  }
  return [...new Map(issues.map((issue) => [JSON.stringify(issue), issue])).values()];
}

export function auditRepository(root, { bundles = false } = {}) {
  const files = new Map(walk(path.join(root, "src")).filter((filename) => /\.[cm]?[jt]sx?$/.test(filename)).map((filename) => [posix(path.relative(root, filename)), readFileSync(filename, "utf8")]));
  const issues = analyzeSources(files);
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
  for (const filename of tracked) {
    const basename = path.posix.basename(posix(filename));
    if ((/^\.env(?:\.|$)/.test(basename) && !/\.(?:example|sample|template)$/.test(basename)) || /\.(?:pem|p12|pfx)$/.test(basename)) issues.push({ file: filename, code: "tracked-secret-file" });
  }
  try {
    execFileSync("git", ["check-ignore", "--quiet", "--no-index", ".env.local"], { cwd: root, stdio: "ignore", windowsHide: true });
  } catch { issues.push({ file: ".env.local", code: "local-environment-not-ignored" }); }
  let bundleCount = 0;
  if (bundles) {
    const chunks = walk(path.join(root, ".next", "static")).filter((filename) => /\.js$/.test(filename));
    if (!chunks.length) issues.push({ file: ".next/static", code: "production-bundle-missing" });
    for (const filename of chunks) {
      bundleCount += 1;
      const code = readFileSync(filename, "utf8");
      if (containsPrivilegedToken(code) || /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|DATABASE_PASSWORD|DB_PASSWORD|AUTH_RECOVERY_SECRET/.test(code)) issues.push({ file: posix(path.relative(root, filename)), code: "privileged-browser-bundle-content" });
    }
  }
  return { issues, sourceCount: files.size, bundleCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const result = auditRepository(root, { bundles: process.argv.includes("--bundles") });
  if (result.issues.length) {
    for (const issue of result.issues) console.error(`${issue.code}: ${issue.file}${issue.dependency ? ` via ${issue.dependency}` : ""}`);
    process.exitCode = 1;
  } else console.info(`Security hygiene passed: ${result.sourceCount} source modules${result.bundleCount ? `, ${result.bundleCount} browser chunks` : ""}. Static checks do not certify live permissions.`);
}
