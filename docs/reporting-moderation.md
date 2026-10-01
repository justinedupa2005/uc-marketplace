# Step 13: reporting and admin moderation

This is the operational and acceptance guide for the implemented reporting
workflow. It supplements the [migration instructions](../supabase/README.md),
which must be followed before enabling the UI against a hosted database.

## Student-facing reporting

An active, verified student can report an available or reserved listing from
its detail page. The existing listing-report form offers controlled reasons,
optional details of at most 1,000 characters, and requires a useful explanation
for **Other**. Reports are private. The seller does not see who reported the
listing or the report text. A repeat submission while the same student has an
open report for that listing returns the existing report instead of creating a
duplicate.

The same buyer-facing listing page offers **Report student** for the seller.
Conversation headers also offer **Report student** for the other participant,
including when the related listing has been removed and the conversation is
read-only.
Controlled reasons are scam, harassment, abusive behavior, impersonation,
unsafe meetup, spam, and other. The explanation is required for Other and is
limited to 1,000 characters. The database derives the reporter from the
session, rejects self-reporting, and requires a relevant seller relationship:
an active listing, a saved listing, a conversation, or a reservation. The
browser cannot supply a reporter ID or use this RPC to report an arbitrary
unrelated account. An open reporter–subject pair is deduplicated; after the
previous report is closed, a genuinely new incident can be reported.

Report submissions do not automatically sanction another student. They
create a moderation case for a human review. Server Actions check the
current session and validate shape; database RPCs independently enforce
eligibility, relationships, reason constraints, and duplicate rules. Errors
shown to students are actionable but do not reveal private report or account
details.

## Admin workspace

Only active administrator profiles can use these routes:

| Route | Purpose |
| --- | --- |
| `/admin` | Overview of pending verification and reports, active listings, and suspended students. |
| `/admin/verifications` | Existing private identity-review workflow; approve or reject a pending submission. |
| `/admin/users` | Filter/search student accounts; inspect verification and account status. |
| `/admin/listings` | Filter/search listings, inspect content, then remove an inappropriate listing. |
| `/admin/reports` | Filter listing or student reports by status and review the case context. |

The users, listings, and reports areas also have detail pages for the selected
record. Lists are paginated, newest first, and show distinct loading, empty,
and error states. A report's reporter, subject, details, and reviewer note
are admin-only context; report subjects must not gain read access simply
because their profile or listing is involved.

The admin can suspend or reactivate a student, remove a listing, and resolve
or dismiss a report. Each decision requires a written 10–500 character reason
or note. Suspending/reactivating a student and removing a listing call audited
database wrappers. These write a private immutable audit record in the same
transaction as the status change. The old unaudited client-callable RPCs are
revoked. The wrappers reject no-op retries, invalid targets, self-suspension,
and moderation of other administrators. Removing a listing retains its
history and follows the established reservation/meetup cancellation path;
Step 12 notifications still alert affected parties without copying private
admin reasons.

**Resolve** means the report was reviewed and the admin recorded an outcome;
it does not by itself remove a listing or suspend someone. **Dismiss** means
the admin reviewed the case and chose not to take a moderation action. A
resolved or dismissed report retains its review timestamp and reviewer. The
note is not selectable through the student-readable report columns and is
retrieved only by an active-admin-only RPC. Only pending/reviewing reports
can move to a terminal decision; a stale second review fails.

Verification remains separate: the existing `/admin/verifications` screens
and `review_verification` RPC approve or reject student identity documents.
The report queue is not a shortcut for granting verification or changing
roles. The first administrator is still bootstrapped manually as documented
in the Supabase setup guide.

## Access and privacy boundaries

- Anonymous users cannot submit or read reports or call moderation RPCs.
- Verified active students can report, and can read only their own safe
  report columns. The subject never gets the reporter's case details.
- Suspended/unverified users cannot submit new reports. Their notification
  inbox remains accessible so account-status notices can still be read.
- Active admins can read all cases and use review/moderation RPCs. Direct
  table writes are revoked; report decisions and audit records are written
  only by trusted database functions.
- Student ID images, email addresses, chat contents, meetup location/notes,
  and internal moderator reasons are not copied into notifications. Private
  audit rows are not exposed through the public Data API.

## Acceptance checks before launch

Apply pending migrations in filename order. Run the Step 13 catalog and RLS
checks plus the prior workflows' checks. SQL Editor reads using the privileged
database owner do **not** prove student/admin RLS behavior; the smoke tests
must exercise real `authenticated`/`anon` roles and their JWT identity.

Then use three separate browser sessions: seller, buyer, and administrator.

1. Buyer reports seller's listing and seller account. Verify each report
   appears only in the admin queue, with correct target/context and no
   duplicate on retry. Try an unrelated target and self-report; both must fail.
2. Log in as seller. Confirm neither report's reporter identity nor private
   text is visible. Log out and confirm anonymous report access is denied.
3. Admin opens each detail, checks evidence and context, removes the listing
   or suspends the student with a reason, then resolves the report with a note.
   Verify the listing is absent from public browsing; a suspended student
   cannot use marketplace actions but can read their account notification.
4. Admin tests a separate report dismissal and verifies the case remains
   historically visible without a sanction. Repeated decisions should fail
   cleanly, preserving the first review metadata and audit history.
5. Admin reactivates the student with a reason. Verify the account status,
   notification, and restored access after refresh. An admin must not be
   able to suspend themselves or another admin through these wrappers.
6. Admin approves and rejects separate pending student verification cases
   using the existing verification workflow. Verify normal reporting did
   not alter either verification decision.

Refresh pages and sign out/in between checks: reports, decisions, and audit
history must persist in the database. Optional Realtime is not the source of
truth. Running these browser checks against the hosted project is still
required after its migrations are actually applied.
