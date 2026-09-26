# Supabase database setup

Database changes are stored as forward-only SQL migrations in
`supabase/migrations`. Never edit a migration after it has been applied to the
remote project.

## Migrations

Apply migrations in filename order:

1. `20260917000000_create_marketplace_core.sql`
   - Categories, listings, listing images, initial RLS, and `listing-images`
     Storage.
2. `20260917010000_add_identity_and_verification.sql`
   - Profiles, student verification, account roles/statuses, category updates,
     `avatars` and private `student-verifications` Storage, stricter listing
     security, and admin review/moderation RPCs.
3. `20260917020000_complete_registration_profile_trigger.sql`
   - Copies only allowlisted registration identity metadata into profiles,
     normalizes student IDs and courses, and keeps role, verification status,
     and account status database-owned.
4. `20260917030000_secure_student_verification_workflow.sql`
   - Makes verification submission an authenticated database RPC, stores a
     profile snapshot atomically with the pending transition, tightens private
     Storage access and the 5 MiB image limit, and hardens admin review.
5. `20260921000000_strengthen_marketplace_authorization.sql`
   - Limits listing and seller-profile reads to verified active students or
     active administrators, removes older permissive policies, makes
     `listing-images` private, and enforces live ownership/status checks for
     image metadata and Storage objects.
6. `20260922000000_complete_authorization_hardening.sql`
   - Adds restrictive identity/verification gates, makes the complete allowed
     row set part of restrictive marketplace policies, prevents sellers from
     reversing or erasing administrator removals, and reasserts least-privilege
     grants for protected tables and RPCs.
7. `20260924000000_complete_listing_creation.sql`
   - Adds private listing drafts, seller-scoped submission idempotency,
     database content checks, column-level mutation privileges, and the secure
     `publish_listing(uuid)` finalization RPC.
8. `20260925000000_complete_listing_browsing_management.sql`
   - Adds favorites, conversations/messages, reservations, private listing
     reports, owner lifecycle transitions, atomic listing edits, and stricter
     published-image and Storage mutation boundaries.
9. `20260926000000_harden_listing_interaction_lifecycle.sql`
   - Preserves safe sold/removed interaction history, standardizes lock order,
     closes status-transition races, makes duplicate reports idempotent, and
     hardens image publication, editing, and cleanup concurrency.
10. `20260926010000_allow_zero_price_listings.sql`
   - Aligns create/edit validation and database checks so free listings may use
     a price of zero while retaining the existing marketplace price ceiling.
11. `20260926020000_optimize_marketplace_browsing.sql`
   - Adds a generated title/description search field and partial indexes for
     visible-listing newest, category, condition, and price queries without
     widening RLS or exposing listing history.
12. `20260926030000_complete_favorites.sql`
   - Adds the newest-saved-first favorites index, an idempotent authenticated
     favorite-state RPC, and a lock-order-safe legacy toggle while preserving
     the existing sold/removed cleanup behavior.

## Applying these migrations to another project

In the linked UC Marketplace project, migration 1 was applied manually and its
CLI history was repaired after checking the remote schema. Migrations 2-4 were
applied through the CLI on 2026-09-20, migration 5 on 2026-09-21, and migration
6 on 2026-09-22, migration 7 on 2026-09-24, migration 8 on 2026-09-25, and
migrations 9-10 on 2026-09-26.
Applied migrations recorded in remote history must not be edited or run again;
add a new forward-only migration for later changes.

For another project where migration 1 was already applied manually, first
verify its schema and repair its migration history. Then apply the remaining
migrations in order with the CLI. The SQL Editor steps below are only for a
project that cannot use the CLI:

1. Open the UC Marketplace project in Supabase.
2. Open **SQL Editor** and create a new query.
3. Copy the complete contents of
   `migrations/20260917010000_add_identity_and_verification.sql`.
4. Select **Run** once.
5. Run `checks/identity_verification.sql` as a separate read-only query and
   inspect its results.

