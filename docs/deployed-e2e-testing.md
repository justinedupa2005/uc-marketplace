# Deployed marketplace end-to-end acceptance (Step 8)

Step 8 is a release gate, not a claim that a page load proves the transaction
works. The automated runner exercises only the registered, protected staging
application. Production remains disabled. Real inbox delivery, physical mobile
devices and screen-reader acceptance must be recorded separately before Step 8
can be signed off.

## Safe automated execution

Use `npm run staging:e2e` from an authorized operator environment. It reads the
exact deployed application's full Git SHA and Vercel deployment ID through
private JSON stdin, with only these keys: `sha` and `deploymentId`. Do not paste
credentials in shell arguments, chat, issue bodies or repository files.

The operator must supply `STAGING_PROJECT_REF`, `STAGING_ALLOW_MUTATIONS=1`,
`STAGING_MANAGEMENT_TOKEN`, `STAGING_PUBLISHABLE_KEY`,
`STAGING_SERVICE_ROLE_KEY` and `STAGING_DATABASE_URL` from a secure credential
store. These are operator-only inputs, never application/browser variables.
The existing Vercel CLI login is used privately for protected hosting checks.
The database must use the staging session connection (5432), with verified TLS
and the pinned provider CA. Do not use production keys, a production database,
or a transaction pooler.

After loading those variables privately, pipe only non-secret deployment
metadata in PowerShell (replace these placeholders with the actual deployed
application commit and deployment ID, not the current test-tool commit):

```powershell
@{ sha = "<40-character-deployed-sha>"; deploymentId = "dpl_<deployment-id>" } |
  ConvertTo-Json -Compress | npm.cmd run staging:e2e
```

Before mutation the runner checks project identity, independent key provenance,
closed signups, non-delivering staging SMTP and the canonical READY deployment's
exact source SHA. It refuses arbitrary origins and production targets. The
local Playwright configuration and its loopback-only guard are unchanged.

It creates seven short-lived identities: admin, seller, buyer, pending,
suspended, rejected and competitor. Seller/buyer/competitor are test activities,
not application roles: the only database roles remain `student` and `admin`.
Every temporary user carries this invocation's trusted `qa_run_id`; profile
bootstrap and cleanup recheck that marker against the same Auth/database.
Only generated placeholders and reserved `example.test` addresses are used.
Admin-confirmed fixtures are **not evidence of registration/email confirmation**.

An independently journaled, staging-only automation bypass is generated once,
passed only to the exact application origin and revoked in `finally`, including
after a rejected or ambiguous provider response. All Deployments authentication
stays enabled. Earlier bypasses are preserved. No token is written to a journal.
Do not run multiple mutation suites at once or force-kill the operator; allow
its interrupt handler to finish cleanup.

## Automated coverage

- Real direct API/Storage authorization matrix: denied profile escalation,
  private messages/evidence/meetups, own-verification approval, cross-owner
  edits, unauthorized reservations, suspended/pending activity, and moderation.
  Expected denials must be specific permission/conflict results or successful
  empty reads; network outages are failures, not successful security checks.
- Real PostgreSQL concurrency with a lock barrier: overlapping competing buyer
  acceptance must produce one winner, one rejected request and a reserved
  listing. Repeated sale completion and stale image-publication races are also
  checked. Realtime privacy uses healthy positive controls around denial windows.
- Protected hosted browser sessions for all seven identities; exact staging
  Auth cookies and current server/database authorization are checked.
- Verification: missing-image controls, invalid type, private 5 MiB upload,
  admin rejection, fresh resubmission, approval and newly granted access.
- Selling: category loading, required errors, five images including a 5 MiB
  image, persistence, My Listings, description edit and image removal.
- Buying: description search, category/condition/price filters, sort and refresh,
  favorites add/remove, persisted messages and live seller reply.
- Full UI transaction: publish → discover → message → request → accept →
  reserved → campus meetup → seller completes → sold/completed listing,
  reservation and meetup, backed by actual database reads.
- Hosted security: cross-account conversation/reservation/listing denial,
  private document denial, admin route denial, active-session suspension and
  reactivation of only a run-owned student.
