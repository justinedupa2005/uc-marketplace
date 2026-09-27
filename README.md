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

The app expects the public Supabase URL and publishable key in `.env.local`.
Database setup, migration, and security-check instructions live in
[`supabase/README.md`](supabase/README.md).

## Quality checks

```powershell
npm.cmd run check
npm.cmd run build
```

`check` runs the TypeScript compiler, ESLint, and the unit-test suite.

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
