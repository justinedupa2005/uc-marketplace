# Step 4: database deployment and security verification

Use the registered staging project `niocptgzzbozpbfzifdk`. The repository's
existing linked project `fezeqoqdrmicvxpbgnaf` remains protected. These commands
never run `supabase link`, infer a database from dotenv, repair migration history,
or reset a hosted database. Do not use the older linked-project instructions
elsewhere in the historical database README for this staging release gate.

## Repeatable gates

Load the staging-only Management API token privately into the operator process,
then set `STAGING_PROJECT_REF=niocptgzzbozpbfzifdk` and
`STAGING_ALLOW_MUTATIONS=1`. The explicit opt-in confirms operator configuration;
the plan/audit/type-check commands themselves do not modify hosted data.

```powershell
npm.cmd run staging:plan
npm.cmd run staging:audit
npm.cmd run db:types:check
```

`staging:plan` compares all ordered versions and stored checksums. `staging:audit`
also replays **only the applied versions** into a new in-memory PostgreSQL
database, then compares actual staging definitions against that independent
migration-derived baseline. Agreement between migration version rows alone is
not accepted as evidence of schema correctness.

The contract covers app tables/views, columns/defaults/collations, constraints,
indexes, app functions and their security settings, triggers, RLS policies,
effective anonymous/authenticated table/column/function/schema permissions,
enum/domain types, sequence permissions and bucket configuration. App policies on
`storage.objects` and app triggers on Auth/Storage are included. Student rows,
uploaded file names, credentials and managed Supabase implementation internals
are not part of the definition inventory. Output contains counts, never altered
function bodies or other potentially sensitive Dashboard edits.

All applicable native catalog assertion scripts also run against staging through
the **read-only** SQL endpoint. Multiple statements are checked separately because
the Management API otherwise returns only the last statement's result. The
auditor fails on missing assertions, failed assertions, unrecorded DDL/grant drift,
unexpected published tables or unsafe publication event flags.

If drift appears, stop and inspect it privately. Decide whether it is an
authorized intentional change; represent an approved change with a new forward
migration. Do not copy the live database into the expected baseline, modify
applied SQL, or repair migration versions merely to silence a failure.

## Applying a reviewed migration

Review pending SQL for data deletion, table/column removal, privilege changes and
locking implications. Back up authorized important staging data before a
destructive change and arrange a testing window. The Step 4 publication and
business-conflict migrations contain no data deletion and leave the five
persistent synthetic accounts and their existing records/files in place.

```powershell
npm.cmd run staging:acceptance -- --database-only
npm.cmd run staging:migrate
npm.cmd run staging:audit
```

The database-only command requires the staging-only connection/public/private
operator settings described below. It runs all 36 transactional messaging
assertions and rolls back its temporary fixtures. Migration apply audits an
already-initialized staging schema before making any changes. Versions, original
SQL and checksums are recorded in the same transaction as each migration. After
an ambiguous timeout, run a read-only plan before considering any retry.

The GitHub staging workflow remains manual and reviewer-gated, defaults to a
read-only plan plus audit, and requires successful exact-commit push CI on the
current protected staging head. Apply additionally validates the resulting schema
and generated types. This step does not merge PRs, enable automatic production
migrations, approve its own GitHub deployment job, or deploy the application.

## Live RLS, Storage and Realtime acceptance

Provide these values through a private operator environment—not Next.js, command
arguments, Git-tracked dotenv files, screenshots or CI logs:

- `STAGING_MANAGEMENT_TOKEN`: project-scoped operator permissions.
- `STAGING_PUBLISHABLE_KEY` and `STAGING_SERVICE_ROLE_KEY`: this staging project's
  separate public key and private fixture-provisioning key.
- `STAGING_DATABASE_URL`: the exact staging session connection, database
  `postgres`, port `5432`, with `sslmode=require` as the URL validation marker.

The runner parses that URL into explicit connection fields and uses
`rejectUnauthorized=true` with Supabase's reviewed, fingerprint-pinned public CA.
Certificate and hostname checks remain enabled; the URL's `sslmode` cannot weaken
them. Certificate rotation fails closed and needs operator review. No CA or token
is added to the browser bundle or global machine trust store.

```powershell
npm.cmd run staging:acceptance
```

This creates seven random synthetic accounts marked with a server-owned run ID.
Trusted profile setup checks that SQL and Auth identify the same newly created
users before any privileged update. Ordinary test operations use independent
student/admin sessions, not service-role clients as substitutes for RLS.

The existing direct API matrix covers anonymous, pending, verified, suspended and
administrator access; profiles and student verification; ownership of listings,
images and avatars; favorites; participant-only messages; reservations/meetups;
notifications; and private listing/student reports and moderation. It also tests
real signed private-file access, short expiration, HTTP MIME/size restrictions,
referenced-image deletion protection, and scoped cleanup through Storage APIs.
Real simultaneous transactions test conflicting reservations, sale completion
and Storage lifecycle locks. Every run removes only its verified run-owned
records/files/accounts; failure during cleanup cannot count as a passing run.

