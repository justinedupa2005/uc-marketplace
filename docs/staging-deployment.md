# Protected Vercel staging deployment (Step 7)

**Completed 2026-10-26:** the protected staging application is deployed and
accepted. The immutable application source is
`7f170f60c27314914fc0ccab2926d368a6aab454`; the final execution record below
identifies its CI, deployment and hosted tests. Later operator/documentation-only
commits do not replace that deployed artifact. Production remains disabled and
external SMTP acceptance remains deferred.

The only deployment target in this procedure is **uc-online-shop-staging**:
<https://uc-online-shop-staging.vercel.app>. Its database is
`niocptgzzbozpbfzifdk`. Marketplace production (`uc-online-shop`, database
`fezeqoqdrmicvxpbgnaf`) remains separate and deployment-disabled.

## Source and hosting gates

- Integrate reviewed source into `staging` through a pull request. Keep its
  required `local-security` check, strict up-to-date requirement and administrator
  enforcement. Never force-push or disable protection to deploy.
- Wait for **push CI on the exact resulting staging SHA**, not just PR CI or an
  earlier successful commit. The local checkout must match that SHA and be clean.
- Connect only the registered staging Vercel project to
  `justinedupa2005/uc-marketplace`, with `staging` as its canonical branch.
- Disable provider-created deployments **before** linking, including older
  branches without `vercel.json`. The checked-in config independently disables
  automatic Git deployments. Deployment remains an explicit operator action.
- Keep Vercel Authentication on **All Deployments**, including the canonical
  staging domain. Do not substitute noindex for access control or publish a
  secret bypass URL. Grant authorized testers access through Vercel.
- Use the Next.js framework preset, repository root, Node 22, `npm ci`, and
  `npm run build`. Do not set an output directory, static export, rewrite-all
  fallback, or promote an artifact built with another environment's variables.
- Preserve the six existing staging-only application variables and write-only
  recovery Secret. No privileged database/API/SMTP credentials are uploaded.

## Guarded operator commands

Sign into the existing Vercel CLI and Git credential manager. Check out the
reviewed staging commit. Do not supply credentials in command arguments.

```powershell
npm.cmd run staging:hosting -- inspect
npm.cmd run staging:hosting -- connect <exact-staging-sha>
# Load the staging-only operator token privately, outside Next.js:
$env:STAGING_PROJECT_REF = "niocptgzzbozpbfzifdk"
$env:STAGING_ALLOW_MUTATIONS = "1"
npm.cmd run staging:hosting -- plan <exact-staging-sha>
$env:STAGING_DEPLOY_CONFIRM = "prj_R9felUNyhj0jz97aNM1bn7FnHM4Z:<exact-staging-sha>"
npm.cmd run staging:hosting -- deploy <exact-staging-sha>
npm.cmd run staging:hosting -- status <deployment-id>
```

The plan audits migration checksums, actual schema/grants/RLS, Storage and Realtime
without selecting student rows. Pending migrations or drift block deployment;
this command does **not** migrate/reset/reseed or change Auth/SMTP settings.

Deployment pins the immutable Git SHA and rebuilds in the isolated staging
project's Vercel **Production target**. That Vercel target serves the staging
domain; it is not marketplace production. Deployment uploads no local files,
dotenv, `.qa` backups or operator environment.

An exclusive ignored `.qa/staging-deployment-<sha>.json` journal records the
attempt, CI run and deployment ID. A timeout is ambiguous: inspect Vercel and
the journal before any retry. Never delete the journal merely to bypass the
single-attempt safeguard. `status` is read-only. No command enables production.

## Hosted acceptance

Record the immutable SHA, exact CI run, deployment ID, HTTPS canonical/unique
URLs, build result and sanitized browser counts. Check anonymous access is
blocked by Vercel on both URLs before authorized application testing.

