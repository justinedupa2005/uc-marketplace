# Protected Vercel staging deployment (Step 7)

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

References: [Next.js deployment](https://nextjs.org/docs/app/getting-started/deploying),
[Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration),
[Vercel Git branch tracking](https://vercel.com/docs/git),
[Vercel deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment),
[Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication).
