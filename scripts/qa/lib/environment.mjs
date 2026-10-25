import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const privilegedConfigurationName = /SERVICE[_-]?ROLE|SECRET|PRIVATE[_-]?KEY|API[_-]?KEY|TOKEN|CREDENTIAL|PASSWORD|PASSWD|DATABASE|(?:^|_)DB_(?:URL|DSN|USER|USERNAME|PASS|PWD|CONNECTION)|(?:^|_)POSTGRES(?:QL)?_(?:URL|DSN|USER|USERNAME|PASSWORD|CONNECTION)|(?:^|_)PG(?:PASSWORD|USER)|ADMIN_(?:KEY|TOKEN|CREDENTIAL)/i;
const applicationDotenvFiles = [".env.production.local", ".env.local", ".env.production", ".env"];

/** Inspect assignment names only; never parse, expand, return or log values. */
export function getPrivilegedDotenvNames(contents) {
  const names = [...contents.matchAll(/^[ \t]*(?:export[ \t]+)?([A-Za-z_][\w.-]*)[ \t]*(?:=|:[ \t]+)/gm)].map((match) => match[1]);
  // This one app-owned server secret is legitimate dotenv configuration. The
  // runner still strips it from inherited env and supplies a fresh run-owned
  // key; fixture/operator secrets and every other secret name stay forbidden.
  return [...new Set(names.filter((name) => name !== "AUTH_RECOVERY_SECRET" && privilegedConfigurationName.test(name)))];
}

export async function assertQaDotenvSafety(root = process.cwd()) {
  for (const filename of applicationDotenvFiles) {
    let contents;
    try { contents = await readFile(path.join(root, filename), "utf8"); }
    catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error("QA cannot safely inspect the application's local dotenv configuration.");
    }
    if (getPrivilegedDotenvNames(contents).length) {
      throw new Error(`Full-stack QA refuses privileged variable names in ${filename}. Keep fixture secrets outside the application's dotenv files.`);
    }
  }
}

export const isLoopback = (hostname) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);

export function isQaPublishableKey(key) {
  if (typeof key !== "string") return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
  try {
    return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"))?.role === "anon";
  } catch { return false; }
}

