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
13. `20260927000000_complete_messaging.sql`
   - Completes read receipts, adds latest-message and unread indexes, and adds
     a participant-scoped UI-safe conversation summary RPC without granting
     authenticated clients direct message writes.
14. `staged/20260927010000_enable_messaging_realtime.sql`
   - Idempotently adds only `public.messages` to the `supabase_realtime`
     publication after the database-only two-account flow has passed. It stays
     outside `migrations/` until that acceptance gate is complete.
15. `20260928000000_complete_reservations_and_meetups.sql`
   - Completes reservation history, private meetup scheduling, atomic
     acceptance/cancellation/sale RPCs, participant messaging, and retained
     sold favorites. Run the Step 11 preflight before applying it.
16. `20260929000000_complete_notifications.sql`
   - Adds recipient-owned notifications, read-state RPCs, and atomic event
     triggers for messaging, reservations, meetups, verification, and existing
     administrator moderation. Does not backfill historical notifications.

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

Step 11 supersedes the sold cleanup rule: existing favorites remain saved after
a sale and show Sold. Removed listings still clear favorites, and sold listings
cannot be newly saved.

## Apply Step 10 messaging

Apply `20260927000000_complete_messaging.sql` first. Before applying the
Realtime migration, run `checks/messaging_rls_smoke.sql` and complete the
database-only flow with two separate verified active accounts:

1. The buyer starts a conversation from an available listing and receives the
   same conversation ID when trying again.
2. The buyer sends a message and the seller sees it after a refresh.
3. The seller opens the thread, calls `mark_conversation_read(uuid)`, and the
   buyer's message receives a `read_at` timestamp.
4. The seller replies and the buyer sees the reply after a refresh.

The application must use `start_listing_conversation(uuid)`,
`send_conversation_message(uuid,text)`, and
`mark_conversation_read(uuid)` for mutations. Authenticated clients retain
SELECT-only table privileges. The database derives buyer, seller, and sender
identity from `auth.uid()` and the referenced listing/conversation.

The core migration enforces the stronger non-whitespace message constraint for
all new writes. It validates that constraint immediately when existing rows are
clean. If a legacy newline/tab-only message exists, the migration still applies
but `checks/messaging_security.sql` reports the constraint as unvalidated until
that row is deliberately reviewed and the constraint is validated.

Use `get_my_conversation_summaries(p_conversation_id uuid default null)` for
conversation-list and header data. Passing `NULL` returns all conversations for
the caller; passing an ID returns at most that caller's matching conversation.
The function exposes only participant-safe profile fields, listing context,
the latest message, unread count, timestamps, and `can_send`; it does not load
message history or expose student IDs, account status, verification documents,
email, or moderation data. A missing or no-longer-eligible profile is labeled
`Former UC Student`, with no avatar or verification badge, so the projection
does not reveal why that account is unavailable.

Status behavior remains deliberate:

- `available` and `reserved`: allow new conversations and messages.
- `sold`: reject new conversations, but preserve and allow messages in an
  existing conversation.
- `removed`: preserve readable history while rejecting new conversations and
  messages.
- Pending, unverified, suspended, disabled, and administrator accounts cannot
  use student messaging RPCs or read student conversations.
- If either participant becomes ineligible, the active participant retains the
  existing history but the conversation becomes read-only.

Before Step 11, permanent Auth-user deletion cascades its profile,
conversations, and messages. Step 11 blocks hard deletion of listing owners
and reservation participants to preserve transaction history and prevent
orphaned reserved listings. Use suspension or disablement for these accounts.

The private listing-image policies allow buyers to fetch images only while a
listing is `available` or `reserved`. The summary therefore returns a sold or
removed image path only to the listing owner and returns `NULL` to the buyer.
Do not broaden listing or Storage RLS merely to make sold-listing links or
thumbnails work; the buyer UI should show retained text context without a live
listing link in those states.

Step 11 adds narrowly scoped private image reads for verified active
conversation/reservation participants and existing sold-favorite owners.
Sold listing detail access is still restricted to the seller and owners of an
existing favorite; removed listing details remain hidden from buyers.

Only after the database-only two-account flow passes, move
`staged/20260927010000_enable_messaging_realtime.sql` into `migrations/`, run
the migration dry run, and apply it. Then run
`checks/messaging_security.sql`. Every named row and
`__all_messaging_security_checks_passed__` must be `true`. Test Realtime with
two separate browser sessions. Subscribe only to message INSERT and read-status
UPDATE events filtered to the active `conversation_id`, deduplicate by the
persisted message UUID, and unsubscribe when leaving or switching
conversations. RLS remains mandatory; Realtime is not a replacement for the
normal database flow.

```powershell
Move-Item -LiteralPath .\supabase\staged\20260927010000_enable_messaging_realtime.sql -Destination .\supabase\migrations\20260927010000_enable_messaging_realtime.sql
npx.cmd supabase db push --dry-run --linked
npx.cmd supabase db push --linked
```

## Apply Step 11 reservations and meetups