Before Step 3, run `checks/registration_preflight.sql` as a read-only query.
If any result is nonzero, review and map those existing student records rather
than deleting them automatically. Then run
`migrations/20260917020000_complete_registration_profile_trigger.sql` once.
This second migration is required before using the expanded Step 3 registration
form. It validates the new ID/course rules and narrows year level to 1–5, so
incompatible existing data causes the transaction to roll back safely.

The migration runs in one transaction. If any statement fails, PostgreSQL
rolls the complete migration back.

## Apply Step 4 student verification

After the Step 2 and Step 3 migrations, run
`checks/student_verification_preflight.sql`. Both issue counts should be zero
and `verification_buckets_found` should be one. If there are legacy rejected
requests with reasons shorter than 5 or longer than 500 characters, resolve
those records explicitly before Step 4: the stronger review constraint will
reject the migration rather than silently rewrite review history. Then apply
`migrations/20260917030000_secure_student_verification_workflow.sql` once. Do
not re-run already applied migrations.

Run `checks/student_verification_security.sql` afterward. Expected results:

- `student-verifications` is private, limited to 5,242,880 bytes, and permits
  only JPEG, PNG, and WebP MIME types.
- The duplicate-pending query returns no rows.
- The unique partial pending index exists and verification table RLS is enabled.
- All five named restrictive Storage policies appear alongside the owner and
  admin permissive policies.
- Anonymous verification reads, direct authenticated row insertion, student
  role updates, and student verification-status updates are all `false`.
- Both authenticated RPC EXECUTE checks are `true`, both anonymous RPC checks
  are `false`; the review RPC checks active-admin authorization internally.

The student upload path is `<auth-user-id>/<verification-uuid>/student-id.<ext>`.
After upload, call `submit_verification(p_verification_id, p_document_path)`
using the authenticated user's session. The RPC reads the caller's current
profile, checks the owned private upload, records the identity snapshot, and
atomically moves the profile to `pending`. A rejected student may submit a new
UUID/path; an existing pending or verified student cannot. On RPC failure,
remove the unsubmitted upload if possible. Do not insert verification rows or
update profile verification status directly from the browser.

The Step 4 migration also freezes all reviewed identity fields, including
`full_name`, for verified students. A trusted administrator must handle later
corrections; changing Auth user metadata does not change the reviewed profile.

### Live acceptance test

The read-only catalog checks cannot prove RLS behavior. After applying the
migration and assigning the first admin, test with separate browser sessions:

1. Register two ordinary student accounts, confirm their emails, and sign in.
   Neither account may open `/admin/verifications` or read the other's private
   ID image. Neither may update `role` or `verification_status` directly.
2. As student A, submit a valid ID with consent. Refresh `/verification` and
   confirm it shows pending; a second submission must be rejected. Check that
   the row snapshot matches the profile and that the document is in A's folder.
3. As the active admin, inspect that submission and reject it with a reason.
   Student A should see the reason and be able to submit a new image without
   overwriting the old record.
4. Approve the new pending request. The profile should become verified, a
   stale second review should fail, and student A should no longer be able to
   change the reviewed name, ID, course, or year level.
5. Suspend the admin and confirm the review page, RPC, and private document
   route deny access. Restore the admin only through a trusted process.

Run these as actual signed-in accounts through the application/API, not only
through SQL Editor: SQL Editor's privileged role bypasses normal RLS.

## Important behavior after applying Step 2

- Existing Auth users are backfilled into `public.profiles` as active,
  unverified students.
- New Auth users automatically receive the same safe defaults.
- Registration copies `full_name`, `student_id_number`, `course`, and
  `year_level`; the trigger ignores any client-supplied role or status values.
- Existing users cannot create or modify listings until an administrator marks
  them verified through the verification workflow.
- Unverified, pending, rejected, and suspended users cannot browse marketplace
  listings; they retain only the profile/verification or restricted-account
  access allowed by the application.
- Listings belonging to suspended, disabled, or unverified sellers are hidden
  from the marketplace Data API.
- Student verification documents use the private path
  `<user-id>/<verification-id>/student-id.<extension>`.
- Avatars use `<user-id>/avatar.<extension>`.

## Apply Step 5 marketplace authorization