Use separate existing synthetic student/admin browser sessions. Check direct
navigation and refresh for home, login/register/recovery forms, marketplace,
search/filter, listing detail and image, sell, favorites, messages, reservations
and meetup detail, profile/edit, verification and all admin pages. Verify login
and logout Server Actions, SSR session cookies, role denials, invalid callback
Route Handlers, no-store/noindex headers and no cross-account cached data.

Do not reuse the destructive local QA suite against a hosted URL: its loopback
guard is intentional. Use a separate staging-only smoke. Keep traces, screenshots,
browser sessions, passwords and raw service/runtime logs out of Git and CI output.
Review compiler/runtime failures privately; publish counts and fixed error codes.

`npm.cmd run staging:hosting:smoke` accepts a bounded JSON object through private
stdin only: the deployed SHA/ID, staging publishable key, temporary authorized
hosting bypass secret and the five existing synthetic account passwords. Load
these from the operator's secret manager; do not paste them into chat, shell
arguments or tracked files. The bypass header is attached only to the exact
staging application origin, never Supabase or other hosts. The script rejects
production requests, records primitive-only evidence under ignored `.qa`,
releases only its own sessions and sends no registration/recovery emails.
Revoke the temporary hosting bypass after testing, including after failures.

Staging public signup and external SMTP remain intentionally disabled/non-delivering.
Loading registration/recovery forms or rejecting invalid callbacks is **not**
successful email or password-recovery acceptance. Real delivery, valid/expired/
replayed links and mobile inbox testing remain deferred Step 6 gates. Production
deployment is not approved by a staging deployment.

## Execution record

Preparation on 2026-10-25: the dedicated staging project has the six correctly
scoped variables, All Deployments protection, Next.js/Node 22/root configuration;
production is protected, unconnected and undeployed. The read-only staging plan
finds **20 applied / 0 pending** migrations. The actual schema audit has **0**
missing, unexpected or changed objects and passes **129** native security
assertions. Deployment and hosted browser acceptance are not yet certified.

The first staging PR CI correctly refused the old dependency lockfile: npm
reported three Next.js advisories (two critical, one high) affecting 16.3.8 and
a high Zod advisory affecting 4.4.3. Next.js and its paired ESLint config are now
pinned to **16.4.3**, and Zod to **4.6.7**. A fresh full/production audit passes
with **0 findings** and no development exception. No security check was removed
or bypassed. See the dated [dependency review](ci-dependency-security.md).

HTTPS deployment review also found SDK cookies lacked an explicit Secure flag.
Browser Auth, writable SSR and session-refresh proxy now share Secure cookies on
HTTPS, host-only scope and SameSite=Lax. HTTP loopback remains usable; HttpOnly
is retained for the separate recovery grant, not imposed on SDK cookies needed
by browser Auth/Realtime. A real SDK cookie-write regression covers the change.

### Verified source; repository authorization still required