- Sessions: refresh, shared-cookie tabs, independent concurrent browser sessions,
  logout and subsequent denial, a real login with expired cookie/invalid refresh
  state, and invalid recovery/confirmation callbacks. This does not substitute
  for real expired/reused emailed recovery tokens or successful password reset.
- Desktop and touch-emulated Chromium: marketplace, listing, selling, messages,
  favorites, reservations, profile and admin pages. Layout checks cover
  375/390/430/640-pixel widths and a 200%-equivalent CSS reflow viewport.
- axe-core WCAG A/AA scans include contrast and semantic checks; serious/critical
  findings fail automation. Other violations, incomplete checks and small touch
  targets remain recorded review findings. Keyboard reservation dialog opening,
  Escape dismissal and focus restoration are asserted. Automated scans do not
  certify full accessibility conformance.

## Evidence and cleanup

Sanitized reports are saved in ignored `.qa/staging-e2e-<run-id>.json`. They
identify the deployed application SHA/ID, runner SHA and dirty-worktree flag,
phase results, check counts, zero-error requirements, accessibility rule IDs /
impact / node counts, pending manual gates and cleanup state. No passwords,
emails, tokens, page HTML, selectors containing identity details, screenshots,
videos, traces or raw provider errors are retained in the report.

`automated_passed_manual_pending` means only the automated checks passed, never
that Step 8 or production launch is approved. Missing phases, interrupted runs,
failed account/file cleanup, failed bypass revocation, runtime errors or critical
accessibility findings cannot produce a passing automated result. Preserve failed
reports as well as the final successful one; do not relabel old source evidence.

Cleanup removes only this invocation's marked synthetic Auth users, related
records and Storage files. Existing five shared staging accounts, real students
and production data are not reset, adopted or deleted. If cleanup fails, inspect
the run ID and note-only bypass journal privately and recover only those exact
targets. Never reset a project or bulk-delete users to repair a test run.

## Manual sign-off checklist

Record date, tester, device/OS/browser, deployed SHA/ID, scenario, result and an
issue reference. Store consenting tester identities and inbox evidence privately.
Use synthetic product data and no real school-ID photograph in test artifacts.

| Gate | Required evidence | Current status |
| --- | --- | --- |
| Hosted registration | Consenting personal inbox; confirm once; reused/expired link denied; pending access only | Deferred with SMTP |
| Hosted recovery | Known/unknown address same UI; reset delivered; password updates; old password and reused/expired links denied | Deferred with SMTP |
| Android device | Real Chrome: navigation, upload picker, chat, filters, reservation, validation, landscape/portrait and zoom | Not run |
| iOS device | Real Safari: same scenarios; keyboard does not hide chat/form controls | Not run |
| Screen reader | NVDA or VoiceOver labels, headings, landmarks, live chat/feedback, dialog focus and error announcements | Not run |
| Manual visual review | Focus visibility, keyboard-only completion, contrast over images, touch targets and text zoom at 200% | Not run |

Keep staging email settings unchanged until the owner resumes SMTP work. Do not
disable confirmation or open signup as a workaround. Once delivery is authorized
and configured, use consenting addresses, bounded sends and exact staging
callbacks. Physical-device and screen-reader checks require a human tester;
browser emulation must not be signed off as those checks.

