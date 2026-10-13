import { validateQaEnvironment, getQaAppEnvironment } from "./environment.mjs";

export const LOCAL_QA_PORTS = Object.freeze({ api: 54331, database: 54332, studio: 54333, mailpit: 54334, shadow: 54330, analytics: 54337, pooler: 54339 });

function setTomlValue(source, section, name, value) {
  let current = "";
  let found = 0;
  const lines = source.split(/\r?\n/).map((line) => {
    const heading = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
    if (heading) current = heading[1];
    if (current === section && new RegExp(`^${name}\\s*=`).test(line)) {
      found++;
      return `${name} = ${value}`;
    }
    return line;
  });
  if (found !== 1) throw new Error("Local QA configuration no longer matches the tracked Supabase template. Review it before starting services.");
  return lines.join("\n");
}

/** Fresh per-run project, distinct ports, real SMTP and production-strength rules. */
export function buildLocalQaConfig(source, projectId) {
  if (!/^ucmarketplace-qa-[a-f0-9]{16}$/.test(projectId)) throw new Error("Local QA requires a uniquely named owned project.");
  let config = setTomlValue(source, "", "project_id", JSON.stringify(projectId));
  const overrides = [
    ["api", "port", LOCAL_QA_PORTS.api], ["db", "port", LOCAL_QA_PORTS.database],
    ["db", "shadow_port", LOCAL_QA_PORTS.shadow], ["db.pooler", "port", LOCAL_QA_PORTS.pooler],
    ["studio", "port", LOCAL_QA_PORTS.studio], ["studio", "enabled", "false"],
    ["local_smtp", "port", LOCAL_QA_PORTS.mailpit],
    ["auth", "site_url", '"http://127.0.0.1:3106"'],
    ["auth", "additional_redirect_urls", '["http://127.0.0.1:3106/auth/confirm", "http://127.0.0.1:3106/auth/recovery"]'],
    // More than seven fixture sign-ins plus full UI flows. These are isolated
    // load-test capacity settings, not relaxed password/email-confirmation rules.
    ["auth.rate_limit", "email_sent", 100], ["auth.rate_limit", "sign_in_sign_ups", 500],
    ["auth.rate_limit", "token_refresh", 500], ["auth.rate_limit", "token_verifications", 100],
    ["analytics", "enabled", "false"], ["analytics", "port", LOCAL_QA_PORTS.analytics],
    ["storage.vector", "enabled", "false"],
  ];
  for (const [section, name, value] of overrides) config = setTomlValue(config, section, name, value);
  config += '\n[auth.email.template.recovery]\nsubject = "Disposable UC Marketplace QA password recovery"\ncontent_path = "./supabase/templates/recovery.html"\n';
  return config;
}

const statusValue = (status, names) => {
  for (const name of names) {
    const value = status[name] ?? name.split(".").reduce((current, key) => current?.[key], status);
    if (typeof value === "string" && value) return value;
  }
  return null;
};

/** CLI output is secret-bearing. Validate in memory and never print it. */
export function qaEnvironmentFromLocalStatus(status, environment = {}) {
  if (!status || typeof status !== "object" || Array.isArray(status)) throw new Error("Local Supabase status must be structured JSON.");
  const env = {
    ...getQaAppEnvironment({ supabaseUrl: "http://127.0.0.1:54331", publishableKey: "", appBaseUrl: "http://127.0.0.1:3106" }, environment),
    QA_ALLOW_MUTATIONS: "1", QA_APP_BASE_URL: "http://127.0.0.1:3106",
    QA_SUPABASE_URL: statusValue(status, ["API_URL", "api.url"]),
    QA_DATABASE_URL: statusValue(status, ["DB_URL", "db.url", "database.url"]),
    QA_SUPABASE_PUBLISHABLE_KEY: statusValue(status, ["PUBLISHABLE_KEY", "api.publishable_key", "auth.publishable_key", "ANON_KEY", "api.anon_key"]),
    QA_SUPABASE_SERVICE_ROLE_KEY: statusValue(status, ["SECRET_KEY", "api.secret_key", "auth.secret_key", "SERVICE_ROLE_KEY", "api.service_role_key"]),
    QA_MAILPIT_URL: statusValue(status, ["MAILPIT_URL", "mailpit.url", "INBUCKET_URL", "inbucket.url"]) ?? `http://127.0.0.1:${LOCAL_QA_PORTS.mailpit}`,
    QA_EMAIL_CONFIRMATION_MODE: "code", EMAIL_CONFIRMATION_MODE: "code",
  };
  const config = validateQaEnvironment(env, { requireLocal: true, requireDatabase: true });
  if (new URL(config.supabaseUrl).port !== String(LOCAL_QA_PORTS.api)
    || new URL(config.databaseUrl).port !== String(LOCAL_QA_PORTS.database)
    || env.QA_MAILPIT_URL !== `http://127.0.0.1:${LOCAL_QA_PORTS.mailpit}`) {
    throw new Error("CLI status does not match the uniquely prepared local QA stack.");
  }
  // Never forward a linked-project ref or a user-supplied remote QA opt-in.
  delete env.QA_ALLOW_REMOTE;
  delete env.QA_ALLOWED_PROJECT_REF;
  return env;
}

export function assertLocalDockerEndpoint(endpoint) {
  if (typeof endpoint !== "string" || !/^(?:unix:\/\/\/[^\r\n]+|npipe:\/\/\/\/.\/pipe\/[A-Za-z0-9_.-]+)$/.test(endpoint)) {
    throw new Error("QA refuses a remote Docker daemon. Use a local Docker-compatible runtime.");
  }
}
