# Step 6: production email and account recovery

Status: **partially complete**. Auth policies and managed templates were configured
and read back from the separate staging and production Supabase projects on
2026-10-25. External SMTP authentication, DNS/sender verification and real inbox
acceptance remain deferred by the owner. Production deployment is still disabled.
No external email was sent, hosted account created, invitation issued or hosted
password reset requested during this implementation. Local acceptance uses only
synthetic accounts and captured Mailpit messages.

## Authentication policy

The application and hosted policy use at least **12** characters, with uppercase,
lowercase, a number and a supported punctuation symbol. Whitespace or an emoji
alone does not satisfy the symbol requirement. Registration, recovery and profile
password changes share this policy. The provider's explicit character groups
are generated from the same constants, not a second hand-maintained rule.

Email/password sign-in remains enabled. Email confirmation is required, unverified
sign-in is prohibited, email changes require both inbox confirmations, and password
changes require recent authentication or reauthentication. Refresh-token rotation
is enabled. JWT lifetime is at most one hour and the reuse interval at most ten
seconds; already stricter limits are preserved. Paid session timeouts, single-user
session limits and leaked-password protection are not enabled automatically.
Leaked-password protection is currently disabled on the hosted projects and is
a Pro-or-higher option, not a reason to upgrade without approval.

Staging keeps signup disabled and deliberately non-delivering SMTP. Production's
existing signup setting and saved SMTP provider/credentials are preserved. Email
requests have at least a 60-second per-address cooldown; the management tool sets
an email-volume ceiling of 30/hour while retaining existing lower limits. OTP,
verification and refresh limits are also bounded without increasing stricter
existing settings. Provider account quotas remain an additional independent limit.

Local development keeps captured Mailpit email, eight-digit signup codes, a
60-second OTP expiry, and explicit loopback callbacks. The checked-in local policy
requires secure password changes too. Do not reset an existing development database
to load these settings. Use the disposable QA stack for fresh-config acceptance.

## Templates and support

The owner approved `justinedupa36@gmail.com` as the public support contact. The
managed templates identify **UC Online Shop**, explain the requested action and
unrequested-email handling, use a mobile viewport and contain no identity metadata,
images, trackers or passwords. Support must never request passwords, token links,
verification codes or student-ID photographs by email.

| Template | File | Behavior |
| --- | --- | --- |
| Production confirmation | `supabase/templates/confirmation-link.html` | Typed token-hash link to `/auth/confirm`; independent of the requesting browser |
| Staging/local confirmation | `supabase/templates/confirmation.html` | Eight-digit, one-minute code plus a link to the code-entry page |
| Recovery | `supabase/templates/recovery.html` | Typed token-hash link to `/auth/recovery` |
| Email change | `supabase/templates/email-change.html` | Typed `email_change` link; first inbox confirmation does not create a recovery grant |
| Password-change reauthentication | `supabase/templates/reauthentication.html` | One-use verification code for an existing password-change request |
| Invitation | `supabase/templates/invitation.html` | **Inactive draft**; not applied or enabled because administrator invitations are not implemented |

Production email-token expiry is capped at 15 minutes; staging remains capped at
one minute to match code confirmation. The application separately limits its
signed recovery grant to 15 minutes after successful verification. These are
different expiry windows. Earlier or reused tokens remain subject to Supabase's
one-use checks; the app never manufactures a replacement session after rejection.

Templates are managed in Supabase Auth, not in Brevo/Mailjet marketing campaigns.
Disable email-link rewriting/tracking in the chosen provider before delivery
acceptance. Explicit HEAD handlers do not verify or consume email credentials.
GET prefetchers can still consume one-use links: test actual mailbox scanners;
if affected, a reviewed user-confirmation landing page or OTP flow is required.
HEAD protection is not claimed to solve all mail-security prefetching.

## Exact callback URLs

Staging's Site URL is `https://uc-online-shop-staging.vercel.app`, with only:

- `https://uc-online-shop-staging.vercel.app/auth/confirm`
- `https://uc-online-shop-staging.vercel.app/auth/recovery`

Production's Site URL is `https://uc-online-shop.vercel.app`, with only:

- `https://uc-online-shop.vercel.app/auth/confirm`
- `https://uc-online-shop.vercel.app/auth/recovery`

No wildcard or cross-environment redirects are registered. Neither hosted project
currently has another external Auth provider enabled, so no speculative OAuth
callback was added. Enabling a provider or invitations requires its own reviewed
flow and acceptance tests. Email-change callbacks do not enable a new profile
email-editing feature by themselves.

Both callbacks reject duplicates, mixed token/code provenance, wrong purposes,
malformed values and explicit provider errors before verification. Redirects are
fixed same-origin relative paths; responses are private/no-store, no-referrer and
noindex. Confirmation checks the exchanged user's identity and signs out its
temporary session. The first secure email-change confirmation shows a pending
message without modifying an unrelated existing session.

## Guarded operator workflow

```powershell
npm.cmd run auth:plan -- staging
npm.cmd run auth:plan -- production
```

The operator process needs the selected environment's exact `STAGING_PROJECT_REF`
or `PRODUCTION_PROJECT_REF` and matching private `*_MANAGEMENT_TOKEN`. Supply the
token through an approved credential manager or scoped CI secret, not arguments,
shell history, application dotenv or Vercel application variables. The token needs
project-read and Auth-config read/write permissions for the exact target.

