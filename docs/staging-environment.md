# Separate staging environment (Step 3)

## Environment inventory

Public identifiers are tracked in [config/environments.json](../config/environments.json).
They are not API credentials. Do not change them merely to make a failed gate pass.

| Environment | Purpose | Database | Hosting |
| --- | --- | --- | --- |
| Local | Development and disposable destructive QA | Local Supabase / unique `qa:local` stack | localhost |
| Staging | Integration and authorized acceptance testing | `uc-online-shop-staging`, `niocptgzzbozpbfzifdk`, Sydney | Dedicated Vercel project `uc-online-shop-staging` |
| Production/protected existing project | Official student data; never a staging target | Existing linked `fezeqoqdrmicvxpbgnaf` | Production hosting is not configured by this step |

The existing project was inactive when inspected and was **not** resumed, reset,
linked differently, migrated, seeded, or otherwise modified. The staging project
was created fresh in the existing Free organization, without paid branching,
compute upgrades, high availability, cloning, or copying production data.

Staging Supabase dashboard:
<https://supabase.com/dashboard/project/niocptgzzbozpbfzifdk>.
Staging application origin: <https://uc-online-shop-staging.vercel.app>.
The Vercel domain is reserved, but **the application has not been deployed yet**.

## Provisioned safeguards

- Staging has its own PostgreSQL, Auth users, API keys, Storage objects and buckets.
- All 18 existing migrations were applied to staging, including RLS, authorization
  functions and Storage policies. The original SQL files were not changed.
- `listing-images` and `student-verifications` remain private. `avatars` retains
  the intentionally public policy from the application migrations; do not upload
  student IDs or other private evidence to it.
- Vercel Authentication is set to **All Deployments**, not only Preview or
  Standard protection. Its API setting is `ssoProtection.deploymentType = all`.
  This includes the dedicated project's Vercel production domain.
- The Vercel project has no Git integration and no deployment yet, preventing an
  accidental auto-deployment from an unreviewed branch. Existing Vercel projects
  were not changed. No paid password-protection addon was enabled.
- Hosting uses Node.js `22.x`, `npm ci` and `npm run build`, matching the existing
  CI Node major and locked dependency-install procedure.
- Robots metadata, `robots.txt` and non-production `X-Robots-Tag` discourage
  indexing. These are **not access control**; keep Vercel Authentication enabled.
- Build and server startup fail on an incorrect project reference, unsafe origin,
  privileged public key, missing recovery secret, or operator/database credentials
  in the hosted application. Vercel requires an explicit `APP_ENV`.
- `.vercelignore` excludes dotenv files, local QA/operator state and stale builds.

### Auth and email

Auth Site URL is the dedicated staging origin. The redirect allowlist contains
only its exact `/auth/confirm` and `/auth/recovery` URLs; no production, localhost
or wildcard redirect entries were copied into staging.

Password login is enabled for pre-created synthetic accounts. Public signup and
anonymous/phone providers are disabled. Email confirmation remains required, but
fixtures are explicitly confirmed by the trusted seed operator, never by making
real student registrations auto-confirm.

SMTP is deliberately non-delivering (`smtp.example.invalid`, sender
`staging@example.test`) with synthetic SMTP credentials, not production SMTP.
**Signup, email delivery and recovery-email acceptance are not available in
hosted staging until a test-only email capture provider is configured.** Do not
restore production SMTP to test them. Continue the real SMTP acceptance tests in
the isolated local QA stack. A future authorized capture setup should use only
test recipients and be verified before reopening staging signup.

### Application variables

These six variables were configured as encrypted values for both Preview and
Production targets in the **dedicated staging Vercel project**:

| Name | Staging value / source |
| --- | --- |
| `APP_ENV` | `staging` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://niocptgzzbozpbfzifdk.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | This staging project's public API key; never a secret/service-role key |
| `NEXT_PUBLIC_APP_URL` | `https://uc-online-shop-staging.vercel.app` |
| `AUTH_RECOVERY_SECRET` | Independent randomly generated staging secret |
| `EMAIL_CONFIRMATION_MODE` | `code` |

Vercel's `Production` target within this staging project is **not marketplace
production**. Both targets must always use staging data. Keep `NODE_ENV=production`
for optimized hosted builds; do not invent `NODE_ENV=staging`.

Next.js freezes `NEXT_PUBLIC_*` values during the build. Build separately for each
environment; never promote/reuse `.next` or a prebuilt staging artifact in
production. Changing runtime variables does not rewrite browser bundles.