Migration `20261022000000_enable_secure_messaging_realtime.sql` is the reviewed
promotion of the older staged messaging configuration. It validates prerequisite
RLS/RPC/privilege state, refuses unexpected publication tables, publishes only
`public.messages`, and permits only INSERT/UPDATE events. Do **not** backdate or
move the old `20260927010000` staged file into an already-applied history.

Migration `20261022010000_use_non_retryable_business_conflicts.sql` fixes a
failure found by live staging acceptance: PostgREST 14.18 repeatedly retries
manually raised serialization failures (`40001`), causing stale listing/meetup
edits to time out instead of returning a useful conflict. It replaces only the
explicit business-conflict RAISE clauses in seven allowlisted RPCs with `PT409`
(HTTP 409). A transaction aborts if that exact expected set is not present.
Function guards, locks, signatures, ownership and privileges are preserved;
previously applied migrations are unchanged. UI error mapping handles both the
new code and genuine/older serialization failures. Negative API tests still fail
on gateway timeouts and service outages; those are never counted as RLS success.
See [Supabase's retry-loop advisory](https://github.com/orgs/supabase/discussions/50151)
and [PostgREST custom errors](https://docs.postgrest.org/en/stable/references/errors.html).

The application uses Postgres Changes for messages. Three separate student
sessions test bidirectional INSERT delivery and read receipts, an unrelated
account's denial with positive control events, and controlled socket disconnect,
authorized missed-message history fetch and resumed delivery. This does not claim
WebSocket replay or a browser-level airplane-mode test. Notifications use normal
authorized refreshes and do not require publication. Verification/profile data
must never be added to Realtime merely for convenience.

Signed URLs are bearer capabilities until expiry: never log/share them as public
student-ID URLs. Private listing images use a five-minute application TTL;
verification access uses authorized private downloads, with one-minute signed
URLs exercised only by the security test. Avatars are intentionally public but
owner-managed; student IDs and listing images remain private.

## Generated database types

After confirming the staging schema:

```powershell
npm.cmd run db:types
npm.cmd run db:types:check
npm.cmd run typecheck
```

`db:types` now targets the **registered staging reference**, never `--linked`.
It regenerates only `src/types/database.generated.ts`, validates the public type
response, and prints its SHA256 instead of schema contents. `src/types/database.ts`
re-exports generated types directly; obsolete pending messaging, reservation,
notification, moderation and profile overlays have been removed. No-argument RPCs
and optional/null meetup/reservation inputs follow the actual generated contract.
Include the regenerated artifact with the reviewed implementation commit.

## Full local acceptance

```powershell
npm.cmd run qa:local
```

Docker must be running. This uses a fresh, uniquely owned local Supabase project
and checks native SQL/RLS/Storage, direct APIs, concurrent transactions, Realtime,
local SMTP and browser workflows. It never reuses or resets hosted staging or
production. Test operator artifacts are ignored by ESLint and Git, while tracked
application, script and test sources remain checked. A real deployment still
needs reviewed source, green exact-commit CI and protected hosting acceptance.

## Execution record: 2026-10-22

Staging verification completed against `niocptgzzbozpbfzifdk`:

- All 20 ordered migration versions, names and checksums match; none are pending.
- Definition comparison: zero missing, unexpected or changed schema objects.
- All 129 native security catalog assertions pass.
- The transactional messaging gate passes 36 assertions and rolls back fixtures.
- Live acceptance passes 253 API/Storage checks, three concurrent transaction
  scenarios and four Realtime/reconnection scenarios.
- All seven run-owned acceptance accounts and their temporary records/files
  were removed successfully. The five persistent synthetic accounts, two
  listings, conversation, messages, favorites, reservation, meetup and four
  verification records remain; every public application table still has RLS.
- Generated public TypeScript definitions match the deployed staging schema.

The final fresh `qa:local` run also passes route type generation, TypeScript,
ESLint, all 372 regression tests, all 535 embedded SQL assertions across 20
migrations, source-security checks, the native 36-assertion messaging gate and
129 catalog assertions. Full acceptance passes 253 API checks, three concurrency
scenarios, four Realtime scenarios, 12 captured local SMTP/Auth checks, the
production build, and all 46 browser tests (40 anonymous, six authenticated).
Its owned disposable Docker stack was stopped successfully. A known-pattern
secret scan also passes all 437 current files and 741 historical blobs; this is
not a claim that pattern scanning can prove the absence of every possible secret.

Cold Windows/OneDrive reads exceeded the former two-minute lint budget; a
separate full-source lint run passed. The final runner allows a bounded three
minutes for the unchanged lint rules/files and completes successfully. The clean
checkout compiler regression also retains its expected failure/success assertions
with bounded timeouts and explicitly rejects a process-start failure or timeout
as evidence of the expected type error.

The protected linked/production project was not relinked, migrated, reset or
used for acceptance. Hosted browser acceptance and external email delivery are
separate release gates, not implied by the staging database checks. These local
changes still require publication, review and successful exact-commit GitHub CI;
an earlier commit's green run does not certify this implementation.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Storage access control](https://supabase.com/docs/guides/storage/security/access-control),
[Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes),
[verified database TLS](https://supabase.com/docs/guides/platform/ssl-enforcement).
