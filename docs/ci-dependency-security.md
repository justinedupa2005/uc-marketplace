# Step 2: CI and dependency security

Reviewed on **2026-10-20 (Asia/Manila)**. This records repository security and
the exact-commit release gate; it is not deployment or launch approval.

## GitHub findings and release identity

The latest pushed `main` commit is
[`249f8fd26098f4ab089010de3091cf3ec22460d9`](https://github.com/justinedupa2005/uc-marketplace/commit/249f8fd26098f4ab089010de3091cf3ec22460d9).
At the initial review, local HEAD matched it, but the working tree included
uncommitted Step 1 and Step 2 changes. That base commit was not a release
candidate containing the fixes below.

[Its latest Actions run](https://github.com/justinedupa2005/uc-marketplace/actions/runs/38498449239)
completed with `local-security=failure` and `isolated-full-stack=skipped`.
Dependency installation passed; `npm run check` failed because
`src/app/layout.tsx` could not find `LayoutProps`. The later migration, audit,
build and browser steps were skipped, not passed. Full-stack was intentionally
manual-only on this push; its skip is not full-stack acceptance evidence.

The root cause was missing generated Next route types on a clean checkout.
Installed Next.js 16.3.8 documents `next typegen` before `tsc`. `typecheck` now
does that, and the disposable local runner also generates types first. A real
temporary copy of application source reproduces the failure without generated
files, then requires type generation and TypeScript to pass; it does not remove
or depend on the workspace's existing `.next` directory.

The workflow retains its stable `local-security` check name, lockfile-based
`npm ci`, SHA-pinned actions and `contents: read`. It now has named gates for
repository/history secret patterns, type generation/checking, ESLint, tests,
migrations/RLS, full dependency review, production build and browser bundles.
Authenticated full-stack QA remains an explicit manual gate. Runners are pinned
to `ubuntu-24.04` instead of following the announced `ubuntu-latest` OS change.
No workflow uses `pull_request_target`, repository secrets, write tokens,
continued-on-error security checks, uploaded private artifacts or deployment.

## Dependency findings

Commands executed against the installed lockfile:

```powershell
npm.cmd audit
npm.cmd audit --omit=dev
npm.cmd outdated
npm.cmd run qa:dependencies
```

The raw audit/outdated invocations were read as JSON. `audit` and `outdated`
return nonzero when they find advisories/available updates; this is distinct
from a registry/network error. The policy gate fails closed on invalid/error
responses and never prints raw npm diagnostics.

- Production-only audit: **0 advisories**, including **0 critical**.
- Full audit: **5 high development-package findings**, all from the same
  [unpatched braces advisory, GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- Upstream `braces` latest remains **3.0.3**, within the affected `<=3.0.3` range;
  the advisory lists no patched release. npm's suggested `eslint-config-next`
  **14.2.35** is an incompatible downgrade, not an accepted fix for Next 16.

| Affected installed package | Version | Role / advisory path |
| --- | --- | --- |
| `eslint-config-next` | 16.3.8 | Direct development lint configuration |
| `@next/eslint-plugin-next` | 16.3.8 | Lint plugin depends on `fast-glob` |
| `fast-glob` | 3.3.1 | Development glob processing via `micromatch` |
| `micromatch` | 4.0.8 | Depends on `braces` |
| `braces` | 3.0.3 | Recursive pattern processing can exhaust the stack |

The installed chain is marked `dev: true` in the lockfile. The Next lint plugin
processes `settings.next.rootDir` glob patterns; this repository has no such
untrusted configuration, and student requests do not supply lint patterns.
This is an application-usage assessment, not a claim that the vulnerable code
is harmless: a malicious code/configuration contribution could terminate a lint
process or consume CI resources. Pull requests already execute untrusted code
on disposable runners; workflow permissions remain read-only, repository secrets
are absent, and job deadlines bound this tooling-denial risk.

The temporary exception is encoded in
[`dependency-policy.json`](../scripts/qa/dependency-policy.json), reviewed October
20 and **expires November 19, 2026 UTC**. The gate checks all five exact installed
versions/paths and their development classification, the advisory chain/severity,
the absence of production advisories, and the absence of a compatible fix.
New findings, a changed chain/install, a compatible patch, malformed data or
expiry fail CI and require a fresh review. No blanket `audit-level=critical`,
`npm audit fix --force`, broad override or test disabling was used.

### Outdated packages (reviewed, not automatically upgraded)

| Package | Installed | Wanted in current range | Registry latest |
| --- | --- | --- | --- |
| `@electric-sql/pglite` | 0.5.8 | 0.5.10 | 0.5.10 |
| `@playwright/test` | 1.63.0 | 1.64.1 | 1.64.1 |
| `@supabase/ssr` | 0.12.5 | 0.12.7 | 0.12.7 |
| `@supabase/supabase-js` | 2.112.4 | 2.118.0 | 2.118.0 |
| `@types/node` | 20.19.43 | 20.19.43 | 26.6.5 |
| `@types/react` | 19.2.18 | 19.3.0 | 19.3.0 |
| `@types/react-dom` | 19.2.5 | 19.3.0 | 19.3.0 |
| `eslint` | 9.39.5 | 9.39.5 | 10.13.0 |
| `eslint-config-next` | 16.3.8 | 16.3.8 | 16.4.2 |
| `next` | 16.3.8 | 16.3.8 | 16.4.2 |
| `react` | 19.2.8 | 19.2.8 | 19.3.1 |
| `react-dom` | 19.2.8 | 19.2.8 | 19.3.1 |
| `supabase` | 2.117.0 | 2.121.0 | 2.121.0 |
| `typescript` | 5.9.3 | 5.9.3 | 7.0.2 |
| `zod` | 4.4.3 | 4.6.7 | 4.6.7 |

These are maintenance updates, not compatible fixes for the reported advisory.
The lockfile and runtime versions were intentionally preserved to retain Step 1
acceptance. Upgrade separately with release-note review and full affected tests;
Next/config and React/ReactDOM should remain paired. Dependabot configuration
adds weekly npm/Actions review PRs with limited open requests; it does not
automatically merge, bypass protection or publish dependency changes.

## Repository settings verified and secured

Authenticated inspection used the existing Git credential only in memory; its
value was not written or displayed. Repository secrets and environment secrets
are not readable through these metadata APIs and were not requested.

- GitHub secret scanning: **enabled**; push protection: **enabled**.
- Secret-scanning alerts: **0 total / 0 open** at review time.
- Actions default token permission: **read**; workflow approval of PR reviews:
  **disabled**. Repository Actions secrets: **0**; repository environments: **0**.
  Separate Vercel/Supabase configuration is outside this inspection.
- `main` previously had no protection/rulesets. It now requires the
  **`local-security`** check from **GitHub Actions app 15368**, up-to-date
  branches and a pull request, with enforcement for administrators too.
  Force pushes and deletion are blocked; conversations must be resolved.
  Extra approving reviewers are not required, so a solo maintainer is not
  blocked by a review-count requirement. Settings were read back and verified.
- `.env*` is ignored, including nested `.env.local` and production-local files.
  The new `qa:secrets -- --history` guard inspects current tracked/unignored files
  plus reachable Git history for known privileged-token, private-key, credential
  assignment and database-credential patterns, without printing matches.
  Only exact documented inert negative-test fixtures are exempt; test paths are
  not exempt. GitHub scanning complements this intentionally limited guard.

**Workflow change:** future code should be pushed to a feature branch and merged
through a green pull request. Direct pushes to `main` may now be rejected. Do not
disable/bypass protection to publish these fixes. At the initial review no code
had been committed/pushed and no Actions run dispatched. No repository secret
was added or changed.

## Repeatable release verification

After authorizing publication, push a feature branch, open a PR, pass CI and merge
it. Then use a clean checkout of the resulting exact `main` SHA, manually run
`Security and workflow checks` with **full_stack=true**, and wait for completion.
Verify the SHA again after the run. A PR merge SHA, earlier successful commit,
skipped job or workflow discovery is not evidence for another release commit.

```powershell
# Read-only verification; defaults to local HEAD.
npm.cmd run qa:release -- --git-credential

# Or supply the full 40-character deployment SHA explicitly:
npm.cmd run qa:release -- --sha FULL_40_CHARACTER_SHA --git-credential
```

`--git-credential` explicitly permits using the existing Git credential in memory.
Alternatively supply `GH_TOKEN`/`GITHUB_TOKEN` through a secure process/CI secret
manager. Never paste tokens into chat/commands/files. The verifier only GETs the
fixed repository's GitHub API; it does not push, merge, change settings or deploy.

The verifier requires a clean local tree, local HEAD and remote `main` equal to
the exact SHA, the latest reviewed workflow run and current job/check attempts
successful, actual successful manual full-stack evidence for that SHA, and the
expected enforced protection. It rejects forks, unrelated workflows, stale
successes, skipped/cancelled/neutral/running checks and truncated inspection.
It reports controlled blocker codes and never promotes its result to launch
approval (`releaseReady` remains false).

Pre-publication verification result: **blocked** by `uncommitted_changes`,
`latest_ci_not_successful`, `required_check_not_successful`, and
`full_stack_ci_not_successful`. This is expected until the reviewed changes are
published and CI runs against their actual commit. No old green result is reused.

## Completion

- [ ] CI passes for the exact commit intended for deployment.
- [ ] All required GitHub checks are green.
- [x] Dependency advisories assessed, mitigated and recorded with an expiry.
- [x] No known production dependency advisories in the current audit.
- [x] No known-pattern credential findings in reviewed files/history, and no
  GitHub secret alerts; ongoing scanning remains enabled.
- [ ] A clean release-candidate commit containing these changes is identified.

## Local verification completed

- Final `npm.cmd run check`: route type generation, TypeScript, ESLint and
  **355 regression tests** passed, zero failures/cancellations/skips.
- Fresh clean-checkout reproduction confirmed the old `LayoutProps` failure
  and then compiled the actual copied application after `next typegen`.
- `npm.cmd run test:db`: **18 migrations / 535 assertions**, zero failures.
- Production build passed with inert public CI configuration; bundle/source
  security passed **217 source modules / 48 browser chunks**.
- Anonymous Chromium CI suite passed **40/40**, with zero runner errors and
  zero unexpected unhandled-runtime signals. This baseline run replaces the
  shared browser report; it is not fresh full-stack evidence. The earlier
  full-stack Step 1 counts remain in `.qa/stack-ENwg03/acceptance-summary.json`.
- Dependency gate passed with the exact **five reviewed development findings**,
  zero production findings and the November 19 expiry enforced.
- Current-file/reachable-history known-secret patterns passed on **414 current
  files / 702 historical blobs**, and GitHub reported zero secret alerts.
- Both workflow/Dependabot YAML files parsed successfully, all workflow npm
  command references exist, and `git diff --check` passed.
- `qa:release` exited **1 / blocked**, correctly identifying the unchanged
  failed remote commit, uncommitted work and missing exact-commit full-stack CI.

No dependency versions or lockfile packages were changed. The final `.next`
output uses inert CI configuration, not production settings; rebuild with the
intended environment before deployment. Docker full-stack acceptance was not
rerun for this tooling-only change, and the earlier Step 1 pass does not certify
the new workflow on GitHub. **Step 2's implementation/security review is done,
but its release completion criteria still require green exact-commit CI.**

## Publication handoff

Publication of the reviewed Step 1/Step 2 changes was subsequently authorized on
`chore/step-2-ci-security`, through a pull request to protected `main`. The actual
commit SHA and CI results must be read from that pull request; the earlier failed
base SHA and local passes above do not substitute for the new check run. Neither
merging nor deployment is authorized by this publication step. After merging,
verify the resulting exact `main` SHA and run its manual full-stack release gate.

References: [installed-version type generation](https://nextjs.org/docs/app/api-reference/cli/next#next-typegen-options),
[GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches),
[npm audit semantics](https://docs.npmjs.com/cli/v11/commands/npm-audit/).
