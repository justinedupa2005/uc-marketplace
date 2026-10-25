# Step 5: application deployment configuration

**Current checkpoint (2026-10-25): partially complete.** Application environment
configuration and safeguards are implemented, but the owner explicitly deferred
external SMTP authentication/delivery work to continue other preparation. Email
confirmation remains required, production deployment remains disabled, and
successful external delivery plus end-to-end Auth email acceptance are still
release gates. The historical execution records below do not mark those gates
complete.

The application uses the existing names below. Do not introduce
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, or duplicate aliases.
The publishable-key variable may hold a legacy **anon** JWT for the selected
project; never a service-role JWT. New publishable keys are also supported.

| Variable | Visibility | Local | Staging | Production |
| --- | --- | --- | --- | --- |
| `APP_ENV` | Server/build configuration | `local` | `staging` | `production` |
| `NEXT_PUBLIC_SUPABASE_URL` | Public, frozen at build | `http://127.0.0.1:54321` | Registered staging project | Registered protected production project |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public, frozen at build | Local stack public key | Staging public/anon key | Production public/anon key |
| `NEXT_PUBLIC_APP_URL` | Public, frozen at build | `http://localhost:3000` | `https://uc-online-shop-staging.vercel.app` | `https://uc-online-shop.vercel.app` |
| `AUTH_RECOVERY_SECRET` | Server-only, hosting **Secret** | Independent persistent local value | Independent persistent staging value | Independent persistent production value |
| `EMAIL_CONFIRMATION_MODE` | Server-only configuration | `code` | `code` with configured test template | `link` until production SMTP/template is approved |

`NODE_ENV` is managed by Next.js (`development`, `production`, `test`), not a
replacement for `APP_ENV`. Vercel provides `VERCEL`, `VERCEL_ENV` and, where
available, `VERCEL_PROJECT_ID`; these are checked but are not manually duplicated.
Only Vercel's 16 documented public Next.js metadata names are accepted in addition
to the three application public variables. An arbitrary `NEXT_PUBLIC_VERCEL_*`
credential alias is not exempt; privileged values remain forbidden in metadata.
No application code needs `SUPABASE_SECRET_KEY`, a service-role key, direct
database credentials, Management API tokens, SMTP passwords or GitHub tokens.
Server Actions and administrator operations use the student's authenticated
session plus database authorization, not an RLS-bypassing key.

## Local development

```powershell
npm.cmd run env:local -- --start
npm.cmd run env:check
npm.cmd run dev
```

Docker must be local; remote Docker overrides are refused. The setup uses only
local CLI `start`/`status`, never `link`, `push`, `reset` or `repair`. It does not
discard development records. `--start` initializes a fresh local database with
the committed migrations, or starts the existing local project without a reset.
Omit `--start` to configure from an already-running local stack.

The generated `.env.local` is ignored by Git. Only the six application settings
are mechanically replaced; unrelated settings remain. A preexisting file is
backed up once to ignored `.qa/local-env-before-step5.backup`. Treat that backup
as private, do not upload it, and do not restore a hosted student-database target
to local development. The safe committed `.env.example` contains no credentials
and is intentionally insufficient for a valid deployment.

Local recovery keys are generated once, then preserved, including quoted existing
values. Invalid or duplicate recovery assignments require review; setup never
silently rotates them. Local captured email is not proof of external delivery.

## Vercel separation

The public project/origin registry is `config/environments.json`. Do not change
references merely to bypass validation. Dedicated Vercel projects isolate scopes:

- `uc-online-shop-staging`: both Vercel Production and Preview targets use
  `APP_ENV=staging` and the staging database. "Production" here is a hosting
  target name, not permission to use the real production database.
- `uc-online-shop`: only its Production target receives production settings.
  No production credentials are configured for Preview or Development. Build and
  startup validation reject hosted production settings in either of those
  targets, as well as an unspecified hosting target.
- Local development uses `.env.local`, not pulled production credentials.

