import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// Explicit isolated QA already supplies its public/fixture environment. Loading
// the developer's dotenv here would reintroduce its private recovery secret
// after the launcher deliberately removed it from browser workers.
if (!process.env.QA_APP_BASE_URL) loadEnvConfig(process.cwd());

const baseURL = process.env.QA_APP_BASE_URL ?? "http://127.0.0.1:3100";
const target = new URL(baseURL);

// Authenticated suites intentionally cannot target a deployed marketplace.
// Start a separately configured local application against an isolated QA DB.
if (!["http:", "https:"].includes(target.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
  throw new Error("QA_APP_BASE_URL must be a dedicated loopback application.");
}
if (target.username || target.password || target.search || target.hash || target.pathname !== "/") {
  throw new Error("QA_APP_BASE_URL must be an origin, without credentials or a path.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./node_modules/.cache/uc-qa-browser/results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  // End within the integration child's deadline, leaving time for its scoped
  // cleanup. Incomplete/aborted execution remains a failing reporter result.
  globalTimeout: 720_000,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  // Apply before fixture validation too: even a failed direct QA invocation
  // must not fall back to reporters that retain password-bearing call logs.
  reporter: [
    ["./tests/e2e/safe-reporter.ts", { outputFile: "./node_modules/.cache/uc-qa-browser/report.json" }],
  ],
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    // Traces and screenshots can contain credentials, school IDs, and tokens.
    // QA also uses a restricted reporter: ordinary error/call logs can reveal
    // locator.fill passwords even with these capture options disabled.
    trace: "off",
    screenshot: "off",
    video: "off",
    serviceWorkers: "block",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "anonymous-chromium", testMatch: "anonymous.spec.ts" },
    { name: "qa-chromium", testMatch: ["authenticated.spec.ts", "recovery.spec.ts"], timeout: 300_000 },
  ],
  // QA integration starts its own explicitly configured application. Baseline
  // checks otherwise run the existing production build, not a development mock.
  webServer: process.env.QA_APP_BASE_URL ? undefined : {
    command: "node node_modules/next/dist/bin/next start -p 3100 -H 127.0.0.1",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