No database password, service-role key, Management API token or production
credential was placed in Vercel. App data access continues to use session-scoped
clients and existing RLS, not privileged server-side bypasses.

## Safe test data and credentials

The seed created five accounts:

| Synthetic email | Scenario |
| --- | --- |
| `staging-admin@example.test` | Active administrator |
| `staging-pending@example.test` | Pending student and submitted private placeholder |
| `staging-seller@example.test` | Verified active seller |
| `staging-buyer@example.test` | Verified active buyer |
| `staging-suspended@example.test` | Verified but suspended student |

It also created two clearly marked example listings, categories from migrations,
two favorites, a conversation with two messages, an accepted reservation, a
scheduled synthetic meetup, and four submitted verification records. Verification
and listing images are tiny non-sensitive PNG placeholders—not real student IDs.
All accounts have a server-owned `staging_fixture` ownership marker. The seed
refuses existing non-owned users and never imports production data.

New database/recovery secrets and separate strong account passwords were saved
in this Windows user's **Windows Credential Manager**, not plaintext repository
files. Generic credential targets use:

```text
UCMarketplace/staging/niocptgzzbozpbfzifdk/database-password
UCMarketplace/staging/niocptgzzbozpbfzifdk/recovery-secret
UCMarketplace/staging/niocptgzzbozpbfzifdk/account-admin
UCMarketplace/staging/niocptgzzbozpbfzifdk/account-pending
UCMarketplace/staging/niocptgzzbozpbfzifdk/account-seller
UCMarketplace/staging/niocptgzzbozpbfzifdk/account-buyer
UCMarketplace/staging/niocptgzzbozpbfzifdk/account-suspended
```

There is also a name-based bootstrap database-password entry and a project-ref
ownership entry for provisioning recovery. Retrieve credentials privately using
an authorized local credential-manager workflow and transfer them to an approved
password manager before sharing with testers. Never paste passwords/tokens into
chat, issue comments, tracked files, CI output or screenshots.

## Git and deployment rules

1. `feature/*` branches receive implementation work. Current local work is on
   `feature/staging-environment`; review this branch before staging integration.
2. The remote `staging` branch was created from approved `main` baseline
   `249f8fd26098f4ab089010de3091cf3ec22460d9`. It was not populated by silently
   merging the open Step 2 PR. Both branches require PRs and up-to-date successful
   GitHub Actions `local-security`; administrators cannot bypass branch rules.
3. Review/merge the existing Step 2 PR and this staging work through normal PRs.
   Integrate approved commits into `staging`; CI now also runs on pushes there.
   The local implementation includes Step 2 base `44e569902053fb0fb1eec4dad6cdcfbc3118bee2`.
4. GitHub environment `staging` requires approval by `justinedupa2005`, allows
   only the branch named `staging`, and disables administrative bypass. Self-review
   is allowed because this is currently a sole-maintainer repository; approval
   still requires an explicit action. Add independent reviewers as the team grows.
5. The manual **Approved staging database migrations** workflow defaults to a
   read-only plan. After environment approval, it verifies that checkout SHA is
   the current staging head and that the exact commit's latest push CI succeeded.
   An apply run requires explicitly enabling its `apply` input. Migration jobs
   are serialized and are not automatically cancelled mid-migration.
6. Deploy only that approved staging commit to the dedicated Vercel project,
   rebuild with staging variables and confirm authentication on the project and
   deployment URLs before admitting testers. If linking Git later, configure
   `staging` as this project's deployment branch and retain approval gates; do not
   enable broad automatic deployments as a shortcut.
7. Record the tested SHA, migration plan, deployment URL and acceptance results.
   Promote the **source commit**, not its built staging artifact, through a reviewed
   PR to `main` after acceptance and full isolated QA pass. Production provisioning
   and migration authorization remain separate. No workflow here deploys production.

### Remaining CI credential configuration

The GitHub environment was intentionally created **without copying the operator's
organization-wide Supabase login into CI**. Before its migration workflow can run,
create a fine-grained token scoped only to `niocptgzzbozpbfzifdk` with project-read
and database-read/write permissions. Save it as environment secret
`STAGING_MANAGEMENT_TOKEN` under repository Settings → Environments → staging.
The owner subsequently added this secret; its presence and the environment's
approval/branch restrictions were verified. Its encrypted value and actual token
permissions cannot be inspected through GitHub. Validate access with the first
approved read-only plan run (`apply=false`) before authorizing any migration apply.
Rotate/revoke it through Supabase and keep a rotation owner recorded privately.
The workflow fails closed when the secret is missing. It does not need a
production token, database password, SMTP password or service-role key.