Both projects require All Deployments authentication and no Git deployment
connection during setup. No CLI deployment, Git connection, production database
restore/migration or public access change is part of this step. The registry's
`production.deploymentEnabled` remains **false**. Next build and server startup
reject production until a later explicitly approved release changes this flag.

The guarded Windows operator tool `scripts/deployment/vercel.mjs` uses the
existing signed-in Vercel CLI and exact registered project/team IDs. Configuration
arrives through private stdin, never command arguments. It checks protection,
rejects unexpected/branch-scoped overrides, scopes the six variables, and stores
the recovery key as write-only Secret (`sensitive` in the API). Repeat runs do
not overwrite an existing write-only recovery secret. Provider errors and
responses are captured privately; output is bounded metadata only.

When production's registered database is inactive, `prepare production` accepts
only the five available settings and deliberately leaves its public API key
unset. It is permitted only with the production release flag disabled. No fake,
staging or historical key is substituted. Complete validation/builds cannot pass
until an authorized operator provides a verified production public key later.

Public URL/key configuration is readable **Config**, not a credential secret.
A publishable key's opaque text does not identify its project; the operator must
obtain it from the selected project's API settings and test actual connectivity.
Legacy anon JWT claims are inspected for role/reference as a configuration check,
not a substitute for cryptographic authentication by Supabase.

Always build separately for local, staging and production. Next.js embeds
`NEXT_PUBLIC_*` values into browser bundles at build time. Changing runtime
variables or promoting an already-built staging artifact does not retarget that
bundle. Update hosting settings first, then perform a new reviewed build.

## Fail-safe checks

`next.config.ts` validates before a build; instrumentation repeats validation on
server startup. `env:check` loads dotenv using installed Next.js conventions and
performs the same configuration checks without printing values or fingerprints.
It always uses **production-build** dotenv precedence (`.env.production.local`,
`.env.local`, `.env.production`, `.env`, with existing process variables winning),
even when the calling shell sets `NODE_ENV=development` or `test`. This prevents
development/test files from concealing an invalid build target. `NODE_ENV=production`
does not select the production database: `APP_ENV` still selects local, staging
or production independently.

Checks reject missing critical values, malformed/deceptive URLs, non-HTTPS hosted
origins, wrong project/origin/hosting bindings, duplicate staging/production
database references, local-to-hosted connections, unknown email modes, unreviewed
public variable names, privileged keys/operator credentials, and obvious
placeholder public keys/recovery secrets. Recovery secrets must be 32-64 random
bytes encoded as an even-length 64-128-character hex string. Low-diversity or
repeated placeholders fail; validation cannot prove randomness.

## Recovery secret purpose and controlled rotation

This app does require `AUTH_RECOVERY_SECRET`: after Supabase verifies recovery
provenance, it signs a canonical, user/session-bound application grant with a
15-minute lifetime. It is not a replacement for Supabase tokens or signing keys.
The signing code is `server-only`; no secret is put in Next config's `env`, a
`NEXT_PUBLIC_*` variable, logs, Git, screenshots, browser state or build artifacts.

Generate each environment's key with a cryptographic RNG once. Store the hosted
value as a Vercel Secret and a restricted credential-manager recovery copy.
Reapply/redeploy using the same value. Never regenerate on restart or routine
deployment. Staging and production must not share keys.

For an authorized rotation:

1. Schedule the change; expect active password-reset grants to become invalid.
2. Generate a new independent value privately and retain a restricted recovery
   copy; do not print it in terminal output or chat.
3. Update only the intended environment's hosting Secret. Do not change Supabase
   JWT/API credentials, other environments or the public deployment target.
4. Redeploy the reviewed source in that environment and drain old instances.
   All active instances must use the same new value; do not mix generations.
5. Verify a newly requested recovery flow, expiry, session binding and browser
   bundle secrecy. Users with old reset sessions must restart recovery.
6. Revoke/archive the old key after the testing/rollback window. If compromised,
   never roll back to it; deploy rollback source with the new secret instead.

## Release boundaries

Configuring variables is not a production release. Production database health,
custom SMTP delivery/templates/redirect allowlists, protected staging browser
acceptance, exact-commit CI and explicit release approval are separate gates.
Do not unpause, migrate or deploy production merely to mark this step complete.

