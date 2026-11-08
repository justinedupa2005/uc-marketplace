# Monitoring and incident response (Step 9)

## Activation checkpoint: 2026-11-08

Backup recovery now has a passing hosted exact-bundle receipt; see the backup
guide. Monitoring and alerts are **still disabled**, independently of backup
schedule preparation. The owner requested activation only after delivery testing.
Add these new, dedicated credentials only as protected `staging-operations`
environment secrets, never in browser configuration or repository-level secrets:

- `OPS_MANAGEMENT_TOKEN`: staging-only project/log telemetry read permissions;
  do not reuse the database-write migration token or a broad personal token.
- `OPS_VERCEL_TOKEN`: least-privilege access to the registered staging deployment
  and runtime logs. If the account cannot restrict it appropriately, stop and
  review an alternative instead of silently storing broad production access.
- `OPS_BREVO_API_KEY`: transactional API key, not an SMTP password, for the
  approved sender and recipient `ucmarketplace.security@gmail.com`.

Run `monitor` without notification after current staging CI, then the separate
one-message `alert-test` behind owner review. Confirm inbox/spam arrival with the
recipient; HTTP 201 alone is insufficient. Only then enable monitoring policy and
repository gates `STAGING_MONITORING_ENABLED`, `STAGING_ALERTS_ENABLED`, and
`STAGING_ALERT_DELIVERY_CONFIRMED`. Preserve required reviews and independently
review deduplication/alert cooldown before recurring notification activation.
The credential-free main scheduler queues only reviewed staging jobs, and skips
additional dispatches while a manual staging workflow is still outstanding.
Do not describe this attended schedule as continuous unattended monitoring.

The remainder of this guide includes historical preparation notes.

Implementation is available; continuous monitoring and notifications are **not
activated** until the owner approves their destination, operators and deployment.
Production remains blocked. No test email or incident notification has been sent.

The owner selected **ucmarketplace.security@gmail.com** as the incident alert
recipient; it is recorded in `config/operations.json`. An email address is not
an alert transport: an approved email/webhook-to-email delivery service, sender
credentials, consented delivery test and escalation ownership are still needed.
Do not reuse or modify production Supabase SMTP for operational alerts. The
existing optional webhook sends only to a separately approved endpoint; it does
not send mail merely because `alertEmail` is configured.

On 2026-11-01 the owner authorized implementation and alert testing and selected
**Brevo** for operational alerts and confirmed the verified sender as
`ucmarketplace.security@gmail.com`, also the approved recipient. The dedicated
API key still needs confirmation; no delivery test has run. `monitoringApproved` is
recorded; `monitoringEnabled`, external notifications and the repository schedule
gates remain disabled. No provider account, paid subscription, SMTP change or
production deployment was inferred from that approval.

The protected backup workflow now offers manual `monitor` and `alert-test`
operations and a guarded 15-minute monitoring trigger. Configure operator-only
`OPS_MANAGEMENT_TOKEN` (staging-scoped read permissions), `OPS_VERCEL_TOKEN`
(least-privilege monitoring access) and, after provider selection,
`OPS_BREVO_API_KEY` in `staging-operations` (`OPS_ALERT_WEBHOOK_URL` is only for a
separately approved generic webhook alternative). Never copy a broad personal
management credential into CI merely because it works locally. The pinned
Vercel 50.14.0 operator CLI installs before secrets and receives only its own
credential, not database, Storage or repository secrets. Missing telemetry fails
visibly rather than passing as healthy.

### Selected Brevo transport