Run `checks/reservation_meetup_preflight.sql` before applying
`20260928000000_complete_reservations_and_meetups.sql`. All issue counts must
be zero. The migration backfills legacy response/completion timestamps and
fails atomically if reservation/listing history is inconsistent.

After reconciling migration history, preview with
`npx.cmd supabase db push --dry-run --linked`, then apply the new migration
once. Run these checks afterward:

1. `checks/reservation_meetup_security.sql`
2. `checks/reservation_meetup_rls_smoke.sql`
3. `checks/favorites_security.sql` and `checks/favorites_rls_smoke.sql`
4. `checks/listing_management_security.sql` and
   `checks/listing_management_rls_smoke.sql`
5. `checks/authorization_hardening_security.sql` and
   `checks/marketplace_authorization_rls_smoke.sql`
6. `checks/messaging_rls_smoke.sql`

All named checks and smoke-test summaries must pass. Smoke tests create only
disposable accounts/resources and remove their fixtures before committing.
Do not substitute privileged SQL Editor reads for the authenticated-role matrix.

The frontend uses reservation RPCs exclusively; direct reservation/meetup
writes remain revoked. Meetup edits send the `updated_at` value captured when
the form opened. A stale edit fails instead of overwriting newer details.
Acceptance reserves the item and rejects competing requests in one transaction;
cancellation restores availability and cancels any active meetup; seller sale
completion updates the listing, reservation, and any meetup together.

Test separate verified active buyer/seller browser sessions through request,
acceptance, meetup creation/editing, cancellation, and completion, refreshing
each page. Add a second buyer and two seller tabs to verify competing acceptance
still produces one accepted reservation. Complete the in-person exchange before
confirming Mark Sold. No payment is processed in the application.

Regenerate database types after applying the migration and remove the applied
reservation additions from the pending schema overlay in
`src/types/database.ts`. This migration is required for the Step 11 UI.

## Apply Step 12 notifications

Apply `20260929000000_complete_notifications.sql` only after the Step 10
messaging and Step 11 reservation migrations. It creates a new empty table
and adds event triggers; it does not rewrite previous migrations or notify
students about historical events. Preview pending migrations with
`npx.cmd supabase db push --dry-run --linked` before applying them once through
the normal migration workflow.

Run `checks/notifications_security.sql` and
`checks/notifications_rls_smoke.sql` afterward. Also rerun the Step 10 messaging,
Step 11 reservation, favorites, listing-management, and marketplace
authorization smoke tests to check the existing workflows with the new
triggers. All named checks and smoke summaries must pass. These smoke tests
use disposable fixtures and explicitly exercise the authenticated/anonymous
roles rather than relying on privileged reads.

Notifications are created in the business event's transaction. Their
recipient and related IDs come from trusted database rows. Event keys
deduplicate repeat deliveries, and no-op updates do not create notifications.
Accepted-reservation cancellation alerts the other participant (or both
participants when an administrator closes the reservation). Pending-request
withdrawal and terminal meetup status changes do not generate redundant
notifications. Meetup alerts contain no location, notes, or schedule details;
message alerts contain no chat body. Verification reasons, identity documents,
student IDs, emails, and private admin notes stay out of notification text.

Authenticated users can SELECT only their own notifications. Direct INSERT,
UPDATE, and DELETE are revoked; `mark_notification_read(uuid)` and
`mark_all_notifications_read(timestamptz)` can change only the caller's read
state. Individual acknowledgement preserves its original `read_at` on retry.
`get_my_notification_state()` returns the caller's unread count and a
database-clock cutoff. Mark-all uses that exact cutoff, including timestamp
precision, so notifications created later remain unread. As with any timestamp
cutoff, an older transaction committing after the snapshot may include a row
that was not displayed; it is not a strict "visible rows only" guarantee.

The `/notifications` inbox is deliberately accessible to unverified, pending,
rejected, suspended, and disabled accounts so they can read verification and
account-status notices. Authentication and password-recovery checks still
apply. This exception does not grant access to marketplace transactions or
linked resources, which retain their existing authorization rules.

The inbox loads 20 rows per page, newest first, and never marks them read just
by loading. Bell counts come from the database; successful read actions
refresh the shared layouts. The existing focus/visibility and one-minute
access refresh also picks up incoming events. Notifications are not added to
the Realtime publication in this migration; Realtime remains optional and is
not required for persisted notifications.

Before hosted acceptance, use separate seller, buyer, and administrator
sessions to test message receipt, request/accept/reject/cancel, meetup
schedule/edit, completed sale, verification review, and account moderation.
Check recipient-only delivery, safe links, matching unread badges, first-read
timestamps, mark-all with a newly arriving event, and persistence after refresh
and logout/login. Confirm that an unverified or suspended student can read
their inbox but cannot use linked marketplace actions. Regenerate database
types after applying the migration and remove the applied notification
additions from the pending schema overlay in `src/types/database.ts`.

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
migration versions are recorded when applied with `supabase db push`.
Compare the exact versions rather than the numbered list above, which also
includes an optional staged Realtime migration. Running SQL manually does not
necessarily add entries to `supabase_migrations.schema_migrations`.

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
