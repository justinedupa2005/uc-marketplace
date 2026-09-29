begin;

-- Notifications are an awareness layer owned by the recipient. Trusted AFTER
-- triggers write them in the same transaction as the business event: a rolled
-- back message, reservation, verification, or moderation action leaves no
-- notification behind. Existing history is intentionally not backfilled.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  listing_id uuid references public.listings(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  reservation_id uuid references public.reservations(id) on delete set null,
  meetup_id uuid references public.meetups(id) on delete set null,
  is_read boolean not null default false,
  -- Use the actual insert clock rather than the transaction start time. The
  -- read-state snapshot RPC supplies a database-clock cutoff for the UI.
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  -- This key comes only from trusted event producers, never from the browser.
  -- A retried delivery of one event cannot add another row for that recipient.
  event_key text not null,
  constraint notifications_type_check check (
    type in (
      'message',
      'reservation_requested',
      'reservation_accepted',
      'reservation_rejected',
      'reservation_cancelled',
      'meetup_scheduled',
      'meetup_updated',
      'sale_completed',
      'verification_approved',
      'verification_rejected',
      'listing_removed',
      'account_suspended',
      'account_reactivated'
    )
  ),
  constraint notifications_title_check check (
    char_length(title) between 1 and 100 and title ~ '[^[:space:]]'
  ),
  constraint notifications_message_check check (
    char_length(message) between 1 and 500 and message ~ '[^[:space:]]'
  ),
  constraint notifications_event_key_check check (
    char_length(event_key) between 1 and 200 and event_key ~ '[^[:space:]]'
  ),
  constraint notifications_read_state_check check (
    is_read = (read_at is not null)
  ),
  constraint notifications_timestamps_finite_check check (
    isfinite(created_at) and (read_at is null or isfinite(read_at))
  ),
  constraint notifications_recipient_event_key unique (user_id, event_key)
);

create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc, id desc);
create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc, id desc)
  where is_read = false;
create index notifications_listing_idx
  on public.notifications (listing_id) where listing_id is not null;
create index notifications_conversation_idx
  on public.notifications (conversation_id) where conversation_id is not null;
create index notifications_reservation_idx
  on public.notifications (reservation_id) where reservation_id is not null;
create index notifications_meetup_idx
  on public.notifications (meetup_id) where meetup_id is not null;

alter table public.notifications enable row level security;
revoke all on table public.notifications from public, anon, authenticated;
grant select on table public.notifications to authenticated;

-- Verification and account-status notices must remain reachable even while a
-- student is unverified, pending, rejected, suspended, or disabled. Eligibility
-- checks still protect the linked marketplace resources independently.
create policy "Recipients can read their own notifications"
on public.notifications
for select
to authenticated
using (user_id = (select auth.uid()));

-- The helper has no Data API exposure. Every caller derives the recipient and
-- entity references from trusted source rows. Copy only a bounded listing
-- title into messages, never chat bodies, meetup notes/locations, student IDs,
-- verification reasons/documents, emails, or private moderation notes.
create or replace function private.create_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_event_key text,
  p_listing_id uuid default null,
  p_conversation_id uuid default null,
  p_reservation_id uuid default null,
  p_meetup_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (
    user_id, type, title, message, event_key,
    listing_id, conversation_id, reservation_id, meetup_id
  ) values (
    p_user_id, p_type, p_title, p_message, p_event_key,
    p_listing_id, p_conversation_id, p_reservation_id, p_meetup_id
  )
  on conflict (user_id, event_key) do nothing;
end;
$$;

revoke all on function private.create_notification(
  uuid, text, text, text, text, uuid, uuid, uuid, uuid
) from public, anon, authenticated;

