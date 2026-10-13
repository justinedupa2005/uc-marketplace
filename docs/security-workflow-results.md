# Step 15 execution record

Initial record: 2026-10-08; continuation results for 2026-10-12–13 are below.
Workspace: local Windows/Node.js 22, working tree based on
`ab8f9240cf3840ac7fb2afe91e8433c51b73c79c`. At the time of this initial record,
these Step 15 changes had not been committed, pushed or deployed. No hosted
migrations or QA fixture writes were performed.

## Completed local checks

- Final `npm.cmd run check`: TypeScript and ESLint passed; 147 unit/regression
  tests passed, zero failures or skips. Includes Auth boundaries, QA environment/
  cleanup guards, cookie initialization and credential-safe reporting.
- Fresh embedded database: 18 normal migrations, 535 individual catalog/RLS/
  workflow assertions, zero failures. The optional Realtime staged file is not
  counted as a normal migration.
- Production Next.js 16.3.8 build passed. Network access was required for the
  existing Google Fonts downloads.
- Source/browser-bundle security hygiene: 215 production modules and 48 browser
  chunks passed the static boundary/privileged-key checks.
- Anonymous Chromium suite: final 37/37 tests passed, zero runner errors and
  zero unexpected unhandled-runtime signals. The initial malformed-cookie SDK
  initialization issue was fixed, covered by seven cookie regressions and the
  final production-browser rerun. Sanitized evidence is stored in ignored
  `node_modules/.cache/uc-qa-browser/report.json`.
- QA configuration refusal was exercised without mutation opt-in: the runner
  exited before connecting or provisioning. The local dotenv name preflight
  passed without printing credential values.
- GitHub workflow YAML parsed successfully; all referenced npm commands exist.
- `git diff --check` passed (only normal Windows line-ending conversion warnings).

This is an execution log, not a release approval.

## Explicitly not executed

Docker/local Supabase was unavailable here, and no separate disposable hosted
project credentials were provided. Therefore real Auth/API/Storage fixture tests,
simultaneous PostgreSQL races, authenticated browser workflows, Realtime service
acceptance, email delivery and aged-session reauthentication are **not passed**.
Their reproducible harness and release checklist are implemented in
[the QA guide](security-workflow-testing.md). The new GitHub workflow has not run
on GitHub yet.

## Dependency findings

The final recheck found and patched two additional production advisories in
[`sharp`](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) and
[`source-map-js`](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) using
compatible lockfile updates to 0.35.5 and 1.2.2 respectively. The production
audit passed after patching with zero reported vulnerabilities. Matching Next.js
and ESLint packages are pinned to 16.3.8. The full audit still reports five high
**development-tool** findings from the unpatched
[`braces`](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) chain through
`micromatch`/`fast-glob`/the Next ESLint plugin. No forced
downgrade to an incompatible Next ESLint version was applied. Recheck the audit
when upstream patches become available; this is not a claim that all dependencies
are vulnerability-free.

## Continuation: 2026-10-12–13

The validation run used the same base commit. These checks ran before repository
publication; no deployment, hosted migration or hosted QA mutation was performed.
Publishing this implementation does not mark the unrun acceptance gates passed.

Implemented in this continuation:

- `npm.cmd run qa:local` prepares a uniquely owned, disposable local Supabase
  stack with separate ports and real Auth/SMTP/Storage/Realtime services. It
  refuses remote Docker contexts, linked configuration and occupied ports.
- The integration runner now includes four real-service Realtime scenarios,
  twelve code-mode captured-email Auth checks and five authenticated browser
  tests, including slow/offline mutations, keyboard/mobile dialogs and real
  password-recovery callbacks. These are implemented gates, not executed passes.
- Password recovery now uses a signed, fifteen-minute, user/session-bound grant.
  Typed recovery OTP callbacks work with actual Auth OTP claims without trusting
  ordinary signup/password sessions or unsigned recovery cookies. Production
  requires a persistent server-only `AUTH_RECOVERY_SECRET`; see
  [the setup instructions](security-workflow-testing.md#required-password-recovery-signing-configuration).
- Process output is captured privately with byte/time limits. Unexpected server
  exits and runtime errors fail the runner even without an explicit process wait.
  Interrupts cancel bounded requests, and cleanup targets only owned processes,
  fixtures and captured message IDs. Passing summaries are emitted/saved only
  after fixture/process/project cleanup succeeds; failed, unsupported or
  release-promoting summary metadata is rejected.
- Normal SMTP signup records its returned identity before later assertions so
  tagging/configuration failures cannot silently lose cleanup bookkeeping.
  Browser recovery uses a separate SMTP fixture, while its forged-cookie test
  uses the unchanged buyer credential after the seller password-change workflow.

Verified locally:

- Final `npm.cmd run check` passed TypeScript, ESLint and **224 tests**, with
  13 suites, zero failures and zero skips. Mock orchestration tests exercise
  safety branches; they do not certify actual SMTP/Realtime delivery.
- Fresh embedded database checks passed **535 assertions across 18 migrations**
  on October 12. No SQL was changed afterward.
- Final production build passed, including the signed-recovery implementation
  and mobile dialog bounds. Source/bundle scanning passed **216 source modules
  and 48 browser chunks**, including recovery-secret browser boundaries.
- Final anonymous Chromium run passed **37/37**, with zero unhandled-runtime
  signals. Its ignored sanitized report was preserved during later test listing.
- Authenticated test listing discovered **five tests** successfully. Discovery
  did not execute them or overwrite the anonymous execution evidence.
- The production dependency audit reported **zero vulnerabilities** on October
  13. The full audit on October 12 still reported the five development-tool
  findings described above; no unsafe force-downgrade was applied.
- `git diff --check` and syntax checks for both QA launchers passed.

Not executed / still required:

`qa:local` failed safely at the Docker context/readiness stage because a local
Docker runtime is unavailable in this workspace. It did not create fixtures,
start services or fall back to the hosted project. Thus real Auth/API/Storage,
concurrent PostgreSQL races, live Realtime, captured SMTP and authenticated
browser acceptance remain **unrun**, not passed. Start local Docker and run
`npm.cmd run qa:local` before marking these gates complete. The manual full-stack
GitHub job is available but has not been dispatched from this workspace.

External student-inbox SMTP delivery, aged-session reauthentication, signed-URL
expiry and intended deployed-project acceptance remain separate release gates.
Step 15 is not fully accepted, and the MVP is not declared release-ready.
