# Step 15: security and workflow acceptance

Step 15 adds repeatable tests and closes the bugs those tests uncover. A passing
unit or embedded SQL run is not proof that hosted Auth, Storage, SMTP, Realtime,
or simultaneous PostgreSQL transactions work. Do not mark the marketplace
release-ready until the separate acceptance gates below have actually passed.

## Safe default checks

Use Node.js 22.15 or newer and install the locked dependencies with `npm.cmd ci`.
From the repository root:

```powershell
npm.cmd run check
npm.cmd run test:db
npm.cmd run audit:production
npm.cmd run build
npm.cmd run qa:security:bundles
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

`check` runs TypeScript, ESLint and the Node tests. The security regressions call
the real authorization exports with isolated session dependencies; they do not
add test authentication bypasses to the application. Source checks follow client
imports into server-only modules and flag privileged browser configuration,
embedded privileged keys, mock production datasets and debug logging.

`test:db` creates a fresh in-memory PGlite database, bootstraps Supabase's SQL
roles/auth/storage interfaces, applies every normal migration in filename order,
and executes the catalog, RLS, Storage-lifecycle and end-to-end SQL checks. It
accepts no connection URL or credentials. It fails on migration errors, failed
assertions and empty check results. Use `npm.cmd run test:db -- --list` to list
the default scripts, or pass specific allowlisted SQL basenames. This tests real
PostgreSQL authorization logic but emulates service-owned schemas; it does not
exercise Supabase's HTTP services, email delivery, or concurrent connections.

Inventory/preflight SQL without boolean assertions is not counted as passing
tests. `messaging_security.sql` additionally requires the staged Realtime
publication; run that check on the actual isolated stack after enabling it,
not against a mocked embedded publication.

`test:e2e` runs Chromium against the production build on port 3100. It owns its
server and refuses to reuse an existing one. It checks protected direct routes,
private document responses, malformed session handling, recovery/return-path
boundaries, security headers, keyboard use and login layout at widths 375, 390,
430, 1280, 1440 and 1920. It does not log in or write marketplace records.

The GitHub workflow runs these same baseline checks on pull requests and pushes
to `main`, using inert public configuration and no repository secrets. A manual
`workflow_dispatch` with **full_stack** enabled additionally starts a uniquely
owned local Supabase stack on the GitHub runner and runs authenticated acceptance.
Neither job deploys or applies hosted migrations. Repository permission stays
read-only and official actions are commit-pinned. The full-stack job is not an
automatic consequence of a pull request or push.

## One-command disposable local acceptance

With Docker installed and running, use:

```powershell
npm.cmd run qa:local
```

No hosted Supabase account or manually pasted service key is required. The
launcher refuses remote Docker contexts and occupied ports; it never stops an
existing app or development stack. It prepares a new random project beneath
ignored `.qa/stack-*`, copies the tracked migrations/templates, and uses API
54331, database 54332, Mailpit 54334 and app 3106. Password rules, confirmation,
eight-digit OTPs, 60-second OTP expiry and resend throttling remain enabled.
Only isolated test throughput limits are increased for fixture/UI sign-ins.

CLI credentials and process diagnostics stay private and bounded. The launcher
uses the installed native CLI binary, not an environment executable override.
Actual database-only messaging assertions must pass before the staged Realtime
publication is enabled on this **local disposable database only**. API, real
transaction races, Realtime, captured-email Auth flows and five authenticated
browser tests then run. OTP expiry testing deliberately waits 62 seconds.

On interruption, timeout or completion, the launcher stops only its own process
trees and uniquely named local project. It does not reset linked data, delete
other containers/volumes or purge a shared inbox. Local backups/scratch files
are retained for scoped diagnosis; fixture cleanup deletes only verified run-owned
accounts/records/objects and explicitly captured Mailpit message IDs.

A successful run saves allowlisted counts/statuses in its ignored
`acceptance-summary.json`. Browser metadata remains under
`node_modules/.cache/uc-qa-browser/report.json`. Neither contains credentials,
email bodies, student evidence or raw stack/locator diagnostics. Discovery with
`--list` is explicitly **not execution** and does not overwrite previous evidence;
a zero-test execution cannot pass. Local full-stack success does not approve
external SMTP delivery or the deployed release.

## Required password-recovery signing configuration

Before using password reset in development or deploying these changes, set
server-only `AUTH_RECOVERY_SECRET` to 32–64 cryptographically random bytes encoded
as 64–128 hexadecimal characters. Keep one persistent value in the hosting
secret manager, shared by every application instance. Never prefix it with
`NEXT_PUBLIC_`, reuse a Supabase/service/database credential, commit it, or print
it in test output. Missing or malformed configuration fails recovery closed.

For a local application process, this PowerShell-compatible example generates
32 random bytes without displaying or writing the value:

```powershell
$appRecoveryBytes = New-Object byte[] 32
$appRecoveryGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $appRecoveryGenerator.GetBytes($appRecoveryBytes) }
finally { $appRecoveryGenerator.Dispose() }
$env:AUTH_RECOVERY_SECRET = [System.BitConverter]::ToString($appRecoveryBytes).Replace("-", "").ToLowerInvariant()
npm.cmd run dev
```

Configure the deployed value through the hosting provider's secure environment
interface; do not regenerate it on each request or restart. Rotation invalidates
existing recovery grants, so students must request a new email. Local QA instead
generates a fresh in-memory value for its owned build/server and removes it from
Playwright workers. Its dotenv preflight also refuses this secret in application
dotenv files, ensuring that the disposable run cannot inherit deployment secrets.

The application signs a fifteen-minute, user-and-session-bound HttpOnly recovery
grant only after a successful typed recovery-token exchange and live Auth identity
checks. Supabase's direct OTP verification records an OTP authentication method,
including for recovery tokens; OTP claims alone therefore cannot prove recovery.
The delivered recovery callback supplies that provenance before a grant is issued.
PKCE exchanges retain the stricter recovery-method check. Plain/forged markers,
signup OTP sessions, unrelated password sessions and replayed links do not create
a grant. See [the upstream Auth verification implementation](https://github.com/supabase/auth/blob/master/internal/api/verify.go).

## Isolated full-stack QA

Use a **disposable** local Supabase stack with Docker running. Do not use the
linked UC Marketplace project, real student accounts, or existing production
Storage. From the repository root, `npx.cmd supabase start` starts the configured
local services. For an existing local instance, inspect its migration history and
apply pending migrations with `npx.cmd supabase migration up --local`. Never use
`db reset --linked`. A local reset also deletes local data; it is not necessary
for the fixture runner and should not be done on a shared local instance.

Retrieve the local project's API URL, publishable/anon key, service-role key and
database URL from `npx.cmd supabase status`. Keep the privileged values in your
local process environment only; do not paste them into chat, Git, `.env.local`,
screenshots or command transcripts. Then set the explicit QA variables:

```powershell
$env:QA_ALLOW_MUTATIONS = "1"
$env:QA_SUPABASE_URL = "http://127.0.0.1:54321"
$env:QA_SUPABASE_PUBLISHABLE_KEY = Read-Host "Local publishable or anon key"
$qaServiceInput = Read-Host "Local service-role key" -AsSecureString
$env:QA_SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new("", $qaServiceInput).Password
$qaDatabaseInput = Read-Host "Local PostgreSQL connection URL on port 54322" -AsSecureString
$env:QA_DATABASE_URL = [System.Net.NetworkCredential]::new("", $qaDatabaseInput).Password
$env:QA_APP_BASE_URL = "http://127.0.0.1:3106"
$env:QA_MAILPIT_URL = "http://127.0.0.1:54324"
$env:QA_EMAIL_CONFIRMATION_MODE = "code"
npm.cmd run test:qa
```

The runner never substitutes `.env.local` or the linked project for missing QA
configuration. Full browser QA requires loopback Supabase and a dedicated
loopback app origin with an explicit free port. The runner builds and starts its
own production app with the QA public URL/key, without Supabase service-role keys
or database credentials in the app/server/browser environment. A fresh recovery
signing secret is supplied only to the Next build/server, never browser workers.
Google Fonts must be reachable during the existing production build.

The manual stack must match the email acceptance configuration before running:
use the QA app origin as Auth's `site_url`, allow its exact `/auth/confirm` and
`/auth/recovery` redirects, enable confirmations, set OTP length to eight and
expiry to 60 seconds, and use a signup template containing `{{ .Token }}`.
The recovery template must deliver
`{{ .SiteURL }}/auth/recovery?token_hash={{ .TokenHash }}&type=recovery`.
Provide enough isolated email/sign-in rate capacity for signup, resend and two
recovery requests; keep the 60-second resend limit and strong password rules.
The tracked development config alone does not set every QA override. Prefer
`qa:local`, which prepares all of these settings in a separate scratch project.

The runner also checks production dotenv assignment names before starting the
app: `.env`, `.env.local`, `.env.production` and `.env.production.local` must not
declare service-role/secret keys or database credentials. A private variable
cannot be made safe merely by removing it from the parent process environment,
because Next.js loads dotenv files again. Diagnostics list names only, never
their values. The QA app origin and `NODE_ENV=production` are set explicitly.

Seven core ephemeral accounts are created: admin, seller, buyer, suspended,
pending, rejected and competing buyer. Full local mode also creates an eighth
account through ordinary unconfirmed signup for real captured-email acceptance.
Trusted fixture setup tags its cleanup ownership without confirming the email.
Signup metadata attempts to forge administrator
authority; the registration trigger must still produce an active, unverified
student. Only the trusted fixture setup establishes test roles. Pending and
rejected accounts use real private uploads, submission and administrator review
RPCs. Normal user sessions perform the tested mutations; service-role calls are
limited to fixture setup and trusted inspection/cleanup.

The run executes direct HTTP Auth/Data API/Storage attacks and positive flows,
then real PostgreSQL races, Realtime and (full local mode) SMTP/Auth acceptance,
then authenticated browser workflows. Browser
coverage includes verification rejection/resubmission/approval, create/edit and
search listings, private favorites/messages/reports, reservation and meetup
scheduling, atomic sale completion, notifications, persistent profiles/avatars,
password changes, suspension/reactivation, refresh/back/logout and responsive
authenticated screens. There are no mocked Auth responses or test-only app
routes. A generic network/API error cannot count as a permission denial: the
negative checks require the expected SQLSTATE/HTTP denial or a successful empty
RLS result and, where applicable, unchanged trusted state.

Actual race tests hold the parent listing lock, observe other sessions blocked
in `pg_stat_activity`, then release or publish before commit. They must prove
that a stale draft image insert cannot append after publication, two competing
acceptances produce one winner, stale losers fail, and repeated sale completion
leaves listing/reservation/meetup state consistent without duplicate
recipient/event notification keys. A sequential Promise or emulator run is not
substitute evidence.

For live message delivery, enable the optional SQL in
`supabase/staged/20260927010000_enable_messaging_realtime.sql` **on the disposable
local database only**, after the database-only messaging checks have passed.
This staged file is deliberately not part of normal hosted migrations. Verify
two-account delivery as well as reconnect catch-up; refreshing the page alone
does not establish that Realtime works.

### Realtime, email and network acceptance

The four Realtime scenarios use real normal-student JWT subscribers: delivery
in both directions, recipient read-state updates, no third-party target events,
and disconnect/reconnect catch-up. The privacy window is bracketed by positive
events on the competitor's own control conversation and checked for healthy
subscriptions, so an unavailable socket cannot silently pass as privacy. Catch-up
uses an authorized persisted-message read and verifies exactly one copy, followed
by resumed socket delivery; this is not a claim of WebSocket replay support.

Code-mode SMTP acceptance performs twelve checks using messages actually
delivered to the local capture server: normal unconfirmed signup, denied pending
login, OTP expiry, resend, confirmation, single-use confirmation, password login,
typed recovery exchange, recovery replay denial, password update and old/new
password results. Link mode has ten checks and does not certify code expiry.
No service-generated confirmation link or email-confirmation bypass is used.
Mailpit reads and deletion are restricted to the exact run-owned recipient and
captured IDs; a generic network failure cannot count as an Auth denial.

Five authenticated browser tests cover access boundaries, marketplace workflows,
network/keyboard behavior and application password recovery. Real mutation
requests are held and forwarded to test loading controls and duplicate-submit
prevention. Browser offline mode checks favorite rollback, message draft retention
and successful retries against trusted persisted state. Reporting/reservation
dialogs are checked at all six widths for bounds, focus containment, dismissal
and restored focus. Recovery uses an actual captured email, tests the signed cookie
and single-use replay in a separate browser, and changes the password through the
real reset form. Discovering these tests does not establish that they have passed.

### Separate remote API-only QA

An explicitly approved, separate disposable hosted project may use
`npm.cmd run test:qa:api`. It still runs real Auth/API/Storage, concurrency and Realtime,
but not browsers or email acceptance. Set `QA_ALLOW_REMOTE=1` and
`QA_ALLOWED_PROJECT_REF` to its exact project ref in addition to the other QA
variables. The HTTPS API origin must match that ref and cannot match the repo's
linked ref. Its PostgreSQL URL must use that dedicated database host or the
matching `postgres.<ref>` pooler login and `sslmode=require`. Prefer a direct
or session-mode connection for transaction/lock tests. Never disable certificate
verification. Apply the normal migrations to that disposable project first.
Run the database-only messaging assertions and explicitly enable the staged
publication on that separate QA project before invoking this runner. Realtime
preflight is read-only and fails if publication/authorization is missing; it
never applies SQL to a remote project automatically.
Full remote browser runs are intentionally refused before provisioning.

### Cleanup and diagnostics

Only IDs created in the current invocation are eligible for cleanup. The runner
rechecks Auth's server-owned `qa_run_id` through the API and locks/rechecks the
same SQL Auth identities before deleting run-owned records. Storage bytes are
removed through Storage's API, not by deleting `storage.objects`. Unknown
buckets, non-owned paths, mismatched project identities and unrelated moderation
history fail closed. A provisioning/profile-trigger or cleanup failure can leave
run-owned fixtures; inspect those exact tagged accounts manually. Do not use a
global delete, wildcard bucket purge or production reset to recover.

Browser contexts are separate and discarded. Traces, screenshots, videos and
persisted session state are disabled. The authenticated reporter saves only
sanitized static test metadata/status/timing and failing step indexes, never raw
locator errors, worker output, tokens, passwords or private evidence. Its minimal
summary lives under ignored `node_modules/.cache/uc-qa-browser/`. Do not enable
ordinary traces/reporters with real accounts to diagnose a failure. Stop after a
failed gate and investigate in the disposable environment.

## Authorization contracts

UI redirects are convenience boundaries. The database policies, least-privilege
column grants and authenticated RPCs must independently enforce these contracts.

| Resource | Student boundary | Administrative boundary |
| --- | --- | --- |
| Private profiles | Own row only; no self-promotion or status edits; reviewed identity locked | Active admin moderation through reasoned RPCs |
| Safe seller profile | Verified active marketplace viewer; allowlisted projection only | Safe moderation reads, not extra private seller fields |
| Listings/images | Verified active seller, owned draft inserts; published edits/status via validated RPCs | Review/remove inappropriate listings, no ownership transfer |
| Favorites | Verified active student, own rows only; deterministic favorite RPC | No implicit access to another student's favorites |
| Conversations/messages | Verified active participants only; no forged sender or third-party access | No implicit private-chat access merely for being admin |
| Reservations/meetups | Verified active buyer/seller participants; allowed state and stale-version checks | No implicit private meetup access merely for being admin |
| Notifications | Authenticated recipient only, including restricted accounts; system-created events | Own recipient rows only; cannot forge events |
| Reports | Eligible student's own submissions; target must be valid; duplicates controlled | Active admin resolves/dismisses with server-owned review metadata |
| Student ID Storage | Private owned evidence; submitted/reviewed bytes immutable and undeletable | Active admin evidence route, no public bucket or cross-student download |
| Avatars | Public photos, immutable owned uploads, owned-link validation | Never reuse student ID Storage or expose private identity data |

Existing sessions must lose marketplace access immediately after suspension;
reactivation restores only the student's legitimate role/verification rights.
Registration intentionally starts `unverified`; it becomes `pending` only after
actual school-ID submission, not merely email confirmation.

## Remaining acceptance gates before release

Record date, commit, exact isolated project/stack, account roles, commands,
results and sanitized failure evidence. Do not record credentials or documents.

- Run `qa:local` (or a correctly configured `test:qa`) on real local Supabase and
  retain its sanitized results. Exercise
  Storage HTTP bytes and the actual concurrent transactions, not just SQL rows.
- In the intended email configuration, register, confirm, resend, expire/replay
  confirmation, and recover a password. Test bad credentials, duplicates, OTP
  expiry and resend limits. Local mail capture proves the local flow only;
  ordinary student-inbox delivery needs the deployed SMTP configuration.
  The disposable launcher configures its own local origins/templates. For manual
  email/link tests, align the stack configuration with the QA app port first;
  the tracked development config uses port 3000, while QA defaults to 3106.
- Test expired/revoked real sessions, refresh and recovery markers, password
  reauthentication/aged-session nonce, and signed private-image URL expiry.
- Verify staged Realtime delivery between participants and denial for a third
  account, plus offline/reconnect/slow-response behavior and duplicate-submit
  recovery. Do not call a reload-based delivery check Realtime acceptance.
- Review each authenticated screen at all six widths, keyboard focus/labels,
  native select/dialog use, loading/empty/error states and no horizontal scroll.
  Anonymous login layout alone does not certify the authenticated app.
- Reconcile the intended hosted migration history, run applicable preflights,
  deploy forward migrations only with authorization, regenerate database types,
  and rerun user-scoped acceptance after deployment. A CLI dry run only previews
  migrations; it neither applies SQL nor validates data.

The hosted Auth settings must separately match the app's 12-character
upper/lower/digit/symbol password policy. Migrations and `config.toml` changes do
not update hosted Auth or SMTP. See [the Supabase setup guide](../supabase/README.md)
for existing email-mode limitations and deployment steps.

## Changes driven by Step 15

- Forward migration `20261006010000_harden_storage_lifecycle.sql` serializes
  verification evidence links/deletion and listing publication/image cleanup.
  Direct image metadata inserts lock and recheck the owned draft; the invoker
  gate preserves the trusted published-listing edit RPC.
- Protected routes consistently send private/no-store, no-referrer, anti-frame,
  content-type protection and no-index headers. Private listing images remain
  restricted to the configured Supabase origin. Local QA uses unoptimized
  images; the production optimizer's local-IP guard is not relaxed.
- School-ID upload is keyboard focusable with visible focus feedback. Listing
  reporting preserves fields on failures and prevents closing/repeated submit
  during an active request.
- Next.js and its matching ESLint configuration are pinned to 16.3.8; the
  production dependency audit is a release check. Development-only advisory
  exceptions must be recorded separately, never described as a clean full audit.
- Structurally unusable Supabase session cookies are removed before SDK
  initialization and expired at their exact configured cookie names. Valid
  refreshable expired credentials are preserved for Auth verification; parsed
  cookie identity is never used for authorization.
- Recovery grants are signed and bound to live user/session identities rather
  than trusting a plaintext marker or treating every OTP session as recovery.
- Both reporting dialogs remain vertically scrollable within small/mobile
  viewports; the QA suite exercises focus and real slow/offline mutations.
- The disposable local launcher owns its stack/processes, captures diagnostics
  privately, and exports passing evidence only after scoped cleanup succeeds.

See [the dated execution record](security-workflow-results.md) for what actually
ran in this workspace and what remains unverified.