## Operator commands

The scripts never infer a target from `.env.local`, `supabase link`, a database
URL or the existing production link. Load secrets privately from the credential
manager into the operator process environment (not Next.js), then set:

```powershell
$env:STAGING_PROJECT_REF = "niocptgzzbozpbfzifdk"
$env:STAGING_ALLOW_MUTATIONS = "1"
# STAGING_MANAGEMENT_TOKEN must already be loaded privately.
npm.cmd run staging:plan
# Only after reviewing the plan and authorizing this staging change:
npm.cmd run staging:migrate
```

The opt-in is required for operator configuration even when requesting a plan;
`staging:plan` itself uses only the read-only query endpoint and changes no schema.
Application build/start processes must not inherit this operator environment.

Migrations keep normal Supabase migration versions, SQL statements and names in
`supabase_migrations.schema_migrations`. An additional private checksum table
detects edited, missing, out-of-order or unrecognized history. Each version and
checksum commit together with its schema change. Do not edit applied SQL, use
`--linked`, blindly retry a timed-out write, repair history automatically, or reset
the database to hide drift. After any timeout run the read-only plan first.

`staging:seed` additionally needs staging-only `STAGING_SERVICE_ROLE_KEY` and
`STAGING_PUBLISHABLE_KEY`. It verifies these keys against the registered project's
API key inventory before any Auth/Storage writes. Pass a JSON object containing
unique passwords for `admin`, `pending`, `seller`, `buyer`, `suspended` through
private stdin from a secret manager. Do not put JSON on the command line or in a
tracked file. The initial seed and a repeat run both succeeded without duplicating
the fixture dataset. It is a bootstrap/retry tool, not a reset of testers' changes.

`staging:verify` accepts the same private stdin account-password object and a
staging public key plus read-capable operator token. It checks live Auth account
states, restricted-user RLS, private verification Storage, bucket visibility and
fixture counts without modifying fixture data. Tests create and revoke their own
login sessions. Successful smoke output contains counts only, not private rows.

## Reset and access procedure

There is deliberately no shared `db reset` or production purge command. Staging
can be discarded independently because it has a separate project, credentials
and fixtures. Before a reset, stop deployments, confirm the exact registered
staging reference and get the owner/testers' approval; retain only authorized
synthetic evidence if needed. If recreating the project, update the reviewed
registry, scoped token, Vercel variables, Auth URLs and credential-manager entries,
then migrate/seed/rebuild and reverify isolation. Do not delete or touch the
existing protected project or real student data. These scripts refuse a replacement
project until its new reference has been explicitly reviewed and registered.

Authorize testers through Vercel access requests, then provide only staging test
credentials. The current Hobby account limits external access; do not purchase a
plan or use a public share/bypass link without the owner's decision. Revoke tester
access when testing ends. Staging SQL/API remains protected by Auth and RLS even
though its Supabase endpoint is network reachable.

## Verification and remaining gates

Recorded on 2026-10-20:

- Dedicated Supabase project healthy, separated from protected existing project.
- Dedicated Vercel project, reserved domain and six encrypted variables configured;
  `All Deployments` authentication verified through its project API.
- All 18 hosted migrations applied and their checksums validated.
- Synthetic seed and repeat seed passed with credentials withheld.
- Hosted live smoke passed: five Auth identities, expected fixture counts, no
  public tables without RLS, pending/suspended listing denial, administrator-only
  access to another student's private verification placeholder.
- TypeScript, ESLint, all 365 regression tests and 535 SQL checks passed.
- Production-mode build using the actual isolated staging app configuration passed.
- A temporary local server using that staging build passed HTTP checks for
  root/login/robots noindex headers, root robots metadata and crawl denial.
- Source/browser boundary and known secret-pattern scans passed.

Release approval still requires PR review, exact-commit CI, staging integration,
an approved read-only CI-token validation and the first protected application deployment.
Until those happen, do not describe this as a live deployed or release-approved
environment. No production deployment or production-data mutation occurred.

References: [Supabase environment separation](https://supabase.com/docs/guides/deployment/managing-environments),
[Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication),
[GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
