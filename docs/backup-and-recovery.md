# Backups and recovery (Step 9)

Status: implementation and synthetic testing, **not operational backup sign-off**.
Production stays deployment-disabled and every hosted operations command currently
accepts only registered staging. Do not change the environment registry to bypass
that restriction. No hosted database has been restored or reset.

## Execution checkpoint: 2026-11-01

The protected `staging-operations` environment has all five backup secrets,
including the existing staging-only Storage service key. Its sole-owner review
is configured by explicit approval; administrator bypass remains disabled.
Read-only source inspection found the five marked fixture accounts, 15 owned
Storage objects, no unknown accounts/object owners, and 20 migrations.

[Staging PR #14](https://github.com/justinedupa2005/uc-marketplace/pull/14)
publishes the exact-bundle recovery implementation. Its first CI run passed
type checking, lint, regression tests and database validation, then **failed the
dependency gate** on newly reported development-only minimatch advisory
[GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249).
The installed audit reports 16 moderate lint-tooling findings. The owner then
approved a seven-day, exact-path/version development-only exception, expiring
November 8 at 00:00 Asia/Manila; see [the reviewed dependency policy](ci-dependency-security.md).
Production findings and every new/changed advisory still fail CI. A complete
credentialed capture/restore has **not** succeeded. Daily backups, monitoring schedules and alert delivery remain
disabled. Brevo was selected for alerts, with verified sender
`ucmarketplace.security@gmail.com`; the dedicated API key and one consented,
inbox-confirmed delivery test remain outstanding.

The first protected capture/restore run
[41309448551](https://github.com/justinedupa2005/uc-marketplace/actions/runs/41309448551)
passed CI and owner review, but stopped **before capture**. All five required
credentials were stored in `staging-operations`; redacted runner bindings showed
all five were empty. Non-secret environment variables arrived correctly. The
caller omitted the reusable workflow's named secret mappings. Declaring the
environment alone does not pass its secrets across a reusable-workflow boundary.
The fix explicitly maps the nine operation-secret names and declares the five
backup mappings required, without `secrets: inherit`. Environment values remain
behind the existing `staging-operations` review; no key/password is rotated or
copied to a repository-level secret. Runtime guards independently reject empty
values using fixed `*_REQUIRED` codes in `preflight-bindings`, with no values,
lengths or hashes in diagnostics. Required interface declarations check mapping
presence, not whether a value exists.
[GitHub reusable-workflow secret requirements](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).

The reviewed follow-up run
[41313193710](https://github.com/justinedupa2005/uc-marketplace/actions/runs/41313193710)
received all required bindings. Its latest attempt passed vault, database,
synthetic-owner and private-Storage preflight, then failed in **capture**, with no
fixed error codes. No complete bundle or restoration evidence was certified.
Read-only diagnosis validated the actual manifest against staging metadata and
aggregate table fingerprints, all 11 required protected tables, the messages-only
Realtime contract, 15 valid file headers, and existing table/sequence read and RLS
bypass permissions. The pinned Linux-amd64 PostgreSQL image exists and matches
its digest. These checks do not prove that the database export succeeded.

Capture now distinguishes policy, vault, connection, snapshot, inventory,
manifest, database/media/verification, consistency, integrity and bundle phases.
The export producer propagates **allowlisted codes only** through restic's
stderr boundary; it never prints an Error, command, SQL, hostname, file path,
credential, snapshot token or raw provider output. Known codes distinguish
snapshot, version, TLS, permission, connection, Docker/image and read-only
refusals; unknown failures remain explicit without private details. Repository
lock and malformed/missing completion-summary failures are classified separately.
A real local-restic failure-propagation test rejected a truncated synthetic
producer, preserved the fixed codes and created no passing snapshot. The separate
three-object encrypted local Storage round-trip also passed. Hosted capture and
exact-bundle restoration still need a fresh reviewed run; no credentials,
permissions, source data, schedules, deployment or production settings changed.

## Verified provider baseline

Read-only inspection on 2026-10-29 confirmed the current Supabase organization is
on the **Free** plan, staging is healthy, PITR is disabled and its managed backup
inventory is empty. Supabase recommends regular off-site logical exports for
Free projects. Paid daily-backup retention depends on the plan; do not assume a
paid feature is enabled. [Supabase database backups](https://supabase.com/docs/guides/platform/backups).

Database snapshots contain Storage metadata, **not the image bytes**. The
separate file capture below is mandatory, including for private verification
images. [Supabase restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore).

## Approved synthetic manual capture; automatic activation still blocked

The owner approved daily backups at **02:17 Asia/Manila**, retained for **7 days**,
for **synthetic staging data only**. `justinedupa2005` is the sole backup owner
and incident responder; no deputy is assigned. A deputy is a continuity
recommendation, not a technical prerequisite. Recovery depends on the sole
maintainer's availability and independently accessible recovery material.

`config/operations.json` records this limited approval in
`syntheticPolicyApproval`. On 2026-11-01 the owner confirmed the hosted staging
project contains synthetic data only and authorized one complete capture and
isolated restoration, publishing through CI, conditional scheduling after a
successful restore, and preparation/testing of monitoring. `manualBackupEnabled`
and the synthetic `activationApproved`/`sourceAttestedSyntheticOnly` flags are
true. `enabled` (scheduled policy), `monitoringEnabled` and `deletionApproved`
remain false. No real student data, production deployment, retention deletion,
automatic review approval or unconfigured third-party service is authorized.
The owner-supplied permanent Backblaze S3 repository URL and full
64-character repository ID are pinned in the policy. On 2026-10-30 the owner
reported successful initialization, reopening with `restic snapshots`, a clean
`restic check`, and repository format **2**, matching the format required by
the backup client. These are owner-reported results, not an independent run of
the application's credentialed verification. That verification must match the
pinned ID and format 2 before capture; a changed ID or format is rejected.
`ops:plan` now reports `repositoryConfigured: true`, meaning the URL and ID are
recorded, not that credentials, access or bucket privacy were checked remotely.
No database or Storage backup has been created in this permanent repository by
this implementation.
The owner's existing `retentionApproved: true` setting is preserved, but its
scope is explicitly **synthetic-only** under `dataScope` and
`syntheticPolicyApproval`: no real student records, private conversations or
real ID images were approved for backup. Every capture checks the five known fixture
accounts, fixture ownership markers and Storage owners inside its read-only
snapshot; a sixth or unrecognized account/file owner aborts before any dump.

The protected `staging-operations` environment now requires `justinedupa2005` to
review jobs, permits solo-owner self-review by explicit user approval, restricts
access to staging and disallows administrator bypass. This is a manual checkpoint,
not independent two-person review. The existing project-verified staging
`service_role` key was encrypted directly into its environment secret; no key
was minted, rotated, displayed or saved locally. This preserves current JWT
provenance validation; migration to Supabase's newer secret-key format needs a
reviewed equivalent project-provenance check before legacy key retirement.

| Control | Approved synthetic scope / remaining activation requirement |
| --- | --- |
| Accountable owner | `justinedupa2005`, solo maintainer; no deputy assigned |
| Frequency | Daily, 02:17 Asia/Manila, approved as policy only; no schedule activated |
| Recovery point objective | 24 hours; increase frequency if activity requires it |
| Recovery time objective | 120 minutes, a target to measure, not a demonstrated SLA |
| Retention | 7 days for synthetic staging data, including generated verification fixtures; no deletion authorized |
| Integrity | Metadata check during capture; full encrypted-data read weekly |
| Restore exercise | Monthly and after backup/schema/tool changes |
| Access | Dedicated private repository, MFA, narrowly scoped keys and separately authorized retention operations |
| Key custody | Persistent strong restic password in a password manager; separate encrypted/offline recovery copy |

Real verification retention remains a separate privacy decision. Approve both
the source-document lifecycle and the permitted backup-retention extension
before any real-data capture; neither is covered by the synthetic approval.
The backup tool does not delete source student IDs or silently invent their
legal retention period. It refuses capture until retention is approved. All
bundle components use the strictest retention; longer database retention would
require a separately designed, approved verification-free backup.

Use a private Backblaze B2 bucket over its HTTPS S3-compatible endpoint; the
exact bucket/prefix remains to be verified before activation. Restrict the
credential to its application/environment prefix. Review provider
versioning, object-lock and soft-delete settings: forgetting a restic snapshot
alone does not erase retained object versions. Ensure the final deletion policy
does not keep verification images beyond the approved limit. Do not use a public
bucket, the application's live Storage buckets, Git, GitHub artifacts or a shared
student-accessible drive as the destination. No paid service has been purchased.

Restic needs object-deletion permission to release its repository locks. A B2
read/write key with `deleteFiles` is **not append-only**, even if this application
gates retention separately. Separate operator approval/credentials reduce
accidental deletion but do not defeat compromise of an equally powerful writer.
Review a provider-supported immutable/separate-copy design before claiming
ransomware protection; indiscriminate Object Lock can break restic operations
and conflict with sensitive-document retention. No lock/lifecycle setting is
changed automatically.

## Backup format and scope

`npm run ops:backup` uses a read-only, repeatable-read exported PostgreSQL
snapshot and a pinned, patched `pg_dump` client. It streams a custom-format
archive directly into restic encryption. It covers `public`, `private`, `auth`,
`storage`, `supabase_migrations` and `extensions`: students/Auth records, profiles,
categories, listings/images, favorites, conversations/messages, notifications,
reservations/meetups, reports, verification records and moderation audit data.
Grants, policies and custom functions are preserved; passwords for managed
database roles are not exported separately. Schema-scoped dumps exclude the
database-global Realtime publication: its exact messages-only INSERT/UPDATE
contract is therefore captured separately in the encrypted completion manifest.
Recovery must apply that reviewed metadata as well, never publish private tables.

Separate encrypted restic snapshots capture:

- `media`: the actual `listing-images` and `avatars` bytes.
- `verification`: the actual private `student-verifications` bytes.
- `bundle`: a completion manifest referring to all three successful component
  snapshots, schema/table counts and an inventory-integrity digest.

Names/owners/paths and per-file checksums are inside encryption, not console
output. Captures reject public sensitive buckets, unexpected buckets, unsafe paths, oversized or
unexpected image types, missing files and changed Storage inventories. Producers
return a nonzero exit on failure; restic's `--stdin-from-command` prevents a
truncated producer from being recorded as successful. A partial capture never
gets a completion manifest. Retry by starting a fresh capture, not by relabelling
its incomplete snapshots. Avoid running migrations/uploads during capture.

The existing source avatar bucket is public under the application's current
profile policy; listing and verification buckets are private. This tooling
preserves those settings without changing any source bucket. All backup copies,
including avatars, are encrypted and private. Existing 2 MiB avatar and 5 MiB
listing/verification limits remain enforced.

No plaintext database export or verification-image directory is written locally.
Only a public pinned CA certificate, generated test tools and counts-only receipts
are stored under ignored `.qa/operations`. Keep host disk encryption and operator
access controls enabled; memory and privileged process inspection are still
security boundaries. Never put backup credentials in `.env.local`, Vercel app
variables, `NEXT_PUBLIC_*`, command arguments, chat or application logs.

The archive is **not the whole Supabase control plane**. Independently escrow
approved Auth settings, encryption-root recovery material, API/signing-key
rotation procedures, SMTP/provider credentials and other required service
settings in a password manager. Do not copy live keys into a restore test. New
project recovery may require the provider's encryption-key transfer procedure.
[Official CLI restore prerequisites](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Operator activation checklist

1. Keep the recorded sole owner and no-deputy continuity risk visible. Obtain
   separate activation authority, approve the permanent destination, access,
   key custody and recovery objectives, and confirm the exact data scope before
   any capture. Real data needs its own retention approval. Initialize a
   **new private restic v2 repository** using
   restic's official instructions, outside application processes. Save its
   persistent password securely and independently record its repository ID.
2. Set the exact approved `repository` (`s3:https://host/bucket/prefix`),
   `repositoryId`, owner and approved retention in `config/operations.json`.
   Enabling this policy does not enable application production deployment.
3. Install the pinned tools with `npm.cmd run ops:install-restic`, or verify an
   existing restic 0.19.1 binary. Set `OPS_RESTIC_BINARY` to its absolute path.
   Docker supplies the pinned PostgreSQL client; an explicitly configured
   `OPS_PG_DUMP_BINARY` must meet the reviewed minimum patch version.
4. Inject operator-only `OPS_ENV=staging`, `OPS_PROJECT_REF`, `OPS_DATABASE_URL`,
   `OPS_SERVICE_ROLE_KEY`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD` and the narrowly
   scoped object-store credentials from a secret manager. Database URL: exact
   registered host/user, session port 5432, database `postgres`, no query options.
   Connections use the pinned provider CA and verify-full TLS. The legacy
   service key must independently identify staging and the `service_role` role.
   It is required only for private object reads, never exposed to the app.
5. Review `npm.cmd run ops:plan` and run `npm.cmd run ops:verify`. The latter
   checks the private B2 bucket, key prefix/region, pinned repository identity,
   source fixture ownership and staging Storage credential without creating a
   backup. For the complete test run `npm.cmd run ops:cycle` with
   `OPS_DATA_SCOPE=synthetic-only`, `OPS_CONFIRM=niocptgzzbozpbfzifdk:backup` and
   `OPS_RESTORE_CONFIRM=niocptgzzbozpbfzifdk:isolated-synthetic-restore` plus the
   operator credentials. It captures the database, separate media/verification
   bytes and completion manifest, then restores **that exact bundle ID** into a
   fresh labelled local-only PostgreSQL container. It compares every table's
   fingerprint and Storage inventory, runs catalog/RLS checks, verifies owner
   access and cross-owner denial, restores the original file bytes in bounded
   isolated memory, and decodes an actual restored listing image in Chromium.
   The encrypted `restore-evidence` snapshot is written only after success and
   scoped container cleanup. No local plaintext dump/image folder is created.
6. For GitHub automation, create a separately protected **staging-operations**
   environment and the secrets/variables listed in `backups-and-restore.yml`.
   Retain restricted branch rules and GitHub workflow-failure notifications.
   From the registered **Security and workflow checks** workflow, select staging
   and the `staging_operation` value `verify` or `capture-restore`. The same-commit
   reusable operations job runs only after CI and still requires the separate
   `staging-operations` review. It explicitly maps only the declared operation
   secret names; the protected environment supplies its scoped values. Broad
   repository/organization secret inheritance is forbidden. This launcher avoids changing
   production/main just to register a new manual workflow.
   Manual operations do not
   depend on `STAGING_BACKUPS_ENABLED` and cannot enable scheduling. Set the
   scheduled policy `enabled` and enable repository variable
   `STAGING_BACKUPS_ENABLED=true` only after successful manual capture/recovery
   on the final exact reviewed source. Scheduled capture refuses missing, stale,
   wrong-repository or different-commit restore proof, and performs an exact
   capture/restore cycle again. The workflow checks out staging and
   requires successful CI on that exact current staging SHA before credentials.
   Scheduled workflows run only after this workflow exists on the repository's
   default branch; do not mark scheduling operational merely because the YAML
   exists on a feature/staging branch. Do not merge to production for this reason.
   Required environment review also applies to scheduled jobs: registering cron
   triggers does **not** make this an unattended service. No automated approval
   or credential handoff around that checkpoint is implemented. Any alternate
   unattended-runner/security policy needs separate explicit review.
7. Establish deletion using a separately authorized operator credential. Start
   with `npm.cmd run ops:retention:plan`. Applying requires the exact
   `OPS_PRUNE_CONFIRM=<staging-ref>:prune:<YYYY-MM-DD UTC>` and
   `npm.cmd run ops:retention:apply`. Only expired, tagged, exact snapshot IDs are
   forgotten, followed by pruning/integrity checks. Never prune source Storage.
   No deletion schedule or credentials have been activated by this implementation.

Daily jobs never automatically initialize a repository, rotate keys, reset a
database, adopt arbitrary projects, prune data or repair an ambiguous write.
Treat incomplete/failed runs and overdue retention as incidents.
[Restic backup](https://restic.readthedocs.io/en/stable/040_backup.html) and
[retention](https://restic.readthedocs.io/en/stable/060_forget.html) references.

## Restore exercises and real recovery

```powershell
npm.cmd run ops:drill:storage
npm.cmd run ops:drill
```

The first exercises real restic encryption, separate file packs, byte-for-byte
recovery, integrity reads, wrong-key denial and rejection of failed producers.
The second creates a unique labelled local PostgreSQL container, applies all
migrations and the synthetic transaction workflow, dumps/encrypts/restores it
into a **new** database, compares every covered table's contents, re-runs native
security assertions, restores separate synthetic file packs and decodes a
restored listing image in Chromium. No caller-provided destination, `--clean`,
hosted credentials or existing Docker stack is accepted. Cleanup verifies the
run UUID/name/label before removing only its disposable container. Encrypted
synthetic repositories and counts-only evidence remain ignored; their ephemeral
keys are not saved. Those synthetic artifacts are not backups of hosted students.

This tests PostgreSQL/RLS, encrypted file bytes and browser image decoding. The
minimal native fixture is **not** a complete GoTrue/Storage HTTP installation;
it does not prove recovery of hosted Auth sessions, provider-encrypted fields,
Storage API ownership or an actual hosted backup. Those remain separate gates.
The new `ops:cycle` uses an actual hosted capture rather than generating a new
fixture backup, but its isolated target is still a native PostgreSQL/file-byte
recovery test, not a full hosted Supabase control-plane/API recovery. Do not claim
restored SMTP, Auth encryption roots or a deployed replacement application.

### Synthetic-only Backblaze drill

The owner selected B2 and authorized **synthetic data only**. GitHub secret-name
inspection confirmed `B2_ENDPOINT`, `B2_BUCKET_NAME`, `B2_KEY_ID` and
`B2_APPLICATION_KEY`; values were not read or displayed. These are used only by
the opt-in `synthetic-backblaze` job in the existing **Security and workflow
checks** workflow. Manually dispatch that workflow on `staging` with
`synthetic_b2=true` (leave `full_stack=false`). No Supabase credentials are
injected into that job. It requires successful local-security checks and push
CI for the exact current staging head before using B2 credentials. The owner
approved publishing Step 9 through protected CI and running this synthetic-only
drill; no application deployment or real-data capture was authorized.

`npm.cmd run ops:drill:b2` requires `OPS_B2_SYNTHETIC_CONFIRM=synthetic-only` and
those four operator-only variables. It authenticates directly to B2, verifies
the endpoint/account/bucket match and `allPrivate` privacy, and refuses master,
account-wide or administrative keys. Use a single-bucket key with `listBuckets`,
`listFiles`, `readFiles`, `writeFiles` and `deleteFiles` (restic lock removal).
A key prefix must be empty or safe slash-terminated segments. A failure here
requires reviewing the key's scope, not weakening the check or changing privacy.

The drill initializes a **fresh** `ucm-synthetic-tests/<UUID>` child under the
key's allowed prefix, encrypts three generated PNG files, restores byte-identical
copies, reads every encrypted block, rejects a wrong key and rejects an incomplete
producer. No existing repository is adopted or pruned. Bounded encrypted
synthetic artifacts remain at the reported test prefix, with no saved test
password. An authorized operator can remove only that exact test prefix after
review; no bucket-wide cleanup or lifecycle change is performed. This off-site
file drill does not claim a hosted database backup or operational retention.
[Backblaze restic integration](https://www.backblaze.com/docs/cloud-storage-integrate-restic-with-backblaze-b2),
[authorization](https://www.backblaze.com/apidocs/b2-authorize-account),
[bucket privacy](https://www.backblaze.com/apidocs/b2-list-buckets).

For an incident, the incident commander must first approve the exact backup,
new isolated target and authorized operators. Keep networking/email restricted
and deploy no app until recovery is validated. Inspect trusted dumps only in
the isolated target; restore SQL can execute source-defined code. Restore schema,
Auth/application relationships and grants using the provider-supported process,
then recover corresponding file bytes using supported Storage import tooling.
Do not assume a privileged file upload preserves owner metadata, edit Storage
internals blindly or make buckets public to repair access. Verify owner mapping,
verification-image denial, listing images, RLS and cross-account tests through
the target's actual APIs. Plan session invalidation and fresh keys/settings.

Record backup/source SHA and date, restored target, table/file comparisons,
permission tests, start/finish/recovery time and any gaps in private evidence.
Reapply approved deletion/verification-retention requests so recovery cannot
silently resurrect expired sensitive documents. Promotion to a live system
requires separate explicit approval; this tooling cannot restore production.

## Evidence / remaining gates

2026-10-29: encrypted synthetic file recovery passed for all three buckets;
wrong-key access and failed-producer snapshots were denied. The native PostgreSQL
restore drill (`2e8a64bf-32ba-4f9b-9c05-f7bb58c7aa39`) passed in **20 seconds**:
all 20 migrations, committed synthetic transaction fixtures, every covered
table's row comparison, **129** restored security assertions, **3** restored
access checks, **6** separate file restores and a decoded listing image. Its
owned disposable container was removed; existing development stacks were not
reset. Sanitized evidence is under ignored `.qa/operations/drills/`.

Read-only hosted monitoring worked and correctly reported the missing approved
backup as `BACKUP_NOT_VERIFIED_FRESH`. The latest synthetic-only B2 drill
([run 40888196486](https://github.com/justinedupa2005/uc-marketplace/actions/runs/40888196486))
passed on staging commit `0cb687a7859dfda17ab3255d618c2ebf6e686bd7`.
Its sanitized receipt confirms **3 generated images** restored, private-bucket
verification, full repository integrity, wrong-password denial and failed-producer
rejection in **24 seconds**. No real student data, production changes or alert
emails were involved. The isolated full-stack job was intentionally skipped.
This verifies the test destination, not a permanent repository, hosted database
backup, scheduled service or retention cleanup. Do not reuse the drill's
ephemeral encryption password/repository for ongoing backups.

Historical failures: the first B2 off-site drill
([run 40868993896](https://github.com/justinedupa2005/uc-marketplace/actions/runs/40868993896))
passed CI, exact-source gates and installation, received the required staging
review, then **failed inside the drill**. At that point no passing off-site
receipt existed.
The initial generic failure withheld the cause as well as private values; safe
phase/category diagnostics now address that troubleshooting gap. They emit only
fixed enums, never raw assertions, provider responses, stderr, bucket names or
credentials. Permission, privacy and exact-source gates remain unchanged.
Local verification passed **483** regression tests, TypeScript, ESLint and the
production build. No real student data was used in backup/restore tests.

For a failed B2 run, inspect `failurePhase`, `failureCode` and `operationCodes`:

| Fixed diagnostic | Operator review (do not broaden permissions or change privacy automatically) |
| --- | --- |
| `B2_KEY_ID_REQUIRED` / `B2_APPLICATION_KEY_REQUIRED` | Required input is absent or whitespace-only; check explicit step bindings and GitHub secret scopes |
| `B2_KEY_ID_INVALID` / `B2_APPLICATION_KEY_INVALID` | A value was supplied but its format is invalid; verify the existing key field, not a key name/label, without regenerating it |
| `B2_AUTHENTICATION_FAILED` | Check that the active application key and key ID belong together |
| `B2_METADATA_PERMISSION_DENIED` | Confirm the key can read metadata for the selected bucket |
| `B2_REQUEST_FORBIDDEN` | Review provider access restrictions and account/transaction caps |
| `B2_SINGLE_BUCKET_KEY_REQUIRED` / `B2_ADMINISTRATIVE_KEY_REFUSED` | Use a non-administrative, single-bucket key; do not weaken the guard |
| `B2_RESTIC_CAPABILITIES_REQUIRED` | Review the five documented restic capabilities, including lock cleanup |
| `B2_PRIVATE_BUCKET_REQUIRED` | Select the intended private bucket; never make sensitive copies public |
| `B2_ENDPOINT_ACCOUNT_MISMATCH` / bucket mismatch codes | Reconcile the configured endpoint/bucket with this key's account |
| `S3_ACCESS_DENIED` / `S3_SIGNATURE_REJECTED` | Review S3 access and key pairing; keep raw diagnostics private |
| `B2_OPERATION_FAILED` | Use the fixed phase to narrow investigation; never turn on raw error dumps |

Each retry needs review of the failed phase first and the required staging
environment approval. A failed drill is not a valid backup; retained partial
synthetic artifacts, if any, are not an operational repository to adopt.

The diagnostic follow-up ([run 40872772592](https://github.com/justinedupa2005/uc-marketplace/actions/runs/40872772592))
failed before any B2 API request with `B2_KEY_ID_REQUIRED`. Read-only inspection
confirmed all four repository secrets exist, no staging secret shadows them,
and that exact run explicitly bound all four into the direct drill step (there
is no reusable workflow or missing `secrets: inherit`). The credential log
bindings have masked continuation lines; the old validator conflated missing
values with formatting errors. Surrounding pasted whitespace is now stripped
only in memory, consistently for both native authentication and restic/S3.
Internal whitespace remains invalid. No stored secret is modified or regenerated.
Receipts expose only boolean presence/surrounding-whitespace flags, never values,
lengths or hashes. The later passing run above supersedes that failed attempt.

Before Step 9 is complete: approve and configure the permanent B2 repository,
key custody and activation; obtain separate authority/retention approval before
any non-synthetic capture; capture and recover the approved staging bundle;
separately authorize and activate/observe backup and deletion schedules;
configure and test alert delivery; document the solo-responder continuity risk;
and record a provider-level recovery exercise.
See [monitoring/incident response](monitoring-and-incidents.md).