function parseUrl(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an explicit valid URL.`); }
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error(`${name} must be an origin without credentials, paths, or query parameters.`);
  }
  return url;
}

/** Explicit test configuration only: never load .env.local or infer a linked target. */
export function validateQaEnvironment(env, { requireDatabase = false, requireLocal = false, requireMailpit = false, linkedProjectRef = null } = {}) {
  if (env.QA_ALLOW_MUTATIONS !== "1") throw new Error("Set QA_ALLOW_MUTATIONS=1 only for a disposable QA environment.");
  if (!env.QA_SUPABASE_URL || !env.QA_SUPABASE_PUBLISHABLE_KEY || !env.QA_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("QA_SUPABASE_URL, QA_SUPABASE_PUBLISHABLE_KEY, and QA_SUPABASE_SERVICE_ROLE_KEY are required. Production configuration is never used implicitly.");
  }
  if (!isQaPublishableKey(env.QA_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error("QA_SUPABASE_PUBLISHABLE_KEY must be a publishable key or legacy anon JWT, never a privileged secret.");
  }
  const target = parseUrl(env.QA_SUPABASE_URL, "QA_SUPABASE_URL");
  const local = isLoopback(target.hostname);
  if (local) {
    if (!["http:", "https:"].includes(target.protocol) || !target.port) throw new Error("Local Supabase QA requires HTTP(S) and an explicit port.");
  } else {
    const match = /^([a-z0-9]+)\.supabase\.co$/.exec(target.hostname);
    if (target.protocol !== "https:" || !match || target.port || env.QA_ALLOW_REMOTE !== "1" || env.QA_ALLOWED_PROJECT_REF !== match[1]) {
      throw new Error("Remote QA requires HTTPS, QA_ALLOW_REMOTE=1, and QA_ALLOWED_PROJECT_REF matching the disposable Supabase project.");
    }
    if (match[1] === linkedProjectRef) throw new Error("The repository's linked Supabase project is not a disposable QA target. Use a separate project.");
  }
  if (requireLocal && !local) throw new Error("Authenticated browser QA requires local disposable Supabase. Use --api-only for an explicitly approved separate remote QA project.");
  if (env.QA_SUPABASE_PUBLISHABLE_KEY === env.QA_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("QA public and privileged keys must be different.");
  }
  const app = parseUrl(env.QA_APP_BASE_URL ?? "http://127.0.0.1:3106", "QA_APP_BASE_URL");
  if (!isLoopback(app.hostname) || !["http:", "https:"].includes(app.protocol) || !app.port) {
    throw new Error("Browser QA must use a dedicated loopback application server with an explicit port.");
  }
  let databaseUrl = null;
  if (env.QA_DATABASE_URL) {
    let database;
    try { database = new URL(env.QA_DATABASE_URL); } catch { throw new Error("QA_DATABASE_URL must be valid PostgreSQL connection configuration."); }
    if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hash) throw new Error("QA_DATABASE_URL must use PostgreSQL.");
    const parameters = [...database.searchParams.entries()];
    if (parameters.length > 1 || parameters.some(([name]) => name !== "sslmode")) {
      throw new Error("QA_DATABASE_URL allows only one sslmode parameter; connection target overrides are refused.");
    }
    if (local) {
      if (!isLoopback(database.hostname) || !database.port) throw new Error("Local QA requires a loopback database with an explicit port.");
      if (database.searchParams.has("sslmode") && !["disable", "prefer", "require"].includes(database.searchParams.get("sslmode"))) {
        throw new Error("Local QA_DATABASE_URL sslmode must be disable, prefer, or require.");
      }
    } else {
      // Pooler hosts are shared between projects; require the exact project
      // identifier in the login, or its dedicated database host.
      const ref = env.QA_ALLOWED_PROJECT_REF;
      const dedicated = database.hostname === `db.${ref}.supabase.co`;
      const pooler = database.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(database.username) === `postgres.${ref}`;
      if ((!dedicated && !pooler) || database.searchParams.get("sslmode") !== "require") {
        throw new Error("Remote QA database must match the allowed project and require TLS.");
      }
    }
    databaseUrl = env.QA_DATABASE_URL;
  }
  if (requireDatabase && !databaseUrl) throw new Error("QA_DATABASE_URL is required for real concurrent-transaction testing.");
  let mailpitUrl = null;
  if (env.QA_MAILPIT_URL) {
    const mailpit = parseUrl(env.QA_MAILPIT_URL, "QA_MAILPIT_URL");
    if (!local || !isLoopback(mailpit.hostname) || !["http:", "https:"].includes(mailpit.protocol) || !mailpit.port) {
      throw new Error("QA_MAILPIT_URL requires local disposable Supabase and a loopback HTTP(S) capture server with an explicit port.");
    }
    mailpitUrl = mailpit.origin;
  }
  if (requireMailpit && !mailpitUrl) throw new Error("QA_MAILPIT_URL is required for full local signup/recovery SMTP acceptance.");
  const emailConfirmationMode = env.QA_EMAIL_CONFIRMATION_MODE ?? "code";
  if (!["code", "link"].includes(emailConfirmationMode)) throw new Error("QA_EMAIL_CONFIRMATION_MODE must be code or link.");
  return Object.freeze({
    supabaseUrl: target.origin,
    publishableKey: env.QA_SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: env.QA_SUPABASE_SERVICE_ROLE_KEY,
    appBaseUrl: app.origin,
    appPort: app.port,
    databaseUrl,
    local,
    mailpitUrl,
    emailConfirmationMode,
  });
}

export async function readQaEnvironment(options = {}) {
  let linkedProjectRef = null;
  try { linkedProjectRef = (await readFile(new URL("../../../supabase/.temp/project-ref", import.meta.url), "utf8")).trim(); }
  catch (error) { if (error.code !== "ENOENT") throw new Error("Cannot verify the linked-project safety boundary."); }
  return Object.freeze({ ...validateQaEnvironment(process.env, { ...options, linkedProjectRef }), recoverySecret: randomBytes(32).toString("hex") });
}

export function getQaAppEnvironment(config, env = process.env) {
  // Privileged keys and database credentials belong only to the fixture runner,
  // never the Next.js build/server or browser worker processes.
  const safe = Object.fromEntries(Object.entries(env).filter(([name]) => !privilegedConfigurationName.test(name) && !/^QA_.*_(EMAIL|ID)$/.test(name)));
  return {
    ...safe,
    APP_ENV: "local",
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: config.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
    NEXT_PUBLIC_APP_URL: config.appBaseUrl,
    ...(config.recoverySecret && { AUTH_RECOVERY_SECRET: config.recoverySecret }),
    EMAIL_CONFIRMATION_MODE: config.emailConfirmationMode ?? "code",
  };
}

export function getQaBrowserEnvironment(config, env = process.env) {
  const environment = getQaAppEnvironment(config, env);
  delete environment.AUTH_RECOVERY_SECRET;
  return environment;
}