PR [#3](https://github.com/justinedupa2005/uc-marketplace/pull/3) merged through
the existing protected workflow into staging at
`9354c5ac5570daa581cb34f1396425c36f9e41f1`; **main was not merged or deployed**.
Its exact-commit push CI [run 40198776963](https://github.com/justinedupa2005/uc-marketplace/actions/runs/40198776963)
passed every required check, including the clean dependency audit and browser suite.

A fresh full disposable local QA run passed **420** regressions, **535** SQL
assertions over **20** migrations, **36** messaging assertions, **129** native
security assertions, **253** API checks, **3** concurrency scenarios, **4** Realtime
scenarios, **12** local SMTP/Auth checks and **46** browsers. Only its owned stack
`ucmarketplace-qa-02d0c26a61e3ac58` was stopped. The sanitized ignored result is
`.qa/stack-Lq0OlE/acceptance-summary.json`; external delivery/deployed acceptance
are `not_run`, and `releaseReady=false`. A subsequent fresh local-target build
passed, replacing the artifact that pointed at the stopped QA stack.

The staging project's provider setting is now `createDeployments=disabled`,
verified **before** the attempted Git connection. Vercel explicitly rejected
that connection with HTTP 400 and required action **Install GitHub App**. A
separate direct read confirmed the account's GitHub login connection exists;
that does not establish the App's access to this repository. The owner must
install/configure [the Vercel GitHub App](https://github.com/apps/vercel/installations/new)
for **only `justinedupa2005/uc-marketplace`**, then continue the guarded connection
and deployment. Do not grant all-repository access or weaken project protection.

The installed Vercel CLI injects team context into some user-scoped endpoints,
which can itself cause HTTP 400 on the namespace inventory. A direct authenticated
read without that query distinguished this diagnostic problem from the actual
missing repository App authorization. No credentials were displayed.

Operator writes now use a separately tested single-request transport with the
existing private CLI login (or a privately injected `VERCEL_TOKEN`), fixed Vercel
origin, registered project paths, redirects refused and **no automatic retries**.
This avoids the CLI's internal retry behavior for ambiguous writes. Production
deployment, alternate hosts and file/environment uploads in deployment requests
are rejected. Raw write responses are captured privately by the parent operator.
All **11** targeted hosting/transport regressions pass, including **4** new
single-write tests; this operator-only follow-up does not change application code
covered by the full 420-test/local-browser run. Local environment preflight,
the fresh build, **224**-module/**48**-chunk boundary scan and known secret-pattern
checks also pass. The transport follow-up must pass its own PR/exact-commit CI
before the next approved deployment source is selected.

**No hosted deployment or temporary hosting bypass has been created yet.** The
owner authorized a temporary staging-only bypass for the later browser smoke;
create it only after deployment, then revoke it even if testing fails. HTTPS app
pages, deployed functions/images/cookies and runtime logs remain unverified.

### First deployment attempt and hosting compatibility

After the owner authorized the repository, its Vercel connection was verified.
The UI defaulted to `main`; only the staging project's branch was corrected to
`staging`, preserving All Deployments protection and disabled automatic builds.
PR #4 merged as `b1ce106d80c97f3d35f6af5a85192da64d4ce81a`, and its exact push
CI [run 40201270011](https://github.com/justinedupa2005/uc-marketplace/actions/runs/40201270011)
passed. The final read-only plan again found 20 applied migrations, zero drift or
pending versions and 129 successful security checks.

A single deployment request created `dpl_25KGN9MbQULaDVbzFLABP45s4F9b` from that
immutable source. Its build failed before compilation: Vercel injects
`NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG`, which the strict public-variable
allowlist did not recognize. Only variable **names** and static error categories
were inspected, not credential values. The fix adds that one public routing
metadata name, keeps the credential checks and rejects lookalike secret aliases.
Unknown-variable diagnostics now identify a bounded safe name without its value.
See [Vercel's public client configuration](https://vercel.com/docs/analytics/package#dynamic-configuration).

The failed deployment and exclusive attempt journal are retained; no ambiguous
POST was retried, and no production application was deployed. A corrected source
must pass its own staging PR and exact-commit push CI before another deployment.

Upload acceptance also needs a hosting compatibility review: current file flows
send files through Server Actions and permit 5 MiB per image / multiple listing
images, above Vercel's [4.5 MB function request limit](https://vercel.com/docs/functions/limitations).
Raising Next's bodySizeLimit cannot change the hosting limit. Preserving the
existing file limits requires direct-to-private-Supabase upload flows with the
same ownership, RLS, file-size/type/signature and finalize checks. The owner
explicitly approved this refactor on 2026-10-26. Listing create/edit and school-ID
forms now transfer file bytes directly to the existing private buckets using the
student's session and `upsert: false`, not a service key. Only bounded references
cross Server Actions. Prepare/finalize actions independently recheck eligibility,
ownership, draft/submission token or edit version, and consent where applicable.
Finalize inspects Storage size/MIME metadata before downloading a bounded object,
then checks actual byte count, MIME/extension agreement and file signature.

The existing 5 MiB / five-image limits and Storage policies are unchanged; no
bucket was made public. Ambiguous finalization retains submitted objects, and
failed upload cleanup stays confined to that attempt's paths. The admin document
endpoint now streams authenticated no-store responses rather than returning a
buffered 5 MiB response or exposing a signed document URL. The 2 MiB avatar flow
is unchanged; Server Actions now allow 3 MiB including its multipart overhead.

Fourteen new regressions cover these boundaries, actual browser pipelines and
server actions. Disposable browser acceptance now includes a 5 MiB school ID,
multi-image publication and a 5 MiB listing-edit image. The protected hosted smoke
also exercises synthetic listing publication/edit with 5 MiB direct uploads,
denies anonymous Storage downloads, checks that application action requests stay
small, and archives only its own synthetic listing afterward. It retains that
record's audit/Storage evidence instead of bypassing lifecycle deletion rules.

On 2026-10-26, local full QA could not start because Windows reserved ports
54325–54424 (binding QA port 54331 returns `EACCES`); no QA container owns that
port. Existing development containers and Windows port reservations were left
unchanged. Use the existing manual `security-qa.yml` workflow with `full_stack`
enabled on the reviewed commit for the isolated Linux acceptance run. Local
preflight failure is **not** counted as a successful full-stack test. The fresh
local production build and targeted regressions pass; CI/hosted acceptance for
the corrected source must still be recorded after execution.

### Full builder metadata follow-up

PR #5 merged as `d77f43d6e9fbda13e053fd333df22155b62a5b96`; its exact push
CI [run 40252493122](https://github.com/justinedupa2005/uc-marketplace/actions/runs/40252493122)
passed all required gates, and all **439** local regressions passed. Seven local
process-control tests initially lacked sandbox permission to stop their own
workers; rerunning with that permission passed, without disabling tests. The
final staging plan again confirmed 20 migrations, no drift and 129 assertions.

Deployment `dpl_87uLJ8sPB4sFhbivqaAKJi4LRCCD` still stopped before compilation:
Vercel's builder also creates `NEXT_PUBLIC_VERCEL_PROJECT_ID`, not present in its
deployment API's environment-name list. The complete builder implementation was
reviewed both in the installed CLI package and [upstream source](https://github.com/vercel/vercel/blob/main/packages/build-utils/src/get-prefixed-env-vars.ts).
The explicit allowlist now includes its public project/deployment IDs and region,
plus the documented previous Git SHA, for **21** exact names. It still rejects
OIDC, automation bypass, arbitrary Git credential aliases and privileged values.
The public project ID must also match the registered environment. New coverage
checks the independent eight-variable builder contract and loads actual Next
configuration with the hosted staging metadata. Unknown-name diagnostics report
all bounded unreviewed names together, never values; no prefix wildcard is used.

The isolated full-stack [run 40252740559](https://github.com/justinedupa2005/uc-marketplace/actions/runs/40252740559)
tests the upload implementation at `d77f43d`; its result is pending at this
checkpoint. Both failed deployment journals are retained; no request was retried
and no temporary hosting bypass or production deployment has been created.

### Successful immutable deployment and acceptance — 2026-10-26

PR #6 merged the complete framework metadata fix as application source
`7f170f60c27314914fc0ccab2926d368a6aab454`.

- Exact push CI: [40253699643](https://github.com/justinedupa2005/uc-marketplace/actions/runs/40253699643), successful.
- Exact-source isolated full-stack QA: [40253867799](https://github.com/justinedupa2005/uc-marketplace/actions/runs/40253867799), successful. It ran **441** unit/regression tests,
  **20** migrations / **535** embedded SQL assertions, **36** native messaging
  assertions, **129** native catalog assertions, **253** API checks, **3**
  concurrency scenarios, **4** Realtime scenarios, **12** local Mailpit/Auth checks,
  and complete authenticated browser acceptance. No hosted credentials were used
  in that disposable Linux workflow. External inbox delivery is not implied.
- Immediately before deployment, the read-only staging audit again found all
  20 migrations applied, no pending versions or schema/grant drift, and 129
  passing security assertions. No migration, reset or production operation ran.
- Deployment **`dpl_BxNC9jZ5Ngo2KDgpkm2UWVEqAvBc`** is **READY** and canonical at
  <https://uc-online-shop-staging.vercel.app>. Its unique protected URL is
  <https://uc-online-shop-staging-nv7wac24m-justinedupa2005s-projects.vercel.app>.
  The build used Next.js 16.4.3, compiled successfully and reported no build
  failure markers. Both earlier failed attempts/journals remain available.
- Protected hosted acceptance completed at **2026-10-26 10:53:01 PHT** with
  **470** checks and five separate synthetic roles: admin, pending, seller,
  buyer and suspended. It verified HTTPS/hosting protection, direct navigation,
  streamed main content, refresh/session identity, Secure/SameSite=Lax cookies,
  login/logout Server Actions, role denials, no-store/noindex, invalid callbacks,
  marketplace/search, listings, favorites, messages/conversation, reservations/
  meetup detail, profile/edit, verification and admin pages.
- Hosted seller publication and editing transferred **5,242,880-byte** synthetic
  images directly to the existing private listing bucket. Three file transfers
  succeeded; the largest application action request was only **1,924 bytes**.
  Anonymous Storage download was denied. Each run archived only its own synthetic
  listing; its audit/Storage evidence was retained, not forcibly deleted.
- A separate **15-check** read-only hosted probe verified the private school-ID
  endpoint: an authorized admin received the synthetic PNG with private/no-store,
  no-referrer and nosniff headers and no signed-URL redirect. Anonymous users,
  students and the signed-out administrator were denied. It also verified the
  suspended student's exact restriction notice and own profile identity.
- Hosted browser errors, hydration errors, server failures and requests to other
  Supabase environments were all **zero**. Private browser state, photographs,
  credentials and raw logs were not published or attached to CI artifacts.
- Post-test read-only fixture verification passed with no public table missing
  RLS. The hosted runtime review examined 50 entries and found zero errors or
  server failures; no raw runtime logs were published.
- Every temporary staging bypass was revoked and the prior bypass inventory and
  All Deployments authentication were restored. Production stayed unconnected,
  undeployed and release-disabled; no SMTP settings or emails were involved.

The first hosted-test setup used an incorrect bypass API version/custom-token
shape and was rejected before browser testing. The corrected operator uses the
[documented v1 API](https://vercel.com/docs/rest-api/projects/update-protection-bypass-for-automation)
with a server-generated 32-character token and non-regenerating revocation.
Only staging generation/revocation is permitted; no protection override or
production bypass is allowed. An ignored note-only journal permits scoped
cleanup of an uncertain request without writing secrets to disk.

Initial browser checks also exposed harness assumptions, not application
exceptions: instant visibility checks preceded streamed content, the shared
header's accessible "Log out" differed in capitalization, and the suspended
profile intentionally contains a restriction alert with a decorative icon.
The final harness waits for main content and exact profile identity, matches
the real logout label, and requires exactly the known suspended-profile message
span. Every other route/role still requires zero error alerts. Three additional
operator regressions cover these contracts; no application/security test was
disabled and no deployed application source changed during these corrections.

Step 7 is complete. This does not complete deferred Step 6 external registration,
recovery, real-inbox/mobile delivery or production acceptance. Keep production
deployment disabled until those gates and explicit release approval are complete.

References: [Next.js deployment](https://nextjs.org/docs/app/getting-started/deploying),
[Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration),
[Vercel Git branch tracking](https://vercel.com/docs/git),
[Vercel deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment),
[Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication).
