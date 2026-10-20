// Pure server/build validation; do not import this module from client code.
// Project references and origins are public identifiers, never credentials.
import environments from "../../config/environments.json" with { type: "json" };

type Environment = Record<string, string | undefined>;

export function validateDeploymentEnvironment(env: Environment) {
  const hosted = env.VERCEL === "1";
  const mode = env.APP_ENV ?? (hosted ? "" : "local");
  if (!["local", "staging", "production"].includes(mode)) {
    throw new Error("APP_ENV must explicitly identify local, staging or production.");
  }
  if (hosted && mode === "local") throw new Error("Hosted deployments cannot use local configuration.");
  if (env.VERCEL_ENV === "preview" && mode !== "staging") {
    throw new Error("Preview deployments must use the isolated staging environment.");
  }
  if (mode === "local") return { mode, noIndex: true };

  const ref = mode === "staging" ? environments.staging.supabaseProjectRef : environments.production.supabaseProjectRef;
  if (environments.staging.supabaseProjectRef === environments.production.supabaseProjectRef) {
    throw new Error("Staging and production project references must differ.");
  }
  let database: URL;
  let app: URL;
  try {
    database = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    app = new URL(env.NEXT_PUBLIC_APP_URL ?? "");
  } catch { throw new Error("Hosted deployments require explicit valid Supabase and application origins."); }
  const originOnly = (url: URL) => url.protocol === "https:" && !url.username && !url.password
    && !url.port && url.pathname === "/" && !url.search && !url.hash;
  if (!originOnly(database) || database.hostname !== `${ref}.supabase.co`) {
    throw new Error("Supabase target does not match the registered deployment environment.");
  }
  if (!originOnly(app) || app.hostname === database.hostname) {
    throw new Error("Application URL must be an independent HTTPS origin.");
  }
  if (mode === "staging" && app.origin !== environments.staging.appOrigin) {
    throw new Error("Staging must use its dedicated registered application origin.");
  }
  if (mode === "production" && app.origin === environments.staging.appOrigin) {
    throw new Error("Production cannot use the staging application origin.");
  }
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publicKey && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) {
    try {
      const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
      publicKey = claims.role === "anon" && claims.ref === ref;
    } catch { /* Reject opaque, malformed and privileged keys without logging them. */ }
  }
  if (!publicKey) throw new Error("Only the selected project's publishable key or legacy anon key is allowed.");
  if (!/^[a-fA-F0-9]{64,}$/.test(env.AUTH_RECOVERY_SECRET ?? "")) {
    throw new Error("Hosted deployments require a separate strong AUTH_RECOVERY_SECRET.");
  }
  // Database/admin credentials belong to operators or approved migration jobs,
  // never the Next.js build/runtime. The app uses session-scoped RLS clients.
  if (Object.keys(env).some((name) => /^(?:(?:STAGING_)?SUPABASE_(?:ACCESS_TOKEN|SERVICE_ROLE_KEY|SECRET_KEY)|STAGING_(?:MANAGEMENT_TOKEN|SERVICE_ROLE_KEY)|(?:STAGING_)?DATABASE_URL|(?:STAGING_)?DB_PASSWORD)$/.test(name) && env[name])) {
    throw new Error("Privileged database/operator credentials must not enter the application environment.");
  }
  return { mode, noIndex: mode !== "production" };
}