Run `checks/marketplace_authorization_preflight.sql` before applying migration
5. Its three image-integrity counts should be zero. Then apply
`20260921000000_strengthen_marketplace_authorization.sql` and run
`checks/marketplace_authorization_security.sql`; every named check should be
`true`.

The `listing-images` bucket is private after Step 5. Store only the object path
in `listing_images.storage_path` and deliver files through an authenticated
download or a short-lived signed URL. The application currently creates
five-minute signed URLs after independently confirming a verified, active
student session. Do not restore public bucket access or use `getPublicUrl()`.

Catalog checks cannot substitute for user-scoped RLS testing. Test with an
anonymous request, pending/rejected student, verified active student, suspended
student with an existing session, and active administrator. Confirm direct Data
API listing reads, cross-owner listing changes, and cross-owner Storage writes
are denied in addition to checking the browser redirects. Features whose tables
or mutations do not yet exist (messages, notifications, favorites, and
reservations) must receive the same live-profile checks when implemented.

### Authorization rules for marketplace interaction tables

Migration 8 implements these rules using live-profile checks, participant- or
owner-scoped RLS, least-privilege table grants, and authenticated
security-definer RPCs:

| Feature | Required database authorization |
| --- | --- |
| Favorites | Verified active student; the row's `user_id` must equal `auth.uid()` for every read and mutation. |
| Conversations | Verified active student; only listed participants may read the conversation, and only a participant may initiate allowed changes. |
| Messages | Verified active student; sender must be `auth.uid()` and a current conversation participant; only participants may read. Suspension must immediately block sends. |
| Reservations | Verified active student; buyer must be `auth.uid()`, the referenced listing must be eligible, and only the buyer or seller may read or perform explicitly allowed state transitions. |
| Notifications | Not created in Step 7. Reservation requests are exposed directly on `/reservations`; a future notification table must be owner-scoped and system-written. |

Keep administrative moderation policies/RPCs separate from student policies.
An active administrator is not implicitly a marketplace buyer or seller.

After migration 6, run `checks/authorization_hardening_security.sql`. It also
fails when an unexpected permissive policy appears on a protected table, so a
later broad `USING (true)` policy cannot silently widen access.

Then run `checks/marketplace_authorization_rls_smoke.sql`. The matrix creates
disposable Auth users for every student/admin authorization state, exercises
the real `authenticated` role against profile, verification, listing, image,
Storage, and moderation policies, deletes every fixture, and reports a compact
`all_passed` result. It does not require or modify a real student account.

## Apply Step 6 listing creation

Apply `20260924000000_complete_listing_creation.sql`, then run
`checks/listing_creation_security.sql`. Every named check and the final
`__all_listing_creation_checks_passed__` row must be `true`. Rerun
`checks/marketplace_authorization_rls_smoke.sql`; its final result must report
all 47 scenarios passed.

New listings start as private `draft` rows. The authenticated seller uploads
one to five files to
`<seller-id>/<listing-id>/<image-uuid>.<jpg|jpeg|png|webp>`, inserts the ordered
image metadata, and calls `publish_listing(listing_id)`. The RPC changes the
status to `available` only after rechecking the live verified-active account,
active category, ownership, cover/order rules, and matching private Storage
objects. Ordinary authenticated clients cannot insert or update `status` or
change `seller_id` directly.

## Apply Step 7 listing browsing and management

Apply `20260925000000_complete_listing_browsing_management.sql` followed by
`20260926000000_harden_listing_interaction_lifecycle.sql` and
`20260926010000_allow_zero_price_listings.sql`, then run, in this order:

1. `checks/listing_management_security.sql`
2. `checks/listing_creation_security.sql`
3. `checks/marketplace_authorization_rls_smoke.sql`
4. `checks/listing_management_rls_smoke.sql`

Every named check and final summary row must be `true`. The Step 7 smoke test
creates three disposable verified students plus admin, pending, and suspended
test accounts. It exercises the actual `authenticated` role across favorite,
conversation, message, reservation, report, ownership, lifecycle, and account
restriction scenarios, then removes all fixtures before returning.

