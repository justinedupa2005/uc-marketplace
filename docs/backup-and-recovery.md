# Backups and recovery (Step 9)

Status: implementation and synthetic testing, **not operational backup sign-off**.
Production stays deployment-disabled and every hosted operations command currently
accepts only registered staging. Do not change the environment registry to bypass
that restriction. No hosted database has been restored or reset.

## Verified provider baseline

Read-only inspection on 2026-10-29 confirmed the current Supabase organization is
on the **Free** plan, staging is healthy, PITR is disabled and its managed backup
inventory is empty. Supabase recommends regular off-site logical exports for
Free projects. Paid daily-backup retention depends on the plan; do not assume a
paid feature is enabled. [Supabase database backups](https://supabase.com/docs/guides/platform/backups).

Database snapshots contain Storage metadata, **not the image bytes**. The
separate file capture below is mandatory, including for private verification
images. [Supabase restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore).

## Proposed policy: owner approval required

`config/operations.json` records the selected **Backblaze B2** provider but
intentionally starts with `enabled: false`, no owner, no exact repository
destination/ID and `retentionApproved: false`.

| Control | Proposed value / activation requirement |
| --- | --- |
| Accountable owner | Project owner appoints a named backup operator and incident deputy |
| Frequency | Daily, 02:17 Asia/Manila; also before risky approved changes |
| Recovery point objective | 24 hours; increase frequency if activity requires it |
| Recovery time objective | 120 minutes, a target to measure, not a demonstrated SLA |
| Retention | 7 days for the complete database/media/verification bundle; not yet approved |
| Integrity | Metadata check during capture; full encrypted-data read weekly |
| Restore exercise | Monthly and after backup/schema/tool changes |
| Access | Dedicated private repository, MFA, narrowly scoped keys and separately authorized retention operations |
| Key custody | Persistent strong restic password in a password manager; separate encrypted/offline recovery copy |

Verification retention is a privacy decision, not a convenient default. Approve
both the source-document lifecycle and the permitted backup-retention extension.
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

1. Appoint owner/deputy; approve retention, destination, access, key custody and
   recovery objectives. Initialize a **new private restic v2 repository** using
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
5. Review `npm.cmd run ops:plan`. With explicit
   `OPS_CONFIRM=niocptgzzbozpbfzifdk:backup`, capture a complete bundle. Review
   its receipt privately, run `npm.cmd run ops:check`, and test that exact
   backup's recovery in an approved isolated target before operational sign-off.
6. For GitHub automation, create a separately protected **staging-operations**
   environment and the secrets/variables listed in `backups-and-restore.yml`.
   Retain restricted branch rules and GitHub workflow-failure notifications.
   Enable `STAGING_BACKUPS_ENABLED=true` only after an approved successful manual
   capture, read-back and recovery test. The workflow checks out staging and
   requires successful CI on that exact current staging SHA before credentials.
   Scheduled workflows run only after this workflow exists on the repository's
   default branch; do not mark scheduling operational merely because the YAML
   exists on a feature/staging branch. Do not merge to production for this reason.
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
backup as `BACKUP_NOT_VERIFIED_FRESH`. The first B2 off-site drill
([run 40868993896](https://github.com/justinedupa2005/uc-marketplace/actions/runs/40868993896))
passed CI, exact-source gates and installation, received the required staging
review, then **failed inside the drill**. No passing off-site receipt exists.
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
lengths or hashes. A new passing off-site receipt is still required.

Before Step 9 is complete: verify B2 credentials/destination, approve key custody
and retention, obtain separate authority before any non-synthetic capture,
capture and recover the approved staging bundle, activate/observe backup and deletion schedules,
configure and test alert delivery, appoint incident responders, and record a
provider-level recovery exercise. See [monitoring/incident response](monitoring-and-incidents.md).