create or replace function public.mark_notification_read(
  p_notification_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Sign in to manage your notifications.'
      using errcode = '42501';
  end if;

  update public.notifications
  set is_read = true, read_at = clock_timestamp()
  where id = p_notification_id
    and user_id = v_user_id
    and is_read = false;

  -- Idempotent calls preserve the first read_at. The same false response for
  -- an unknown ID and someone else's ID does not reveal another user's rows.
  return exists (
    select 1 from public.notifications
    where id = p_notification_id and user_id = v_user_id
  );
end;
$$;

create or replace function public.mark_all_notifications_read(
  p_before timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_before timestamptz := coalesce(p_before, statement_timestamp());
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Sign in to manage your notifications.'
      using errcode = '42501';
  end if;

  if not isfinite(v_before) then
    raise exception 'Refresh your notifications before marking them as read.'
      using errcode = '22023';
  end if;

  -- The UI sends its database-generated snapshot cutoff. Later inserted rows
  -- stay unread, and overlapping calls only count newly changed rows. As with
  -- any timestamp cutoff, an insert in an older transaction that commits after
  -- the page snapshot may still fall before the cutoff; this is not a promise
  -- that every marked row was displayed. No other recipient is ever updated.
  update public.notifications
  set is_read = true, read_at = clock_timestamp()
  where user_id = v_user_id
    and is_read = false
    and created_at <= v_before;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.get_my_notification_state()
returns table (unread_count bigint, snapshot_at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Sign in to view your notifications.'
      using errcode = '42501';
  end if;

  return query
  select count(*), statement_timestamp()
  from public.notifications as notification
  where notification.user_id = v_user_id
    and notification.is_read = false;
end;
$$;

revoke all on function public.mark_notification_read(uuid)
  from public, anon, authenticated;
revoke all on function public.mark_all_notifications_read(timestamptz)
  from public, anon, authenticated;
revoke all on function public.get_my_notification_state()
  from public, anon, authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read(timestamptz)
  to authenticated;
grant execute on function public.get_my_notification_state() to authenticated;

create or replace function private.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.conversations%rowtype;
  v_recipient uuid;
  v_listing_title text;
begin
  select conversation.* into v_conversation
  from public.conversations as conversation
  where conversation.id = new.conversation_id;

  if new.sender_id = v_conversation.buyer_id then
    v_recipient := v_conversation.seller_id;
  elsif new.sender_id = v_conversation.seller_id then
    v_recipient := v_conversation.buyer_id;
  else
    return new;
  end if;

  select left(regexp_replace(listing.title, '[[:space:]]+', ' ', 'g'), 120)
  into v_listing_title
  from public.listings as listing where listing.id = v_conversation.listing_id;

  perform private.create_notification(
    v_recipient, 'message', 'New message',
    'You received a new message about "' || v_listing_title || '".',
    'message:' || new.id::text,
    v_conversation.listing_id, new.conversation_id
  );
  return new;
end;
$$;

create or replace function private.notify_reservation_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_listing_title text;
  v_event_key text;
  v_type text;
  v_title text;
  v_message text;
  v_recipient uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  select left(regexp_replace(listing.title, '[[:space:]]+', ' ', 'g'), 120)
  into v_listing_title
  from public.listings as listing where listing.id = new.listing_id;
  v_event_key := 'reservation:' || new.id::text || ':' || new.status;

  if tg_op = 'INSERT' and new.status = 'pending' then
    v_recipient := new.seller_id;
    v_type := 'reservation_requested';
    v_title := 'New reservation request';
    v_message := 'A student requested to reserve your listing "' || v_listing_title || '".';
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    v_recipient := new.buyer_id;
    v_type := 'reservation_accepted';
    v_title := 'Reservation accepted';
    v_message := 'Your reservation request for "' || v_listing_title || '" was accepted.';
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'rejected' then
    v_recipient := new.buyer_id;
    v_type := 'reservation_rejected';
    v_title := 'Reservation declined';
    v_message := 'Your reservation request for "' || v_listing_title || '" was declined.';
  elsif tg_op = 'UPDATE' and old.status = 'accepted' and new.status = 'cancelled' then
    v_type := 'reservation_cancelled';
    v_title := 'Reservation cancelled';
    v_message := 'Your reservation for "' || v_listing_title || '" was cancelled.';
    if v_actor = new.buyer_id then
      v_recipient := new.seller_id;
    elsif v_actor = new.seller_id then
      v_recipient := new.buyer_id;
    elsif v_actor is not null and (select private.is_active_admin()) then
      -- Admin removal closes accepted reservations before removing the listing.
      -- Both participants need the transaction notice; no admin notes are copied.
      perform private.create_notification(
        new.seller_id, v_type, v_title, v_message, v_event_key,
        new.listing_id, null, new.id
      );
      v_recipient := new.buyer_id;
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'accepted' and new.status = 'completed' then
    v_recipient := new.buyer_id;
    v_type := 'sale_completed';
    v_title := 'Transaction completed';
    v_message := 'The seller marked your "' || v_listing_title || '" transaction as completed.';
  end if;

  if v_recipient is not null then
    perform private.create_notification(
      v_recipient, v_type, v_title, v_message, v_event_key,
      new.listing_id, null, new.id
    );
  end if;
  return new;
end;
$$;

create or replace function private.notify_meetup_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_recipient uuid;
  v_listing_title text;
  v_type text;
  v_title text;
  v_message text;
  v_event_key text;
begin
  if new.status not in ('proposed', 'scheduled') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status not in ('proposed', 'scheduled') or (
      new.location_name is not distinct from old.location_name
      and new.location_details is not distinct from old.location_details
      and new.scheduled_at is not distinct from old.scheduled_at
      and new.notes is not distinct from old.notes
    ) then
      return new;
    end if;
  end if;

  if v_actor = new.buyer_id then
    v_recipient := new.seller_id;
  elsif v_actor = new.seller_id then
    v_recipient := new.buyer_id;
  else
    return new;
  end if;

  select left(regexp_replace(listing.title, '[[:space:]]+', ' ', 'g'), 120)
  into v_listing_title
  from public.listings as listing where listing.id = new.listing_id;

  if tg_op = 'INSERT' then
    v_type := 'meetup_scheduled';
    v_title := 'Meetup scheduled';
    v_message := 'A meetup was scheduled for your "' || v_listing_title || '" reservation.';
    v_event_key := 'meetup:' || new.id::text || ':scheduled';
  else
    v_type := 'meetup_updated';
    v_title := 'Meetup updated';
    v_message := 'The meetup details for "' || v_listing_title || '" have been updated.';
    -- Step 11 gives each edit a strictly increasing updated_at token, including
    -- multiple edits in one transaction. Returning to previous details is still
    -- a new event, while an exact no-op never reaches notification creation.
    v_event_key := 'meetup:' || new.id::text || ':updated:'
      || extract(epoch from new.updated_at)::text;
  end if;

  perform private.create_notification(
    v_recipient, v_type, v_title, v_message, v_event_key,
    new.listing_id, null, new.reservation_id, new.id
  );
  return new;
end;
$$;

create or replace function private.notify_verification_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'pending'
    or new.status not in ('approved', 'rejected')
    or new.reviewed_by is distinct from (select auth.uid())
    or not (select private.is_active_admin())
  then
    return new;
  end if;

  if new.status = 'approved' then
    perform private.create_notification(
      new.user_id, 'verification_approved', 'Verification approved',
      'Your student verification has been approved. You now have access to the marketplace.',
      'verification:' || new.id::text || ':approved'
    );
  else
    perform private.create_notification(
      new.user_id, 'verification_rejected', 'Verification needs attention',
      'Your student verification was not approved. Review the reason and submit again.',
      'verification:' || new.id::text || ':rejected'
    );
  end if;
  return new;
end;
$$;

create or replace function private.notify_listing_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing_title text;
begin
  if new.status <> 'removed'
    or old.status = 'removed'
    or (select auth.uid()) is null
    or not (select private.is_active_admin())
  then
    return new;
  end if;

  v_listing_title := left(regexp_replace(new.title, '[[:space:]]+', ' ', 'g'), 120);
  perform private.create_notification(
    new.seller_id, 'listing_removed', 'Listing removed',
    'Your listing "' || v_listing_title || '" was removed by an administrator.',
    'listing:' || new.id::text || ':removed', new.id
  );
  return new;
end;
$$;

create or replace function private.notify_account_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_key text;
begin
  if new.role <> 'student'
    or old.role <> 'student'
    or new.account_status is not distinct from old.account_status
    or (select auth.uid()) is null
    or not (select private.is_active_admin())
  then
    return new;
  end if;

  -- Every actual transition gets its own event version. Profile updated_at
  -- uses transaction-time now(), so it cannot distinguish repeated suspend /
  -- reactivate transitions in the same transaction. No-op RPC retries are
  -- filtered above instead; a later legitimate transition is never suppressed.
  v_event_key := 'account:' || new.id::text || ':' || new.account_status
    || ':' || gen_random_uuid()::text;

  if new.account_status in ('suspended', 'disabled') then
    perform private.create_notification(
      new.id, 'account_suspended',
      case when new.account_status = 'suspended'
        then 'Account suspended' else 'Account disabled' end,
      case when new.account_status = 'suspended'
        then 'Your marketplace account has been suspended.'
        else 'Your marketplace account has been disabled.' end,
      v_event_key
    );
  elsif new.account_status = 'active'
    and old.account_status in ('suspended', 'disabled')
  then
    perform private.create_notification(
      new.id, 'account_reactivated', 'Account reactivated',
      'Your marketplace account has been reactivated.', v_event_key
    );
  end if;
  return new;
end;
$$;

revoke all on function private.notify_new_message()
  from public, anon, authenticated;
revoke all on function private.notify_reservation_event()
  from public, anon, authenticated;
revoke all on function private.notify_meetup_event()
  from public, anon, authenticated;
revoke all on function private.notify_verification_review()
  from public, anon, authenticated;
revoke all on function private.notify_listing_removed()
  from public, anon, authenticated;
revoke all on function private.notify_account_status_change()
  from public, anon, authenticated;

create trigger messages_95_notify_recipient
after insert on public.messages
for each row execute function private.notify_new_message();
create trigger reservations_95_notify_participant
after insert or update of status on public.reservations
for each row execute function private.notify_reservation_event();
create trigger meetups_95_notify_participant
after insert or update of location_name, location_details, scheduled_at, notes
on public.meetups
for each row execute function private.notify_meetup_event();
create trigger verifications_95_notify_review
after update of status on public.verifications
for each row execute function private.notify_verification_review();
create trigger listings_95_notify_removal
after update of status on public.listings
for each row execute function private.notify_listing_removed();
create trigger profiles_95_notify_account_status
after update of account_status on public.profiles
for each row execute function private.notify_account_status_change();

comment on table public.notifications is
  'Recipient-owned, database-created event notifications. Clients can read their own rows and change read state only through owner-scoped RPCs.';
comment on column public.notifications.event_key is
  'Internal trusted producer key, unique per recipient; excludes arbitrary client recipients and duplicate deliveries of the same source event.';
comment on function public.mark_notification_read(uuid) is
  'Marks an owned notification read and preserves its first read_at. Returns false for both nonexistent and other recipients notifications.';
comment on function public.mark_all_notifications_read(timestamptz) is
  'Marks only this recipient unread notifications created at or before the database snapshot cutoff; returns the changed row count.';
comment on function public.get_my_notification_state() is
  'Reads this recipient unread count under RLS and returns a database-clock snapshot cutoff for listing and mark-all actions.';

commit;