Published listing edits and seller status changes are RPC-only. This keeps
image metadata replacement, optimistic concurrency checks, reservation status,
and listing status changes atomic. Sellers soft-remove published listings;
hard deletion is limited to unpublished drafts through
`discard_listing_draft`. Step 7 intentionally does not create notifications;
reservation activity is shown directly on `/reservations`.

## Apply Step 8 marketplace search, filtering, and sorting

Apply `20260926020000_optimize_marketplace_browsing.sql`, then run
`checks/marketplace_browse_performance.sql`. Every named check and the final
`__all_marketplace_browse_checks_passed__` row must be `true`. Rerun
`checks/marketplace_authorization_rls_smoke.sql` after applying the migration
to confirm the existing authorization matrix remains unchanged.

The Step 8 indexes cover only `available` and `reserved` listings, matching the
normal marketplace query. The stored `search_text` column combines title and
description so the Data API can use one safely parameterized, case-insensitive
`ILIKE` filter instead of interpolating user input into raw PostgREST `or()`
syntax. Trigram and full-text search indexes are intentionally deferred until
production query plans and listing volume justify their write/storage cost.
Marketplace queries must still explicitly filter visible statuses because RLS
also allows a seller to read their own non-public listing history.

## Apply Step 9 favorites

Apply `20260926030000_complete_favorites.sql`, then run, in this order:

1. `checks/favorites_security.sql`
2. `checks/favorites_rls_smoke.sql`
3. `checks/listing_management_security.sql`
4. `checks/marketplace_authorization_rls_smoke.sql`

Every named catalog check and both smoke-test summaries must pass. The focused
favorites smoke test creates disposable Auth users, profiles, categories, and
listings. It exercises the real `anon` and `authenticated` roles, removes all
fixtures before committing, and does not modify a real student account.

The application must call
`set_listing_favorite(p_listing_id, p_should_favorite)` for mutations. The RPC
derives the user ID from `auth.uid()`; clients must never submit a `user_id`.
Setting the same desired state repeatedly is safe and leaves exactly one or
zero rows. Direct authenticated table writes remain revoked, and RLS limits
reads to the current verified active student's rows. The legacy
`toggle_listing_favorite(uuid)` RPC remains temporarily available for deployed
clients, but new code must use the deterministic setter.

Favorites retain the existing lifecycle choice from Step 7: `reserved`
listings remain saved, while sold or removed transitions delete their favorite
rows. Only available or reserved listings from an eligible seller can be newly
saved, and a seller cannot save their own listing. The composite primary key
`(user_id, listing_id)` is the duplicate-prevention constraint; a separate
surrogate ID is intentionally unnecessary.

## Bootstrap the first administrator

There is intentionally no public admin registration or role-change RPC. After
the intended admin has registered and confirmed email, check their exact UUID
in the Supabase Authentication dashboard and verify that its profile exists.
Then run this once in the SQL Editor, replacing the placeholder UUID with that
exact Auth user ID:

```sql
begin;
do $$
declare
  target_user_id uuid := 'AUTH-USER-UUID-HERE'::uuid;
  updated_count integer;
begin
  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'An administrator already exists; review it first.';
  end if;

  update public.profiles
  set role = 'admin', account_status = 'active'
  where id = target_user_id
    and role = 'student';

  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'Expected exactly one matching student profile.';
  end if;
end;
$$;
commit;
```

Then run `checks/student_verification_security.sql` and confirm exactly one
active admin. Never derive `role` from signup metadata or a name. This admin
promotion is intentionally manual and is not part of any migration.

## Admin database functions

Authenticated active administrators can call:

- `review_verification(verification_id, 'approved', null)`
- `review_verification(verification_id, 'rejected', 'Specific reason')`
- `admin_set_account_status(user_id, 'active' | 'suspended' | 'disabled')`
- `admin_remove_listing(listing_id)`

Each function checks the caller's current database profile. Possessing a user
ID or changing browser metadata does not grant administrator access.

## Supabase CLI migration history