## Execution record: 2026-10-22

- Local Supabase development is running on its normal loopback ports. Ignored
  `.env.local` no longer targets the protected hosted database. Configuration and
  repeat configuration pass `env:check`; the independent local recovery value
  persists and the previous configuration remains in the ignored private backup.
- Staging's six variables are scoped to its dedicated hosting project's
  Production/Preview targets. Its existing recovery value was verified privately
  before being reclassified as write-only Secret; it was not rotated. The actual
  staging production-mode build and browser-bundle security checks pass.
- The separately created production Vercel project is
  `prj_LkkGMGxnMKUEunqs8ZyZ8Y4VWNAF`; the requested
  `https://uc-online-shop.vercel.app` domain is reserved. All Deployments
  authentication is enabled, no Git deployment connection exists, and nothing
  has been deployed. Node 22, `npm ci`, and the reviewed build command are set.
- Production's five available variables are scoped only to its Production target.
  Its recovery Secret is independently generated, persistent, and different from
  staging's; the restricted recovery copy is in Windows Credential Manager.
- The protected production Supabase project reports **INACTIVE** and returns no
  usable public API key through the operator API. The owner explicitly chose to leave it inactive. Its app public
  key remains unset, and `production.deploymentEnabled=false` independently blocks
  builds/startup. No production database restore, unpause, migration, or data
  mutation occurred. Production connectivity is intentionally not certified.

The QA launcher accepts only the legitimate app-owned `AUTH_RECOVERY_SECRET`
dotenv name; fixture/operator secret names remain forbidden. It strips inherited
secrets, supplies fresh run-owned recovery keys and explicit local configuration,
and never forwards recovery keys to browser workers. Strict validation exposed
an older empty QA public-key placeholder; pre-stack quality gates now use an inert
non-secret local key, and real acceptance uses the owned stack's actual key.
The existing positive recovery-browser test also caught Playwright reloading
the developer's dotenv after worker environment filtering. Explicit isolated QA
now skips that reload; the unchanged recovery test still requires the signing
secret to be absent from its worker. No test or credential-isolation assertion
was disabled to accommodate the new local configuration.

Final isolated local QA passes: route generation, TypeScript, ESLint, all **388**
regression tests, **535** SQL assertions across **20** migrations, **129** native
security assertions, the **36**-assertion messaging gate, **253** API/Storage checks,
three concurrency scenarios, four Realtime scenarios, **12** local SMTP/Auth
checks and all **46** browser tests. The positive recovery browser test now passes
with the signing secret absent from its worker. The owned QA stack stopped
successfully; the separate local development stack was not reset or reused.
Known-pattern scans pass **444** current files and **775** historical blobs;
these scans cannot prove the absence of every possible credential format.
No code was pushed, application deployed, or production release approved.
The final staging build, temporary local staging HTTP/startup/noindex smoke and
browser-bundle checks also pass. Environment-specific builds must not be promoted
as prebuilt artifacts into another environment; use a fresh build with that
environment's configuration, including before running `npm.cmd start` locally.
The workspace was then restored to a fresh local-target production-mode build;
its build, browser-bundle scan and `env:check` all pass. The remaining generated
artifact targets local development, not the stopped QA stack or staging.

## Follow-up verification: 2026-10-24

The preflight previously defaulted to development dotenv files before validating
production-build requirements. A regression test reproduced a false pass when
development settings were valid but `.env.production.local` targeted the wrong
database. `env:check` now loads the same production-mode dotenv precedence as a
normal build, independent of the shell's `NODE_ENV`. Another regression guard
rejects production settings in Vercel Development or unspecified targets.

