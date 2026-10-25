import { createRequire } from "node:module";
import { validateDeploymentEnvironment, assertDeploymentEnabled } from "../../src/lib/deployment-environment.ts";

try {
  if (process.argv.length !== 2) throw new Error();
  // This is a build/start preflight, not a development-server check. Match
  // `next build` even when invoked from a development or test shell; otherwise
  // .env.development/.env.test can conceal invalid production-build settings.
  process.env.NODE_ENV = "production";
  const require = createRequire(import.meta.url);
  require("@next/env").loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const result = validateDeploymentEnvironment(process.env);
  if (!process.env.AUTH_RECOVERY_SECRET) throw new Error("Configure a persistent AUTH_RECOVERY_SECRET before testing password recovery.");
  assertDeploymentEnabled(result.mode);
  console.log(`Application environment check passed (${result.mode}); no values or secret fingerprints printed.`);
} catch (error) {
  console.error(error instanceof Error && /^(?:APP_ENV|Hosted|Preview|Privileged|Unreviewed|EMAIL_CONFIRMATION_MODE|AUTH_RECOVERY_SECRET|Supabase|Application URL|Local development|Staging and production|Vercel project|Only a non-placeholder|Production deployment|Configure a persistent)/.test(error.message)
    ? error.message : "Application environment check failed; private configuration withheld.");
  process.exitCode = 1;
}
