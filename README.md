# UC Marketplace

UC Marketplace is a private marketplace for verified University of Cebu
students. It uses Next.js App Router, React, TypeScript, Supabase, and Tailwind
CSS.

## Local development

Install dependencies and start the development server:

```powershell
npm.cmd install
npm.cmd run dev
```

With Docker running, `npm.cmd run env:local -- --start` starts the local-only
Supabase development stack and configures ignored `.env.local` from its status.
It preserves the local recovery secret on repeat runs and retains a private
backup before replacing an existing configuration. Run `npm.cmd run env:check`
before building or starting the app. This checks production-mode dotenv precedence,
including for a local-target build; it does not select `APP_ENV=production`.
Never use the protected hosted student project locally.
See [deployment environment configuration](docs/deployment-environment.md) for
the full local/staging/production variable inventory and recovery-secret rotation.

Step 5 is **partially complete**: the owner deferred external SMTP setup on
2026-10-25 so other preparation can continue. Production email authentication,
delivery and end-to-end email flows remain pending. Production deployment stays
disabled; email confirmation must not be bypassed to work around SMTP failures.

Step 6 adds [production authentication and email safeguards](docs/production-authentication.md),
managed Supabase email templates and guarded Auth configuration/read-back tools.
Staging and production policies/templates are configured; external delivery and
hosted end-to-end acceptance remain pending. No production deployment is enabled.

Step 7 adds [protected staging deployment](docs/staging-deployment.md), exact-commit
CI/hosting/database guards and a separate staging-only browser smoke. Automatic
Git deployments remain off; the production release block is unchanged.

The app uses the existing `NEXT_PUBLIC_APP_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` names; do not add URL/key aliases.
Database setup, migration, and security-check instructions live in
[`supabase/README.md`](supabase/README.md).

## Quality checks

```powershell
npm.cmd run check
npm.cmd run build
```

`check` runs the TypeScript compiler, ESLint, and the unit-test suite.
The test runner uses one worker so clean-checkout compiler and in-memory database
fixtures do not compete for memory or exceed their unchanged time limits.

Step 15 adds database authorization/workflow checks, browser tests, security
boundary scans and an isolated authenticated QA runner. See
[`docs/security-workflow-testing.md`](docs/security-workflow-testing.md) for
commands, environment safety guards and release gates, and the
[execution record](docs/security-workflow-results.md) for completed versus
unverified checks. The QA runner must never target the linked production project.

With local Docker running, `npm.cmd run qa:local` creates and cleans up its own
disposable stack for Auth, SMTP, Storage, Realtime, transaction-race and browser
acceptance. Password recovery requires the server-only `AUTH_RECOVERY_SECRET`
described in [the QA guide](docs/security-workflow-testing.md#required-password-recovery-signing-configuration)
before using the feature or deploying; the disposable runner generates its own.

## Source organization

```text
src/
  app/          routes, layouts, loading/error UI, and route-private workflows
  features/     domain UI, actions, client helpers, DTOs, validation, and queries
  components/   application-wide layout and reusable UI primitives
  lib/          cross-cutting auth and Supabase infrastructure
  types/        generated database types and schema composition
```

Feature server modules import `server-only`. Client-safe DTOs and utilities
live outside `server/`, so Client Components never need to import a data-access
module. Route-specific implementation details can remain colocated under
Next.js private folders such as `_components` and `_hooks`.

ESLint enforces the most important dependency boundaries:

- feature and shared modules cannot import route-layer implementation details;
- feature server modules cannot depend on UI components;
- client-capable components and hooks cannot import feature server modules.

## Supabase types

The application clients are parameterized with the public database schema.
After applying repository migrations to the linked project, regenerate the
committed output with:

```powershell
npm.cmd run db:types
```

Do not edit `src/types/database.generated.ts` by hand. The adjacent
`src/types/database.ts` composes generated types with any RPC signatures from
committed migrations that have not yet reached the linked project. Remove a
temporary overlay after regenerating against a database that includes that
migration.