References: [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing),
[axe-core](https://github.com/dequelabs/axe-core),
[protected staging deployment](staging-deployment.md).

## Execution record — 2026-10-26

Baseline deployed application: `7f170f60c27314914fc0ccab2926d368a6aab454`,
Vercel deployment `dpl_BxNC9jZ5Ngo2KDgpkm2UWVEqAvBc`. Run
`7ec9e40b-4f3f-4d7e-ae2d-74596d76bd34` completed **322** browser assertions,
**253** direct API/Storage checks, **3** real PostgreSQL concurrency scenarios,
and **4** Realtime scenarios. Every functional, transaction, authorization and
session phase passed with zero browser/hydration/server/cross-environment errors.
Overall acceptance correctly **failed** accessibility: 7 of 16 scans found
low-contrast small text. The 33 reported node occurrences include repeated
desktop/touch/reflow views, not 33 distinct application defects. Three small-touch
target occurrences and axe incomplete results remain explicit manual review items.

A private color-only diagnostic traced every confirmed violation to `#747685`:
contrast was 4.26–4.49:1 on the actual white/light backgrounds, below the required
4.5:1 for this small text. The fix uses the existing darker `#5b6070` theme color
in the nine affected marketplace/chat/reservation components. Regression tests
reproduce the old failure and verify the replacement on all reviewed light
surfaces. No rule is disabled or excluded, and layout/authorization is unchanged.

Local verification of the fix passed TypeScript, ESLint and **455** regression
tests. All **20** migrations / **535** embedded security assertions passed;
dependency review found zero vulnerabilities, and source/browser-bundle and
secret-pattern checks passed. At that initial checkpoint the new staging
deployment and live retest were pending; the baseline remains a failed run.

All temporary accounts, related records and files were removed using run-owned
cleanup, and all test bypasses were revoked. The five shared staging identities,
production and SMTP settings were not changed. Failed attempts remain available
in ignored private evidence; they are not overwritten by subsequent passes.

### Passing exact-source retest

PR [#8](https://github.com/justinedupa2005/uc-marketplace/pull/8) merged normally
through protected CI. Application and test-runner source
**`b277d3e114d995613841f490f4dda971ed7762d9`** passed exact staging push
[CI 40338693597](https://github.com/justinedupa2005/uc-marketplace/actions/runs/40338693597).
That check included the lockfile install, TypeScript, ESLint, **455** regression
tests, production build, dependency/secret/bundle security and migration checks.
The pre-deployment read-only staging audit found **20** migrations applied,
zero pending versions, no schema/grant drift and **129** passing native security
assertions. No database migration or reset was needed or performed.

The explicit staging-only deployment **`dpl_2hd2egyuPvJucmntUqjESjP8Wf5j`** is
READY and canonical at <https://uc-online-shop-staging.vercel.app> (Vercel sign-in
required). Its protected immutable URL is
<https://uc-online-shop-staging-6bkf2hbxk-justinedupa2005s-projects.vercel.app>.
The Next.js 16.4.3 build compiled successfully; the private build review found
zero failure markers. All Deployments authentication and disabled automatic Git
deployments remain in place. No local operator credentials were uploaded.

Run **`9ac86d2d-7ba8-48bb-bd50-cc10a51f342d`** completed at
**2026-10-26 22:39:11 PHT** with status **`automated_passed_manual_pending`**.
The runner and deployed source matched exactly, and the runner worktree was
clean. Every automated phase passed:

| Evidence | Result |
| --- | --- |
| Hosted browser assertions | 326 passed |
| Direct API/Storage authorization checks | 253 passed |
| Real PostgreSQL barrier races | All 3 passed |
| Realtime privacy/delivery scenarios | All 4 passed |
| Desktop, touch-emulated and reflow accessibility scans | 16 scans; zero confirmed violations |
| Browser / hydration / server / cross-environment failures | 0 / 0 / 0 / 0 |
| Run-owned accounts, records and files | All 7 accounts and related temporary data removed |
| Temporary hosting access bypass | Revoked; final staging/production bypass inventories both empty |

The browser run covered verification rejection/resubmission/approval, direct
self-approval denial, five-image publication and editing, search/filter/sort,
favorites, two-way messages and the complete reservation/meetup/sale workflow.
It also checked cross-account denials, active-session suspension, independent
and shared-tab sessions, logout denial and invalid authentication callbacks.
A separate read-only color probe found no contrast violations on the existing
shared marketplace, conversation and accepted-reservation pages.

Post-test verification confirmed the five shared synthetic accounts and their
existing data were unchanged: 5 listings, 1 conversation, 2 messages, 2 favorites,
1 reservation, 1 meetup and 4 verification records, with zero public tables
missing RLS. Production remains protected, unconnected to Git, undeployed and
release-disabled. No SMTP settings were changed and no emails were sent.
A bounded private runtime review examined 50 entries and found zero errors or
server failures; no raw logs were published.

The manual checklist above is still pending. Incomplete axe color/ARIA checks
and **3** small-touch-target review occurrences are not silently marked passed.
Real inbox registration/recovery, physical Android/iOS, screen-reader use and
manual visual/keyboard/zoom acceptance still require authorized human testing.
This is a passing automated staging result, **not complete Step 8 or production
release approval**. This evidence-only follow-up does not redeploy the app.
