# Step 14: profiles and account settings

`/profile` renders the authenticated account's current `profiles` record.
It displays the uploaded avatar (or initials/generic icon), name, course,
year level, verification state, account status, and joined date. There are no
ratings, reviews, fake avatars, placeholder counts, or unfinished menu links.
The joined date uses `profiles.created_at`, formatted in Asia/Manila.

`/profile/edit` saves only explicitly allowed profile fields and manages the
separate avatar. `/profile/change-password` updates Supabase Auth, and Log Out
revokes the current device's session and clears protected route content.
Authentication is checked on every page and Server Action; the browser does
not choose the private profile's user ID.

## Editing and verification

The established verification snapshot remains authoritative for a student's
reviewed identity. This implementation allows normal year progression without
letting an approved student rewrite their verified name, course, or ID.

| Student state | Name/course | Year level | Avatar | Account/password |
| --- | --- | --- | --- | --- |
| Active, unverified/rejected | Editable | Editable | Editable | Accessible |
| Active, pending | Locked | Locked | Editable | Accessible |
| Active, verified | Locked | Editable | Editable | Accessible |
| Suspended/disabled | Read-only | Read-only | Read-only | Accessible |

The private edit page does not display or edit student ID numbers. Identity
corrections after verification require administrator assistance. Pending
students can review their existing verification submission; rejected students
can correct editable information before resubmitting through `/verification`.
Admins can update their own display name and avatar; student academic fields
are not part of the administrator form.

Names are trimmed and limited to 2–100 characters. Student courses use the
existing course allowlist and year level is 1–5. The form sends no role,
verification status, account status, or creation date. Column privileges,
ownership RLS, and database triggers protect those fields against direct API
attempts too. A saved profile version prevents silently overwriting a newer
edit or verification change.

## Avatar lifecycle

Only separate profile photos belong in the public `avatars` bucket. School
IDs and verification documents stay in `student-verifications`; they never
become profile images automatically. Public avatar URLs are intended for
marketplace display and can be fetched without a signed URL.

The browser checks JPEG/PNG/WebP and the 2 MiB limit before previewing. The
server checks both again, including the image signature. Preview object URLs
are revoked on replacement, cancellation, success, and unmount. Missing or
failed image downloads fall back to initials or a generic icon.

A replacement uploads to a fresh authenticated-owner path, then links the
object to the profile only if the previous avatar reference still matches.
Storage and the profile trigger enforce ownership and the real object's
existence. Only after the link is confirmed does cleanup delete the old,
unreferenced owned photo. Concurrent linking/deletion uses database locks,
and cleanup failure does not report an otherwise successful save as failed.
An incomplete upload may leave an unreferenced owned object if cleanup is
temporarily unavailable; it cannot replace or erase the current photo.

## Private and seller views

`/users/[userId]` is a marketplace seller profile for authenticated, verified,
active students. Listing seller cards link to it. It queries only the fixed
safe `marketplace_profiles` projection: ID, name, course, year, avatar path,
verification badge, and joined date. Suspended, disabled, unverified, and
administrator accounts do not appear as public sellers.

Only available/reserved listings appear, in bounded, paginated queries.
Favorite buttons reflect the viewer's own saved state. They do not reveal the
seller's favorites or counts. Opening a listing preserves a return link to
the seller profile.

Neither the public profile query nor its serialized data includes email,
student ID, verification documents/rejection reasons, internal moderation
notes, auth metadata, favorites, reservations, meetups, or messages. There
is no public URL for a verification document on either profile view. Missing
profiles show an unavailable state rather than fabricating identity data.

## Passwords and sessions

Registration, recovery, and account changes share the same password schema:
12–256 characters with uppercase, lowercase, number, and symbol, plus matching
confirmation. Passwords are never stored in profile rows or application logs.

The account change form requires the current password. The action verifies it
with Supabase Auth using the current account's server-validated email and an
isolated client with no persistent storage or SSR cookie writes. It confirms
the same user ID and revokes that temporary local session. This avoids relying
on the optional hosted current-password setting. The actual password change
uses the original authenticated client and keeps that device signed in.

When secure password changes require an email nonce, the form offers a code
request and verification input. Code delivery depends on the project's Auth
email configuration. [Supabase documents both reauthentication and current-password settings](https://supabase.com/docs/guides/auth/password-security).

Logout has a pending state, clears the recovery marker after successful
sign-out, invalidates the protected router cache, and redirects to login. A
sign-out failure returns to the private profile with a retry notice.

## Deployment and acceptance

Apply the forward migration in filename order using the
[Supabase rollout instructions](../supabase/README.md), then regenerate types.
Run `npm run check`, the production build, and the new profile security/RLS
checks with the previous workflows' regression checks. Embedded SQL testing
emulates Supabase auth/storage; hosted HTTP, Auth, and browser testing remains
necessary after migration deployment.

Use separate Student A, Student B, pending/rejected, suspended, and admin
sessions for these acceptance checks:

1. Open `/profile`, edit allowed data, save, and refresh/sign in again. Verify
   real values persist, joined date remains stable, and no reviews appear.
2. With a verified account, change year successfully and reject name/course/ID
   or role/status changes through direct API requests. Pending identity changes
   must fail. Attempt to edit another student's profile; it must fail.
3. Upload and replace valid avatars. Reject invalid types, oversized/empty
   files, and claimed PNGs with non-image signatures. Test cross-user uploads,
   non-owned references, and deletion of a current avatar. Refresh and confirm
   the saved photo or fallback. Simulate failed upload/link without losing the
   previous photo.
4. Student B opens A's seller profile and listing cards. Confirm only safe
   identity and active listings are present in HTML/data/API responses. Verify
   anonymous and ineligible viewers cannot browse profiles; removed/ineligible
   sellers return unavailable. Private favorites and transaction history must
   remain inaccessible.
5. Test wrong current password, weak password, mismatched confirmation, valid
   change, and the nonce-required path. Confirm old credentials fail and new
   credentials work. Verify no extra persistent sign-in session is retained.
6. Approve/reject/suspend/reactivate through admin tools and refresh the profile.
   The badge and account notice must reflect the database. Restricted accounts
   can access their own profile/password/notifications but cannot edit it or
   use marketplace mutations.
7. Log out, then revisit `/profile`, seller profiles, favorites, messages,
   reservations, listings, and admin routes. The validated session must be
   rejected and private content must not survive navigation as authenticated UI.