Plans are read-only. Applying requires both `auth:configure -- <environment>` and
`AUTH_SETTINGS_CONFIRM=<environment>:<registered-project-ref>`. The tool pins the
Management API origin and project, rejects redirects, requires healthy services
and the disabled production release gate, and limits writes to reviewed policy
and template fields. It does not configure SMTP credentials, activate signup,
OAuth/invitations or paid features, migrate databases, send messages or deploy.

Before writing, changed settings are backed up in ignored `.qa/` without SMTP
credentials. A single PATCH is followed by read-back and unrelated-setting checks.
Supabase's derived boolean `*_custom_contents` flags may change only for the exact
managed template fields that were written. Other flag or setting changes fail
verification. An ambiguous or incomplete response is never automatically retried;
inspect the read-only plan and private backup first.

## Execution record: 2026-10-25

Initial inspection found staging's password policy weaker than requested and
password-change reauthentication disabled in both environments. Production already
had the 12-character/four-class policy. One settings update per environment applied
the missing policy and branded confirmation, recovery, email-change and
reauthentication templates. Existing exact callback URLs, SMTP credentials and
signup restrictions were not included in the changes.

The updates initially reported an unrelated change because Supabase updates derived
custom-template metadata. Read-only follow-ups confirmed both environments had
**no pending managed settings**. The verifier was corrected to recognize only the
precise derived flag changes; regression coverage still rejects changes to SMTP,
signup, invitations and unmanaged flags. No settings write was repeated. Private
pre-change snapshots are retained in ignored `.qa/`.

Application recovery now returns the same public result for every syntactically
valid email, including nonexistent accounts, provider throttles and transport
failures. Diagnostics contain only bounded status/code metadata. Invalid input
is rejected locally and a request is never automatically retried. This establishes
response-content consistency, not a proof that every timing or provider-level
enumeration side channel has been eliminated.

## Local verification: 2026-10-25

Fresh full disposable-stack QA passed, including:

- TypeScript, ESLint, all **410** regression tests and source security checks.
- **20** migrations, **535** embedded SQL assertions, **36** live messaging
  assertions and **129** native catalog/security assertions.
- **253** direct API checks, **3** concurrency scenarios and **4** Realtime scenarios.
- **12** real locally captured SMTP/Auth checks using the checked-in templates.
- All **46** Chromium tests: **40** anonymous and **6** authenticated/recovery.
- Four additional compiled-server HTTP checks: both HEAD callbacks return 405
  without verification; ambiguous confirmation and error-bearing recovery queries
  return fixed same-origin error redirects with no-store/no-referrer/noindex headers.

Only the owned disposable project `ucmarketplace-qa-8248141e2b9b3934` was stopped;
its synthetic fixtures were cleaned up and ignored scratch evidence/backups were
retained. Development and hosted projects were not reset or reused. The sanitized
result is `.qa/stack-ob3Qos/acceptance-summary.json`, with `status=passed`,
`smtp=passed_local_capture`, `externalEmailDelivery=not_run`,
`deployedAcceptance=not_run` and **`releaseReady=false`**.

The initial full-QA aggregate regression phase exceeded its three-minute budget.
A direct unchanged run passed **410/410** in **201.6 seconds**. The QA launcher now
uses the same one-worker setting as `npm test` and a bounded five-minute aggregate
budget. Individual test timeouts and assertions are unchanged; no tests were
filtered, disabled or skipped. The subsequent complete disposable run passed.

A subsequent normal local-target production-mode build also passed, replacing
the disposable QA build artifact. Environment preflight and browser-bundle
security checks passed across **223** source modules and **48** browser chunks.
The final secret-pattern review covered **456** current files and **794** historical
blobs with no known-pattern findings. `production.deploymentEnabled` remains false.
Publishing the reviewed source does not approve a production deployment.

## Remaining acceptance gates

Do not mark the following complete based on templates, configuration read-back,
mock tests or local Mailpit delivery alone:

- [ ] Choose/verify the actual SMTP provider, sender, sending domain and DNS
  authentication (SPF, DKIM and appropriate DMARC); review existing DNS before edits.
- [ ] Explicitly approve resuming external SMTP testing and confirm one real inbox
  delivery. No previous single-email approval is reusable.
- [ ] With consenting test accounts, verify registration, confirmation, password
  recovery/update, expired and replayed links and secure email changes end to end.
- [ ] Check personal email providers, mobile browsers and email-security scanners,
  including spam placement. Do not require university-issued email addresses.
- [ ] Check a nonexistent account, invalid/unreachable address, sending quotas and
  deliberate retry behavior. A public success notice does not promise delivery.
- [ ] Review provider logs without publishing tokens, mailbox contents or identities.
- [ ] Test isolated staging and an explicitly approved protected production
  configuration; deployment remains a separate approval.

References: [Supabase password security](https://supabase.com/docs/guides/auth/password-security),
[email templates](https://supabase.com/docs/guides/auth/auth-email-templates),
[custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls),
[Auth configuration API](https://supabase.com/docs/reference/api/v1-update-auth-service-config).
