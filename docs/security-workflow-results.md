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

## Native Docker follow-up: 2026-10-13

Docker Desktop is now available. This follow-up started from published commit
`9623a3b0f9450ace97b5314a060c3e0b9a4f6aca`. The earlier unavailable-runtime
record above remains historical, not the status of this follow-up.

The native messaging gate originally completed its assertions but failed during
direct `storage.objects` cleanup, which native Storage now protects with a
statement-level trigger. The smoke test now selects its summary inside the
transaction and rolls back all fixtures. No deletion-protection flag, trigger
disable, RLS change or hosted migration was used. A new regression runs the
smoke twice with native-style deletion protection enabled and checks that fixture
counts, seeded categories and protection remain unchanged.

Both fresh disposable projects `ucmarketplace-qa-f1d6760890354e97` and
`ucmarketplace-qa-5c31e436cc01cd4c` passed all **36 native messaging assertions**
and then entered full acceptance. The second run's new sanitized diagnostics
identified a later provisioning failure: **SQLSTATE 42501 / HTTP 403**. Scoped
diagnosis on the same owned project confirmed the first admin fixture-state
update failed. Table SELECT/UPDATE grants and both API-key formats were valid;
the profile constraint calls a private course-validation function that does not
grant execution to `service_role`.

Trusted fixture state setup now uses a parameterized database transaction that
locks and verifies the recorded account's server-owned run marker before writing.
This changes only fixture preparation, not application permissions or ordinary
student/admin API tests. Child failure reports expose only allowlisted primitive
metadata; raw SQL, credentials, service responses and observed records remain
private. No passing acceptance summary was exported by the failed runs.

Final verification for these fixes:

- `npm.cmd run check`: TypeScript, ESLint and **246 tests** passed; 13 suites,
  zero failures, cancellations or skips. Includes the protected fixture-state
  function-ACL reproduction and ownership/rollback regressions.
- `npm.cmd run test:db`: **535 assertions across 18 migrations**, zero failures.
- `npm.cmd run qa:security:bundles`: **216 source modules / 48 browser chunks**
  passed. No application source or production permission migration was changed.
- Fresh native project `ucmarketplace-qa-846c7b8b9127d36d`: the production QA
  build, native messaging gate (**36 assertions**), account provisioning, direct
  API checks and real concurrency checks completed before the Realtime phase
  failed. Its failure report recorded `phase=realtime`, with successful cleanup.
- A scoped diagnostic on that same owned project provisioned all seven accounts
  successfully and confirmed `service_role` has neither private-schema usage
  nor execution permission for the course-validation function. Realtime then
  failed with the controlled label **competitor INSERT delivery timed out**:
  its initial positive-control delivery did not arrive within the bounded wait.
  A connected subscription alone was not accepted as delivery/denial evidence.
- Every project started/restarted by this follow-up was stopped by its exact
  owned project ID. Scoped fixture cleanup succeeded; backups and ignored
  scratch files remain available for diagnosis. `git diff --check` passed.

The original messaging cleanup failure and protected fixture-state failure are
fixed. Full local acceptance is **not passed**: live Realtime still fails, while
SMTP Auth and authenticated browser gates were not reached. No completed passing
summary was exported, and no hosted migration, deployment, commit or push was
performed in this follow-up. Realtime delivery requires separate diagnosis;
external email/deployed acceptance and the earlier release gates remain required.

## Realtime readiness fix: 2026-10-14

The previous control-message timeout was a subscribe/write timing race: the
test created its first message after WebSocket `SUBSCRIBED`, before the separate
PostgreSQL change listener acknowledged readiness. The QA observer now requires
both the join and `system` / `postgres_changes` / `ok` acknowledgement before
writing, including after reconnect. Backend errors fail closed without retaining
raw system payloads. Broadcast readiness is not treated as CDC readiness.
This follows [Supabase's documented timing-gap guidance](https://supabase.com/docs/guides/troubleshooting/realtime-postgres-changes-troubleshooting#step-6-writing-right-after-subscribed).

A native validation on the previously owned disposable project
`ucmarketplace-qa-846c7b8b9127d36d` passed **all four Realtime scenarios**:
two-way participant INSERT delivery, recipient read-state UPDATE delivery,
third-account denial bracketed by authorized positive controls, and reconnect
with authorized history catch-up followed by resumed delivery. Four PostgreSQL
readiness acknowledgements and zero backend errors were observed. Its seven
run-owned accounts/files were cleaned up and only that project was stopped.
No RLS, database grant, hosted publication or hosted data was changed.

The chat page had the same startup gap. It now uses a tested lifecycle helper
that tracks join and CDC readiness separately, queues a fresh authorized history
read if readiness arrives during an earlier fetch, and declares live connection
only after current history catch-up succeeds. Missing readiness becomes offline
after 15 seconds; bounded fallback reads preserve backoff until CDC recovers.
Unmount cancels timers and ignores late results/events. Existing message merge,
focus/read guards and ordinary account permissions remain intact.

`npm.cmd run check` passed TypeScript, ESLint and **262 regression tests**,
13 suites with zero failures, cancellations or skips. This includes eight QA
readiness regressions and eight chat lifecycle regressions, using actual helper
exports rather than source-text matching. A fresh full acceptance run is recorded
below when its scoped cleanup finishes; the four-scenario run alone does not
certify SMTP, authenticated browsers or deployed/external acceptance.

Final verification in this continuation:

- Fresh embedded SQL: **535 assertions / 18 migrations**, zero failures.
- Production QA build and bundle scan: **217 source modules / 48 browser chunks**
  passed, including the new client-side lifecycle helper.
- Fresh disposable project `ucmarketplace-qa-14334c34b3caea66` passed the native
  messaging gate (**36 assertions**) and progressed through provisioning, API,
  concurrency, Realtime and local SMTP to authenticated Chromium execution.
  Reaching the browser phase establishes completion of the earlier awaited gates;
  no complete passing full-run summary was emitted.
- The broader run hit its **20-minute acceptance timeout during the browser
  phase**. The authenticated browser suite did not produce a completed report;
  the earlier anonymous report was not presented as current authenticated evidence.
  Browser failures/timeouts require separate investigation. The native four-case
  Realtime pass and unit regressions are not substitutes for this unfinished gate.
- Timeout shutdown stopped only the exact owned project. A follow-up Docker
  check confirmed **zero running containers** for that project. Its backups and
  ignored scratch files, including any remaining run-owned fixture records,
  were retained for scoped diagnosis rather than broadly deleted.
- `git diff --check` passed. No hosted publication/migration, RLS/grant change,
  deployment, commit or push was performed.

The reported Realtime delivery timeout is fixed and its four native scenarios
pass. Full local/browser and deployed/external release acceptance remain
**not passed**; the new blocker is the broader authenticated browser timeout.