Set `alertSenderEmail` to the owner's approved, verified Brevo sender and confirm
`alertSenderVerified` only after verification. Store a dedicated **API key**, not
an SMTP key, as `OPS_BREVO_API_KEY` in `staging-operations`. Restrict it to the
transactional-email permissions needed for sending where the account supports
this. Do not reuse production Supabase's SMTP settings or regenerate its keys.
The API origin/path is pinned to `https://api.brevo.com/v3/smtp/email`; code accepts
no alternate URL and never follows redirects or retries a send. The payload has
only the approved sender/recipient, a fixed staging subject, time and allowlisted
operational codes. No identities, messages, tokens or ID images are sent.
[Brevo transactional API](https://developers.brevo.com/docs/send-a-transactional-email)
and [API key permissions](https://help.brevo.com/hc/en-us/articles/40158277171474-About-API-key-permissions).

Dispatch `alert-test` through the staging QA launcher's `staging_operation` after
the exact staging commit passes CI. The dedicated reviewed `alert-delivery` job
receives **only** the Brevo credential: no database, Storage, backup-vault,
Supabase management or Vercel secrets are released to it. This operation is
independent of the disabled monitoring/daily-backup schedule flags. It sends at
most one synthetic message to `ucmarketplace.security@gmail.com`. HTTP 201 proves
acceptance, not inbox arrival; record the recipient's inbox/spam confirmation.
On an ambiguous timeout inspect Brevo privately before authorizing another test.

`npm.cmd run ops:alerts:test` sends at most one fixed synthetic test event to the
exact approved HTTPS origin, requires `OPS_ALERTS_ENABLED=1` and
`OPS_ALERT_TEST_CONFIRM=ucmarketplace.security@gmail.com`, follows no redirects
and never retries automatically. A successful HTTP response means **provider
acceptance**, not inbox delivery; the recipient must confirm delivery. No test
request is sent while the selected transport is unconfigured. Review cooldown,
deduplication, acknowledgement and recovery notification in the selected service
before enabling `STAGING_ALERTS_ENABLED` and `STAGING_MONITORING_ENABLED`.
The required reviewer checkpoint applies to monitoring schedules as well;
there is no automatic self-approval or promise of unattended monitoring.

## Signals and safe collection

`npm.cmd run ops:monitor` reads only registered staging. Supply operator-only
`OPS_ENV`, `OPS_PROJECT_REF`, `OPS_DATABASE_URL` and `OPS_MANAGEMENT_TOKEN` from
a secret manager; monitoring does not need a Storage service key. Use the existing
Vercel CLI login or inject `OPS_VERCEL_TOKEN` privately, with `OPS_VERCEL_CLI`
pointing to the reviewed CLI entry when not using the local installation.
The approved backup repository credentials allow freshness verification.

The monitor checks:

| Signal | Observation / initial threshold |
| --- | --- |
| Deployment | Registered protected Vercel project; canonical artifact must be READY |
| Runtime | Last 15 minutes; errors and HTTP 5xx; a 1,000-entry capped sample is incomplete, not healthy |
| Database | Connectivity, database bytes, connections/max, active queries older than 30 seconds, cumulative deadlocks |
| Capacity | Review at 80% of configured database/Storage budgets; initial conservative budgets are 500 MB / 1 GB |
| Authentication | At least 20 requests, 10 failures and 20% failure ratio in 15 minutes triggers review |
| SMTP | Recorded Auth email/SMTP errors; zero errors is not proof of inbox delivery |
| Storage | Stored bytes plus recorded upload/access service errors; never download IDs for health checks |
| Realtime | Recorded Realtime errors and database connection count; not a count/test of connected browser clients |
| Reservations | Failed reservation/acceptance/meetup/sale RPC requests; investigate expected conflicts separately from outages |
| Traffic | 10,000 gateway requests per 15 minutes prompts review; tune to actual authorized traffic |
| Backups | Decrypt and validate the latest completion manifest and its referenced component snapshots; stale after 26 hours |

Budgets are operational review thresholds, not a provider billing guarantee.
Deadlocks are cumulative; a nonzero lifetime counter must not be interpreted as
a current spike. Empty log windows mean no matching recorded events, not that
every workflow or provider was exercised. Realtime client usage, latency trends,
query plans, and provider quota limits still need review in Supabase Reports.

The Supabase collector uses the current ClickHouse `logs` endpoint, an explicit
15-minute window and fixed aggregate queries. It never selects user identities,
IP addresses, query text, message bodies, tokens or school-ID paths for output.
Missing/unauthorized telemetry is visible and cannot yield a passing health
result. `attention_required` exits nonzero so a scheduler can alert on failure.
[Supabase queries](https://supabase.com/docs/guides/observability/advanced-log-filtering),
[field reference](https://supabase.com/docs/guides/observability/log-field-reference),
[Reports](https://supabase.com/docs/guides/observability/reports).

Next.js `onRequestError` reports fixed event codes and route groups, never the
exception message/stack, request URL/query, cookies, headers, user identity or
error digest. The server Supabase adapter records failed status/service only,
preserves response bodies for the SDK, and removes arbitrary transport error
messages before they can become uncaught app diagnostics. Registration/recovery,
login, reservation and avatar-upload failures emit allowlisted operational
events. Existing authorization and generic recovery responses are unchanged.

These application controls do not rewrite provider-managed logs. Restrict access
to Vercel/Supabase logs, never add form/body/query/session dumps, and privately
review their retention/redaction settings. The new app hooks require an approved
deployment before they exist in hosted runtime logs; a successful local build is
not a deployment claim. Built-in dashboards are available, with plan-dependent
retention and features. No paid monitoring add-on was enabled.
[Vercel observability](https://vercel.com/docs/observability),
[Next.js instrumentation](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).

## Activate monitoring and alert delivery

1. Use the recorded sole incident responder and document the no-deputy coverage
   risk. Approve a notification channel and a reliable runner. Do not rely on a
   developer laptop staying on.
2. Deploy the reviewed logging changes to staging through normal protected CI
   after explicit deployment approval; retain staging access controls.
3. Schedule the monitor every 15 minutes on the approved secure operator runner.
   Inject credentials only in that process, never application builds. Route its
   exit code and sanitized JSON to the existing alerting platform. No monitor
   schedule is active merely because this guide exists.
4. For direct webhook delivery, register its exact HTTPS origin in
   `config/operations.json`, set `monitoringEnabled: true`, store the secret URL
   as operator-only `OPS_ALERT_WEBHOOK_URL`, and explicitly set
   `OPS_ALERTS_ENABLED=1`. Run `npm.cmd run ops:monitor -- --notify` only after the
   channel owner consents. Payload: fixed application/environment/time/incident
   codes only. Redirects are refused; failed sends fail visibly and are not
   automatically retried. No SMTP configuration is needed for this webhook.
5. Test both a controlled failure and recovery, acknowledgement/escalation,
   duplicate suppression and quiet periods in the chosen alerting service.
   Keep notification throttling/cooldown there; the CLI is stateless and must not
   be scheduled to spam a mailbox/webhook. Missing heartbeat/workflow failures
   need an independent monitor, because a crashed monitor cannot notify itself.
6. Review dashboard health daily, auth/security patterns daily, performance and
   capacity weekly, and restore evidence monthly. Save only sanitized metrics;
   restrict raw investigations to authorized responders.

Read-only collection on 2026-10-29 succeeded for database, Supabase aggregate
logs and Vercel. It correctly flagged the unconfigured backup destination and
sent no alerts. This is a successful probe, not continuous monitoring sign-off.

## Incident ownership and communication

The confirmed sole owner and incident responder is `justinedupa2005`; no deputy
is assigned because this is a solo-maintained project. This is not a technical
blocker, but unavailable or locked-out owner access can delay recovery. Keep
repository-password custody and account recovery material separately protected;
review a trusted emergency contact when practical. The backup policy approval
does not activate monitoring, notifications or incident recovery actions.

The on-call responder investigates, the incident commander approves state-changing
recovery, and the privacy/security owner approves handling of identity documents
and affected-user communications. These responsibilities are currently held by
the same sole maintainer; they are not additional application/database roles.
No action is automatically authorized merely because it appears in a runbook.

Open a private incident record with a UTC timeline (also record local PHT),
environment, symptoms, severity, affected feature groups, backup/deployment
identifiers, assigned owner and next update time. Never attach student IDs,
passwords, full tokens, private chats or raw credential-bearing logs.

| Incident | Initial investigation | Controlled recovery / checks |
| --- | --- | --- |
| Database unavailable | Check provider status, read-only connectivity, connection pressure and last deployment | Pause approved writes if necessary; provider support or isolated recovery; recheck RLS and transaction workflows |
| Accidental deletion | Identify scope/time and last complete database + file bundle; preserve evidence | Restore into a new approved isolated target; compare data/relationships and recover corresponding bytes; separately approve live promotion |
| Auth outage | Auth API/error counts, provider status, callback/env mismatch and rate limits | Preserve generic public errors; never disable confirmation/RLS; validate sign-in/recovery with consenting testers after authorization |
| Credential exposure | Identify exact key/environment and contain further disclosure | Revoke/rotate only affected credentials in their provider, update correct secret scopes, assess sessions/recovery impact and audit access; never paste keys into incident records |
| Storage access/upload failure | Bucket privacy, policy changes, object existence, size/type constraints and quota | Preserve private access; recover bytes/ownership through supported tooling; verify admin/owner access and outsider denial |
| Suspicious accounts/traffic | Aggregate patterns then narrowly authorized account/audit review | Use existing moderation controls for confirmed accounts, preserve evidence and review session/key compromise; no bulk suspension without approval |
| Failed deployment | Exact source/CI, build/runtime, environment, migrations and previous artifact | Block promotion; review rollback compatibility before changing aliases/artifacts; never restore an older database over newer data automatically |

For a critical incident, acknowledge promptly, identify the responsible commander
and any available backup contact (currently none is assigned), and state
the next update time; initial operating targets are 15-minute acknowledgement
and 30-minute status updates while active, subject to confirmed staffing. Use
the approved support/status channel for a minimal service-impact update. The
commander and privacy owner determine affected-user notices and applicable
obligations with qualified advice; do not publish identities or speculate about
exposure. Confirm a recovery update after evidence passes, then record the cause,
scope, timings, data loss/recovery point, follow-up owner and regression test.

Production stays disabled throughout Step 9 preparation. Restoring, migrating,
rotating production keys, enabling paid services or sending notifications needs
separate explicit authority.
