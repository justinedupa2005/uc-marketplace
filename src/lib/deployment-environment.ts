// Pure server/build validation; never import this module from client code.
// Identifiers/origins are public. No credentials or generated defaults live here.
import environments from "../../config/environments.json" with { type: "json" };
import { isStrongRecoverySecret } from "./auth/recovery-secret.mjs";

type Environment = Record<string, string | undefined>;
export const APPLICATION_PUBLIC_VARIABLES = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_APP_URL",
] as const;
// Exact documented Next.js framework metadata, not an arbitrary prefix bypass.
// https://vercel.com/docs/environment-variables/framework-environment-variables
export const VERCEL_PUBLIC_VARIABLES = ["ENV", "TARGET_ENV", "URL", "BRANCH_URL", "PROJECT_PRODUCTION_URL", "HASH_SALT",
  "GIT_PROVIDER", "GIT_REPO_SLUG", "GIT_REPO_OWNER", "GIT_REPO_ID", "GIT_COMMIT_REF", "GIT_COMMIT_SHA",
  "GIT_COMMIT_MESSAGE", "GIT_COMMIT_AUTHOR_LOGIN", "GIT_COMMIT_AUTHOR_NAME", "GIT_PULL_REQUEST_ID"]
  .map((name) => `NEXT_PUBLIC_VERCEL_${name}`);
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const operatorVariable = /^(?:(?:(?:STAGING|PRODUCTION|QA)_)?SUPABASE_(?:ACCESS_TOKEN|MANAGEMENT_TOKEN|SERVICE_ROLE_KEY|SECRET_KEY|DB_PASSWORD|DATABASE_URL)|(?:STAGING|PRODUCTION|QA)_(?:MANAGEMENT_TOKEN|SERVICE_ROLE_KEY|SECRET_KEY)|(?:(?:STAGING|PRODUCTION|QA)_)?(?:DATABASE_URL|DB_PASSWORD|DATABASE_PASSWORD)|SMTP_(?:PASSWORD|PASS))$/;

function origin(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    if (!url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
      && ["http:", "https:"].includes(url.protocol)) return url;
  } catch { /* Static diagnostics only; never include supplied values. */ }
  throw new Error("Supabase and application URLs must be explicit HTTP(S) origins without credentials, paths or query parameters.");
}

export function validateDeploymentEnvironment(env: Environment) {
  const hosted = env.VERCEL === "1" || Boolean(env.VERCEL_ENV);
  const mode = env.APP_ENV ?? (hosted ? "" : "local");
  if (!["local", "staging", "production"].includes(mode)) throw new Error("APP_ENV must explicitly identify local, staging or production.");
  if (hosted && mode === "local") throw new Error("Hosted deployments cannot use local configuration.");
  if (env.VERCEL_ENV === "preview" && mode !== "staging") throw new Error("Preview deployments must use the isolated staging environment.");
  if (hosted && mode === "production" && env.VERCEL_ENV !== "production") throw new Error("Hosted production configuration requires Vercel's Production target, never Development or an unspecified target.");
  if (Object.keys(env).some((name) => env[name] && operatorVariable.test(name))) {
    throw new Error("Privileged database/operator credentials must not enter the application environment.");
  }
  for (const name of Object.keys(env).filter((key) => key.startsWith("NEXT_PUBLIC_") && env[key])) {
    const value = env[name] ?? "";
    let privileged = value.startsWith("sb_secret_") || value === env.AUTH_RECOVERY_SECRET;
    try {
      const claims = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
      privileged ||= ["service_role", "supabase_admin"].includes(claims.role);
    } catch { /* Most public configuration is not a legacy JWT. */ }
    if (privileged) throw new Error("Privileged credentials must never be exposed through public environment variables.");
    // Vercel's public deployment metadata is not an application credential.
    if (!(APPLICATION_PUBLIC_VARIABLES as readonly string[]).includes(name) && !VERCEL_PUBLIC_VARIABLES.includes(name)) {
      throw new Error("Unreviewed public environment variable; use the application's existing variable names and never expose private credentials.");
    }
  }
  if (env.EMAIL_CONFIRMATION_MODE !== undefined && !["code", "link"].includes(env.EMAIL_CONFIRMATION_MODE)) throw new Error("EMAIL_CONFIRMATION_MODE must be code or link.");
  if (mode !== "local" && !env.EMAIL_CONFIRMATION_MODE) throw new Error("Hosted deployments must explicitly configure EMAIL_CONFIRMATION_MODE.");
  if (env.AUTH_RECOVERY_SECRET && !isStrongRecoverySecret(env.AUTH_RECOVERY_SECRET)) throw new Error("AUTH_RECOVERY_SECRET must be 32-64 cryptographically random bytes encoded as hex, not a placeholder.");
  // Permit unconfigured development tooling, never an unconfigured production
  // build/start or a partially configured local app.
  if (mode === "local" && env.NODE_ENV !== "production" && !APPLICATION_PUBLIC_VARIABLES.some((name) => env[name])) return { mode, noIndex: true };
  const database = origin(env.NEXT_PUBLIC_SUPABASE_URL);
  const app = origin(env.NEXT_PUBLIC_APP_URL);
  let ref: string | undefined;
  if (mode === "local") {
    if (!loopback.has(database.hostname) || !loopback.has(app.hostname)) throw new Error("Local development must use loopback Supabase and application origins, never a hosted student database.");
  } else {
    const selected = mode === "staging" ? environments.staging : environments.production;
    ref = selected.supabaseProjectRef;
    if (!/^[a-z]{20}$/.test(ref) || environments.staging.supabaseProjectRef === environments.production.supabaseProjectRef) throw new Error("Staging and production must have distinct registered Supabase projects.");
    if (database.protocol !== "https:" || database.port || database.hostname !== `${ref}.supabase.co`) throw new Error("Supabase target does not match the registered deployment environment.");
    if (app.protocol !== "https:" || app.port || app.origin !== selected.appOrigin) throw new Error("Application URL must match its registered independent HTTPS origin.");
    if (env.VERCEL_PROJECT_ID && env.VERCEL_PROJECT_ID !== selected.vercelProjectId) throw new Error("Vercel project does not match the selected application environment.");
    if (!isStrongRecoverySecret(env.AUTH_RECOVERY_SECRET)) throw new Error("Hosted deployments require a separate strong AUTH_RECOVERY_SECRET.");
  }
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (mode !== "local") publicKey = publicKey && key.length >= 34 && !/(?:^|[_-])(?:test|example|placeholder|changeme|replace|your|dummy|ci)(?:[_-]|$)/i.test(key);
  if (!publicKey && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) {
    try {
      const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
      publicKey = claims.role === "anon" && (mode === "local" || claims.ref === ref);
    } catch { /* JWT inspection checks configuration, not authenticity. */ }
  }
  if (!publicKey) throw new Error("Only a non-placeholder publishable key or the selected project's legacy anon key is allowed.");
  return { mode, noIndex: mode !== "production" };
}

export function assertDeploymentEnabled(mode: string) {
  if (mode === "production" && !environments.production.deploymentEnabled) throw new Error("Production deployment is disabled pending configuration verification and explicit release approval.");
}