The Supabase CLI is installed as a development dependency and this repository
has a local `supabase/config.toml`. The UC Marketplace project is linked, and
migration versions 1-11 are recorded as applied, including the Step 8 browsing
optimization. Migration 12 must appear there after Step 9 is applied with
`supabase db push`. Running SQL manually does not necessarily add entries to
`supabase_migrations.schema_migrations`.

On a new machine or for a different project, from the repository root run:

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref YOUR_PROJECT_REF
```

Enter the database password only into the CLI prompt. Do not paste an access
token or database password into chat, `.env.local`, or the repository.

Before pushing, inspect remote history with
`npx.cmd supabase migration list --linked` and compare it with the actual
schema and the preflight checks above. The migration list compares versions,
not schema contents. If a file was previously applied manually but is absent
from history, use `migration repair <version> --status applied --linked` only
after confirming the remote schema fully matches that migration. Do not use
repair simply because a table exists.

Then run `npx.cmd supabase db push --dry-run --linked`. The dry run previews
which files would run; it does not execute their SQL or validate existing data.
Only after reconciling history and passing the preflight checks should you run
`npx.cmd supabase db push --linked`, followed by another migration list and the
read-only security checks. Do not run `supabase db reset --linked` against the
remote project.

## Auth URL and email configuration

Keep **Confirm email** enabled in Supabase Auth. For the intended code flow,
the signup confirmation email must contain `{{ .Token }}` (the eight-digit
code) instead of a confirmation link. The application verifies it on
`/register/check-email` and then sends the student to Log In. Set
**Authentication -> Sign In / Providers -> Email -> Email OTP expiration** to
**60 seconds** in the hosted project when enabling that flow. Merely editing
`config.toml` or pushing database migrations does not update hosted Auth
settings. The local CLI config and `templates/confirmation.html` use the same
one-minute code flow.

**Hosted-project status:** the UC Marketplace project still uses Supabase's
default email provider. Supabase rejected the custom confirmation template on
this free-tier setup, so hosted registration continues to send a link and the
hosted OTP expiry remains 3,600 seconds. The application deliberately defaults
to this working link flow. To enable code entry, first configure custom SMTP
or a Supabase plan that permits template edits, then update the hosted **Confirm
sign up** template to show `{{ .Token }}` and set Email OTP expiration to 60
seconds. Only after both changes are live, set the server environment variable
`EMAIL_CONFIRMATION_MODE=code` and restart/redeploy the app. Do not enable code
mode while hosted Auth still sends confirmation links.

The default email provider only delivers to project-organization member
addresses and is heavily rate-limited. To send confirmations to ordinary
student inboxes, configure custom SMTP in Supabase Authentication settings;
do not disable email confirmation. If a message is missing, check
**Authentication -> Logs** for the send error, then the recipient's spam or
quarantine folder. See the [Supabase SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp).

The OTP expiry setting is project-wide: password-reset, invitation, email
change, and magic links also expire after one minute. Supabase normally limits
confirmation resends to once per minute. A timer shown only in the app would
not enforce expiry; Supabase Auth must enforce it.

In **Authentication -> URL Configuration**, use `http://localhost:3000` as the
development Site URL and allow these exact development redirect URLs:

- `http://localhost:3000/auth/confirm` (legacy confirmation links)
- `http://localhost:3000/auth/recovery` (password recovery)

Add the same paths for the production origin when it is deployed. Avoid a
broad wildcard in production. Set the application's trusted origin in
`.env.local` during development:

```text
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

In code mode, the confirmation template should display `{{ .Token }}` and not
include `{{ .ConfirmationURL }}`. The existing `/auth/confirm` route remains
for the current hosted link flow and links sent before a future switch.
Password recovery links should still point to:

```text
{{ .SiteURL }}/auth/recovery?token_hash={{ .TokenHash }}&type=recovery
```

Configure the Supabase Auth password policy to match the application: at least
12 characters with uppercase, lowercase, number, and symbol requirements.

## Secrets

The frontend uses only the browser-safe Supabase URL and publishable key from
`.env.local`. Never add a `service_role` key to a `NEXT_PUBLIC_*` variable,
browser code, Git, or this repository.