All **55** targeted deployment, staging and QA-isolation tests pass, including
the actual Next configuration's production release block. TypeScript and ESLint
pass. The initial unrestricted full regression run hit compiler and schema-replay
timeouts; two workers resolved schema replay but still overloaded the compiler.
The clean-checkout compiler test passed in isolation. The normal `npm test`
command now runs one worker, and all **390** tests pass, with **zero** failures,
cancellations or skips. No test assertions, timeout limits or coverage filters
were relaxed. The fresh local-target production-mode build passes, as do
`env:check`, the **221**-module/**48**-chunk security audit and the **444**-file
current-tree secret-pattern scan. Historical blobs were not rescanned today.

An initial read-only Vercel inventory request timed out. Subsequent inspection
of **both** dedicated projects succeeded: each remains protected with no Git
deployment connection and no deployment. Staging retains all six correctly
scoped settings and its write-only recovery Secret.

The owner subsequently explicitly authorized restoring **only** the existing
production Supabase project, with application deployment still disabled. After
verifying its exact project/organization identity, isolated staging reference,
inactive state and existing free plan, a single resume request was sent. A
read-only follow-up observed `COMING_UP`, then `RESTORING`, and finally
**`ACTIVE_HEALTHY`**. The resume request was not retried after the provider
returned an empty successful response. No database migrations, resets, data
edits, billing changes, credential rotations or deployments were requested.
Restoring existing services is not release approval or security acceptance of
the existing production schema/configuration.

The restored project's public key was retrieved privately from its own API
settings and accepted by its Auth health/public-settings endpoints (HTTP 200).
All six production application settings were then configured and verified in
its dedicated Vercel project's **Production target only**. Its existing recovery
Secret was preserved, remains write-only, and is distinct from staging's. No
privileged Supabase credential was added to either application's environment.
`production.deploymentEnabled=false` still blocks production build/startup even
though the application variables now pass configuration validation.

At the initial inspection, production Auth URLs did not match the registered
origin and custom SMTP was not yet configured. The owner subsequently approved
the URL-only update and reported configuring Brevo SMTP directly in Supabase.
Fresh metadata confirmed Brevo's relay, a supported port, configured credentials
and the owner's expected sender. These settings were not overwritten.

Only `site_url` and `uri_allow_list` were patched and read back successfully:
the Site URL is `https://uc-online-shop.vercel.app`, and the redirect allowlist
contains exactly its `/auth/confirm` and `/auth/recovery` URLs. A recoverable copy
of only the previous public URL fields is retained in ignored
`.qa/production-auth-urls-before-step5.json`. SMTP fields, signup policy and
confirmation/recovery templates were compared before and after and are unchanged.
No SMTP credentials were printed or persisted in the repository.

The owner separately approved one plain SMTP test to their own Gmail address,
without account creation or password-reset links. TLS connection and certificate
validation succeeded, but Brevo rejected authentication with SMTP **535**. The
failure occurred before message submission: **no email was sent**. Primitive-only
evidence is retained privately, and an exclusive per-approval journal prevents
an accidental repeat. No automatic retry, credential rotation or SMTP setting
change was made. The owner needs to verify the saved SMTP login/key against
Brevo's SMTP settings; authentication and inbox delivery remain unverified.
Brevo's guidance distinguishes SMTP keys from API keys and account passwords.
Gmail-based sender-domain authentication/deliverability also needs review before
launch; the sender was preserved, not silently replaced.

After the owner reported saving corrected credentials and explicitly approved
one new test, a separate approval journal was created without overwriting the
original evidence. The new connection again verified TLS but failed SMTP
authentication with **535**, before message submission. No email was sent and no
SMTP settings were changed. No automatic retry followed. Read-only checks did
not identify a common password-mask marker; they cannot independently prove
that a saved provider credential is usable. The direct SMTP probe does not
certify Supabase Auth's server-side delivery or determine which credential or
provider-account restriction caused the rejection. Brevo login/key status still
requires private provider-side verification; deployment remains disabled.

Anonymous REST metadata access returns HTTP **401**; this remains recorded as
unverified production database/application compatibility, not bypassed by
weakening permissions or using a privileged application key. Authorized
production migration/security acceptance and deployed browser/email acceptance
remain separate release gates. No student records were read, Auth accounts
created, recovery links sent, database permissions changed or deployment enabled.

The 2026-10-22 full-stack QA results above are historical evidence, not a new
hosted or full-stack acceptance run today. No changes have been committed or
pushed and no application has been deployed.

## SMTP authentication follow-up: 2026-10-25

The owner reported creating a new active Brevo SMTP key, saving it in production
Supabase and verifying the exact SMTP login. A newly approved authentication-only
check verified the production project identity, healthy state, disabled release
flag and an exact match to that login. TLS certificate validation succeeded, but
Brevo again rejected SMTP authentication with **535**.

This check had no message submission path: no email was sent, inbox delivery was
not tested, and no Auth accounts or recovery requests were created. No SMTP
settings, templates, database permissions, Vercel settings or deployment approval
were changed. Primitive-only private evidence was retained under a fresh
per-approval journal; no automatic retry was made. Authentication remains
unresolved, and production deployment remains disabled. Even a future successful
SMTP authentication check will not itself certify email delivery or approve a
production release.

A second explicit owner approval followed another reported active-key update
on the same day. The fresh configuration again matched the specified SMTP login
and passed TLS verification, but the new authentication-only attempt returned
**535**. Its separate approval journal preserves both results. No message was
submitted, no configuration was changed and deployment remained disabled.

## Gmail SMTP follow-up: 2026-10-25

The owner replaced Brevo with Gmail SMTP and a Google App Password directly in
Supabase, then authorized one new authentication/email-delivery test. Read-only
checks verified the exact healthy production project, separate staging project,
disabled release flag, `smtp.gmail.com`, port **587**, an email-shaped account
login and the previously approved sender/recipient. The saved account login is
different from the recipient address; this alone is not an authentication error.
Credentials were used as saved, without trimming, truncation or disclosure.

The single SMTP connection passed STARTTLS and certificate verification, but
Gmail rejected the single AUTH attempt with SMTP **535** at
`2026-10-25T06:23:39Z`. No message-submission command was attempted, so **no email
was sent** and inbox delivery remains unverified. Primitive-only evidence is
retained in an ignored, exclusive per-approval journal; no automatic retry was
made. No SMTP configuration, Auth accounts/templates, database permissions,
Vercel settings or deployment approval were changed. Production deployment is
still explicitly disabled.

The owner should privately verify that the saved full SMTP account email is the
same Google account that generated the App Password, and that the saved password
is that App Password rather than the regular account password. This result does
not establish which saved credential or provider restriction caused the failure,
and it does not test Supabase Auth's own hosted email-delivery path. A new email
attempt requires fresh owner approval after any correction.

## Pre-push verification: 2026-10-25

After the owner deferred SMTP and requested a GitHub push, fresh checks passed:
TypeScript, ESLint, all **390** regression tests, local environment preflight,
the optimized production-mode build targeting **local** Supabase, and security
checks across **221** source modules and **48** browser chunks. The repository
secret-pattern scan covered **444** current files and **794** historical blobs.

An initial restricted-shell test run failed seven Windows process-cleanup
assertions. All **17** process-lifecycle tests then passed with the required
process permissions, followed by the complete **390/390** regression run. No
assertions were changed, disabled or skipped. These local results do not certify
GitHub CI, hosted acceptance or external email delivery. No new SMTP attempt,
hosted migration, application deployment or release enablement was requested.

References: [Next.js environment variables](https://nextjs.org/docs/app/guides/environment-variables),
[Vercel Config/Secret variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables),
[Vercel environments](https://vercel.com/docs/deployments/environments),
[Vercel framework metadata](https://vercel.com/docs/environment-variables/framework-environment-variables),
[Supabase API key privileges](https://supabase.com/docs/guides/getting-started/api-keys),
[Brevo SMTP setup](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP),
[Brevo SMTP authentication troubleshooting](https://help.brevo.com/hc/en-us/articles/115000188150-Troubleshooting-Issues-with-Brevo-SMTP),
[Brevo sender-domain guidance](https://help.brevo.com/hc/en-us/articles/35852083084178-Domain-setup-for-better-email-deliverability),
[Google SMTP errors](https://support.google.com/mail/answer/3726730),
[Google App Passwords](https://support.google.com/accounts/answer/185833).
