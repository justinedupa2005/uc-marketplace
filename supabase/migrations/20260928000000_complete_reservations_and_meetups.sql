begin;

-- Step 11: complete the reservation -> meetup -> sale lifecycle without
-- widening direct table-write privileges. All state transitions remain
-- database-owned and use one lock order: listing, reservation, meetup.

-- Marketplace accounts are soft-disabled through profiles.account_status.
-- Prevent hard Auth/profile deletion from cascading away listings or
-- transaction history (and, for an accepted buyer, orphaning a reserved
-- listing with no accepted reservation).
alter table public.listings
  drop constraint if exists listings_seller_id_fkey;
alter table public.listings
  add constraint listings_seller_id_fkey
  foreign key (seller_id) references auth.users(id) on delete restrict;

alter table public.reservations
  drop constraint if exists reservations_buyer_id_fkey,
  drop constraint if exists reservations_seller_id_fkey;
alter table public.reservations
  add constraint reservations_buyer_id_fkey
    foreign key (buyer_id) references public.profiles(id) on delete restrict,
  add constraint reservations_seller_id_fkey
    foreign key (seller_id) references public.profiles(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Reservation history and lifecycle timestamps
-- ---------------------------------------------------------------------------

alter table public.reservations
  add column if not exists message text,
  add column if not exists responded_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists completed_at timestamptz;

-- Earlier reservation functions did not record transition timestamps. Use the
-- last row-change timestamp as the least-surprising historical approximation,
-- while preserving updated_at itself during the one-time backfill.
alter table public.reservations
  disable trigger reservations_90_set_updated_at;

update public.reservations
set
  responded_at = case
    when status in ('accepted', 'rejected', 'completed')
      then coalesce(responded_at, updated_at)
    else responded_at
  end,
  cancelled_at = case
    when status = 'cancelled' then coalesce(cancelled_at, updated_at)
    else cancelled_at
  end,
  completed_at = case
    when status = 'completed' then coalesce(completed_at, updated_at)
    else completed_at
  end
where
  (status in ('accepted', 'rejected', 'completed') and responded_at is null)
  or (status = 'cancelled' and cancelled_at is null)
  or (status = 'completed' and completed_at is null);

alter table public.reservations
  enable trigger reservations_90_set_updated_at;

alter table public.reservations
  add constraint reservations_message_check check (
    message is null
    or (
      char_length(message) between 1 and 500
      and message ~ '[^[:space:]]'
      and message = regexp_replace(
        message,
        '^[[:space:]]+|[[:space:]]+$',
        '',
        'g'
      )
    )
  ) not valid,
  add constraint reservations_response_timestamp_check check (
    (
      status in ('accepted', 'rejected', 'completed')
      and responded_at is not null
    )
    or (
      status in ('pending', 'cancelled')
      and (
        responded_at is null
        or status = 'cancelled'
      )
    )
  ) not valid,
  add constraint reservations_cancelled_timestamp_check check (
    (status = 'cancelled') = (cancelled_at is not null)
  ) not valid,
  add constraint reservations_completed_timestamp_check check (
    (status = 'completed') = (completed_at is not null)
  ) not valid,
  add constraint reservations_timestamp_order_check check (
    (responded_at is null or responded_at >= created_at)
    and (cancelled_at is null or cancelled_at >= created_at)
    and (completed_at is null or completed_at >= created_at)
  ) not valid;

alter table public.reservations
  validate constraint reservations_message_check;
alter table public.reservations
  validate constraint reservations_response_timestamp_check;
alter table public.reservations
  validate constraint reservations_cancelled_timestamp_check;
alter table public.reservations
  validate constraint reservations_completed_timestamp_check;
alter table public.reservations
  validate constraint reservations_timestamp_order_check;

-- The wide key lets the meetup foreign key prove that every denormalized
-- listing and participant ID came from the same reservation row.
create unique index if not exists reservations_identity_key
  on public.reservations (id, listing_id, buyer_id, seller_id);

-- Fail forward migration instead of silently rewriting inconsistent business
-- history. Existing RPC-only writes should already satisfy these invariants.
do $$
begin
  if exists (
    select 1
    from public.reservations as reservation
    join public.listings as listing on listing.id = reservation.listing_id
    where reservation.status = 'accepted'
      and listing.status <> 'reserved'
  ) then
    raise exception 'Accepted reservations must belong to reserved listings.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.listings as listing
    where listing.status = 'reserved'
      and not exists (
        select 1
        from public.reservations as reservation
        where reservation.listing_id = listing.id
          and reservation.status = 'accepted'
      )
  ) then
    raise exception 'Reserved listings must have one accepted reservation.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.reservations as reservation
    join public.listings as listing on listing.id = reservation.listing_id
    where reservation.status = 'pending'
      and listing.status <> 'available'
  ) then
    raise exception 'Pending reservations must belong to available listings.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.reservations as reservation
    join public.listings as listing on listing.id = reservation.listing_id
    where reservation.status = 'completed'
      and listing.status not in ('sold', 'removed')
  ) then
    raise exception 'Completed reservations must belong to sold listing history.'
      using errcode = '23514';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- One meetup per reservation
-- ---------------------------------------------------------------------------

create table public.meetups (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null,
  listing_id uuid not null references public.listings(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'proposed' check (
    status in ('proposed', 'scheduled', 'cancelled', 'completed')
  ),
  location_name text not null,
  location_details text,
  scheduled_at timestamptz not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  constraint meetups_reservation_key unique (reservation_id),
  constraint meetups_reservation_context_fkey
    foreign key (reservation_id, listing_id, buyer_id, seller_id)
    references public.reservations (id, listing_id, buyer_id, seller_id)
    on delete cascade,
  constraint meetups_participants_differ check (buyer_id <> seller_id),
  constraint meetups_location_name_check check (
    char_length(location_name) between 2 and 120
    and location_name ~ '[^[:space:]]'
    and location_name = regexp_replace(
      location_name,
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    )
  ),
  constraint meetups_location_details_check check (
    location_details is null
    or (
      char_length(location_details) between 1 and 300
      and location_details ~ '[^[:space:]]'
      and location_details = regexp_replace(
        location_details,
        '^[[:space:]]+|[[:space:]]+$',
        '',
        'g'
      )
    )
  ),
  constraint meetups_notes_check check (
    notes is null
    or (
      char_length(notes) between 1 and 500
      and notes ~ '[^[:space:]]'
      and notes = regexp_replace(
        notes,
        '^[[:space:]]+|[[:space:]]+$',
        '',
        'g'
      )
    )
  ),
  constraint meetups_schedule_finite_check check (isfinite(scheduled_at)),
  constraint meetups_cancelled_timestamp_check check (
    (status = 'cancelled') = (cancelled_at is not null)
  ),
  constraint meetups_completed_timestamp_check check (
    (status = 'completed') = (completed_at is not null)
  ),
  constraint meetups_timestamp_order_check check (
    (cancelled_at is null or cancelled_at >= created_at)
    and (completed_at is null or completed_at >= created_at)
  )
);

create index meetups_buyer_status_scheduled_idx
  on public.meetups (buyer_id, status, scheduled_at);
create index meetups_seller_status_scheduled_idx
  on public.meetups (seller_id, status, scheduled_at);
create index meetups_listing_created_idx
  on public.meetups (listing_id, created_at desc);

-- Meetup edits use updated_at as their optimistic concurrency token. Unlike
-- now(), clock_timestamp() advances within a transaction; the minimum increment
-- also keeps the token distinct if two writes share the same clock reading.
create or replace function private.set_meetup_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := greatest(
    clock_timestamp(),
    old.updated_at + interval '1 microsecond'
  );
  return new;
end;
$$;

revoke all on function private.set_meetup_updated_at()
  from public, anon, authenticated;

drop trigger if exists meetups_90_set_updated_at on public.meetups;
create trigger meetups_90_set_updated_at
before update on public.meetups
for each row execute function private.set_meetup_updated_at();

alter table public.meetups enable row level security;

revoke all on table public.meetups from public, anon, authenticated;
grant select on table public.meetups to authenticated;

create policy "Meetup reads require an eligible student"
on public.meetups
as restrictive
for select
to authenticated
using ((select private.is_verified_active_student()));

create policy "Participants can read their meetups"
on public.meetups
for select
to authenticated
using (
  buyer_id = (select auth.uid())
  or seller_id = (select auth.uid())
);

-- Reassert that reservation and meetup writes are RPC-only. There are no
-- permissive mutation policies for either table.
revoke insert, update, delete on table public.reservations
  from public, anon, authenticated;
revoke insert, update, delete on table public.meetups
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reservation requests and seller decisions
-- ---------------------------------------------------------------------------

create or replace function public.request_reservation(
  p_listing_id uuid,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing public.listings%rowtype;
  v_message text := nullif(
    regexp_replace(
      coalesce(p_message, ''),
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ),
    ''
  );
  v_reservation_id uuid;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  if v_message is not null and char_length(v_message) > 500 then
    raise exception 'Reservation messages cannot exceed 500 characters.'
      using errcode = '22023';
  end if;

  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = p_listing_id
  for update;

  if not found
    or v_listing.status <> 'available'
    or v_listing.seller_id = v_user_id
    or not (select private.is_marketplace_seller(v_listing.seller_id))
  then
    raise exception 'This item is no longer available for reservation.'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.reservations as reservation
    where reservation.listing_id = p_listing_id
      and reservation.buyer_id = v_user_id
      and reservation.status in ('pending', 'accepted')
  ) then
    raise exception 'You already have an active reservation request.'
      using errcode = '23505';
  end if;

  insert into public.reservations (
    listing_id,
    buyer_id,
    seller_id,
    message
  ) values (
    p_listing_id,
    v_user_id,
    v_listing.seller_id,
    v_message
  )
  returning id into v_reservation_id;

  return v_reservation_id;
end;
$$;

-- Compatibility entry point for clients deployed before Step 11. It delegates
-- to the canonical function so both paths enforce identical rules.
create or replace function public.request_listing_reservation(
  p_listing_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.request_reservation(p_listing_id, null);
end;
$$;

create or replace function public.accept_reservation(
  p_reservation_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing_id uuid;
  v_listing public.listings%rowtype;
  v_reservation public.reservations%rowtype;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  select reservation.listing_id
  into v_listing_id
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and reservation.seller_id = v_user_id;

  if not found then
    raise exception 'This reservation request is no longer pending.'
      using errcode = 'P0002';
  end if;

  -- Listing-first locking serializes every lifecycle decision for the item.
  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = v_listing_id
    and listing.seller_id = v_user_id
  for update;

  if not found then
    raise exception 'This listing is no longer available.'
      using errcode = 'P0002';
  end if;

  select reservation.*
  into v_reservation
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and reservation.listing_id = v_listing_id
    and reservation.seller_id = v_user_id
  for update;

  if not found or v_reservation.status <> 'pending' then
    raise exception 'This reservation request is no longer pending.'
      using errcode = 'P0002';
  end if;

  -- Eligibility may change after the request was created. Do not reserve an
  -- item for a buyer who can no longer access or coordinate the transaction.
  if not (select private.is_marketplace_seller(v_reservation.buyer_id)) then
    raise exception 'This buyer is no longer eligible for marketplace transactions.'
      using errcode = 'P0002';
  end if;

  if v_listing.status <> 'available'
    or exists (
      select 1
      from public.reservations as accepted_reservation
      where accepted_reservation.listing_id = v_listing_id
        and accepted_reservation.status = 'accepted'
    )
  then
    raise exception 'This listing has already been reserved for another buyer.'
      using errcode = 'P0002';
  end if;

  update public.reservations
  set
    status = 'accepted',
    responded_at = now(),
    cancelled_at = null,
    completed_at = null
  where id = p_reservation_id
    and status = 'pending';

  if not found then
    raise exception 'This reservation request is no longer pending.'
      using errcode = '40001';
  end if;

  update public.listings
  set status = 'reserved'
  where id = v_listing_id
    and seller_id = v_user_id
    and status = 'available';

  if not found then
    raise exception 'This listing is no longer available.'
      using errcode = '40001';
  end if;

  update public.reservations
  set
    status = 'rejected',
    responded_at = now(),
    cancelled_at = null,
    completed_at = null
  where listing_id = v_listing_id
    and id <> p_reservation_id
    and status = 'pending';

  return 'accepted';
end;
$$;

create or replace function public.reject_reservation(
  p_reservation_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing_id uuid;
  v_reservation public.reservations%rowtype;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  select reservation.listing_id
  into v_listing_id
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and reservation.seller_id = v_user_id;

  if not found then
    raise exception 'This reservation request is no longer pending.'
      using errcode = 'P0002';
  end if;

  perform 1
  from public.listings as listing
  where listing.id = v_listing_id
    and listing.seller_id = v_user_id
  for update;

  if not found then
    raise exception 'This reservation request is no longer pending.'
      using errcode = 'P0002';
  end if;

  select reservation.*
  into v_reservation
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and reservation.listing_id = v_listing_id
    and reservation.seller_id = v_user_id
  for update;

  if not found or v_reservation.status <> 'pending' then
    raise exception 'This reservation request is no longer pending.'
      using errcode = 'P0002';
  end if;

  update public.reservations
  set
    status = 'rejected',
    responded_at = now(),
    cancelled_at = null,
    completed_at = null
  where id = p_reservation_id
    and status = 'pending';

  return 'rejected';
end;
$$;

-- Compatibility entry point for the earlier combined decision RPC.
create or replace function public.respond_to_listing_reservation(
  p_reservation_id uuid,
  p_decision text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_decision = 'accepted' then
    return public.accept_reservation(p_reservation_id);
  elsif p_decision = 'rejected' then
    return public.reject_reservation(p_reservation_id);
  end if;

  raise exception 'Unsupported reservation decision.' using errcode = '22023';
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancellation, meetup scheduling, and atomic completion
-- ---------------------------------------------------------------------------

create or replace function public.cancel_reservation(
  p_reservation_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing_id uuid;
  v_listing public.listings%rowtype;
  v_reservation public.reservations%rowtype;
  v_meetup public.meetups%rowtype;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  select reservation.listing_id
  into v_listing_id
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and (
      reservation.buyer_id = v_user_id
      or reservation.seller_id = v_user_id
    );

  if not found then
    raise exception 'This reservation can no longer be cancelled.'
      using errcode = 'P0002';
  end if;

  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = v_listing_id
  for update;

  if not found then
    raise exception 'This reservation can no longer be cancelled.'
      using errcode = 'P0002';
  end if;

  select reservation.*
  into v_reservation
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and reservation.listing_id = v_listing_id
    and (
      reservation.buyer_id = v_user_id
      or reservation.seller_id = v_user_id
    )
  for update;

  if not found
    or v_reservation.status not in ('pending', 'accepted')
    or (
      v_reservation.status = 'pending'
      and v_reservation.buyer_id <> v_user_id
    )
  then
    raise exception 'This reservation can no longer be cancelled.'
      using errcode = 'P0002';
  end if;

  if v_listing.seller_id <> v_reservation.seller_id then
    raise exception 'This reservation can no longer be cancelled.'
      using errcode = '23514';
  end if;

  select meetup.*
  into v_meetup
  from public.meetups as meetup
  where meetup.reservation_id = p_reservation_id
  for update;

  if found and v_meetup.status not in ('proposed', 'scheduled') then
    raise exception 'This reservation can no longer be cancelled.'
      using errcode = 'P0002';
  end if;

  if v_reservation.status = 'accepted' and v_listing.status <> 'reserved' then
    raise exception 'This reservation can no longer be cancelled.'
      using errcode = '23514';
  end if;

  update public.meetups
  set
    status = 'cancelled',
    cancelled_at = now(),
    completed_at = null
  where reservation_id = p_reservation_id
    and status in ('proposed', 'scheduled');

  update public.reservations
  set
    status = 'cancelled',
    cancelled_at = now(),
    completed_at = null
  where id = p_reservation_id
    and status in ('pending', 'accepted');

  if v_reservation.status = 'accepted' then
    update public.listings
    set status = 'available'
    where id = v_listing_id
      and seller_id = v_reservation.seller_id
      and status = 'reserved';

    if not found then
      raise exception 'This reservation can no longer be cancelled.'
        using errcode = '40001';
    end if;
  end if;

  return 'cancelled';
end;
$$;

create or replace function public.cancel_listing_reservation(
  p_reservation_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.cancel_reservation(p_reservation_id);
end;
$$;

create or replace function public.upsert_meetup(
  p_reservation_id uuid,
  p_location_name text,
  p_location_details text,
  p_scheduled_at timestamptz,
  p_notes text,
  p_expected_updated_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing_id uuid;
  v_listing public.listings%rowtype;
  v_reservation public.reservations%rowtype;
  v_meetup public.meetups%rowtype;
  v_location_name text := regexp_replace(
    coalesce(p_location_name, ''),
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
  v_location_details text := nullif(
    regexp_replace(
      coalesce(p_location_details, ''),
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ),
    ''
  );
  v_notes text := nullif(
    regexp_replace(
      coalesce(p_notes, ''),
      '^[[:space:]]+|[[:space:]]+$',
      '',
      'g'
    ),
    ''
  );
  v_meetup_id uuid;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  if char_length(v_location_name) not between 2 and 120
    or char_length(coalesce(v_location_details, '')) > 300
    or char_length(coalesce(v_notes, '')) > 500
    or p_scheduled_at is null
    or not isfinite(p_scheduled_at)
    or p_scheduled_at < now() - interval '5 minutes'
    or p_scheduled_at > now() + interval '1 year'
  then
    raise exception 'Enter a valid public meetup location and schedule.'
      using errcode = '22023';
  end if;

  select reservation.listing_id
  into v_listing_id
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and (
      reservation.buyer_id = v_user_id
      or reservation.seller_id = v_user_id
    );

  if not found then
    raise exception 'This reservation is not available for meetup scheduling.'
      using errcode = 'P0002';
  end if;

  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = v_listing_id
  for update;

  if not found then
    raise exception 'This reservation is not available for meetup scheduling.'
      using errcode = 'P0002';
  end if;

  select reservation.*
  into v_reservation
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and reservation.listing_id = v_listing_id
    and (
      reservation.buyer_id = v_user_id
      or reservation.seller_id = v_user_id
    )
  for update;

  if not found
    or v_reservation.status <> 'accepted'
    or v_listing.status <> 'reserved'
    or v_listing.seller_id <> v_reservation.seller_id
  then
    raise exception 'This reservation is not available for meetup scheduling.'
      using errcode = 'P0002';
  end if;

  select meetup.*
  into v_meetup
  from public.meetups as meetup
  where meetup.reservation_id = p_reservation_id
  for update;

  if found and v_meetup.status not in ('proposed', 'scheduled') then
    raise exception 'Completed or cancelled meetup details cannot be changed.'
      using errcode = 'P0002';
  end if;

  if found and (
    p_expected_updated_at is null
    or p_expected_updated_at <> v_meetup.updated_at
  ) then
    raise exception 'Meetup details changed after this form was opened.'
      using errcode = '40001';
  end if;

  if not found and p_expected_updated_at is not null then
    raise exception 'Meetup details changed after this form was opened.'
      using errcode = '40001';
  end if;

  if v_meetup.id is null then
    insert into public.meetups (
      reservation_id,
      listing_id,
      buyer_id,
      seller_id,
      status,
      location_name,
      location_details,
      scheduled_at,
      notes
    ) values (
      p_reservation_id,
      v_reservation.listing_id,
      v_reservation.buyer_id,
      v_reservation.seller_id,
      'scheduled',
      v_location_name,
      v_location_details,
      p_scheduled_at,
      v_notes
    )
    returning id into v_meetup_id;
  else
    update public.meetups
    set
      status = 'scheduled',
      location_name = v_location_name,
      location_details = v_location_details,
      scheduled_at = p_scheduled_at,
      notes = v_notes
    where id = v_meetup.id
      and status in ('proposed', 'scheduled')
    returning id into v_meetup_id;
  end if;

  if v_meetup_id is null then
    raise exception 'Unable to save meetup details. Please try again.'
      using errcode = '40001';
  end if;

  return v_meetup_id;
end;
$$;

create or replace function public.complete_sale(
  p_reservation_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing_id uuid;
  v_listing public.listings%rowtype;
  v_reservation public.reservations%rowtype;
  v_meetup public.meetups%rowtype;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  select reservation.listing_id
  into v_listing_id
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and reservation.seller_id = v_user_id;

  if not found then
    raise exception 'This sale cannot be completed.' using errcode = 'P0002';
  end if;

  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = v_listing_id
    and listing.seller_id = v_user_id
  for update;

  if not found then
    raise exception 'This sale cannot be completed.' using errcode = 'P0002';
  end if;

  select reservation.*
  into v_reservation
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and reservation.listing_id = v_listing_id
    and reservation.seller_id = v_user_id
  for update;

  if not found
    or v_reservation.status <> 'accepted'
    or v_listing.status <> 'reserved'
  then
    raise exception 'This sale cannot be completed.' using errcode = 'P0002';
  end if;

  select meetup.*
  into v_meetup
  from public.meetups as meetup
  where meetup.reservation_id = p_reservation_id
  for update;

  if found then
    if v_meetup.status not in ('proposed', 'scheduled') then
      raise exception 'This sale cannot be completed.' using errcode = 'P0002';
    end if;

    update public.meetups
    set
      status = 'completed',
      cancelled_at = null,
      completed_at = now()
    where id = v_meetup.id
      and status in ('proposed', 'scheduled');

    if not found then
      raise exception 'This sale changed before it could be completed.'
        using errcode = '40001';
    end if;
  end if;

  update public.reservations
  set
    status = 'completed',
    cancelled_at = null,
    completed_at = now()
  where id = p_reservation_id
    and status = 'accepted';

  if not found then
    raise exception 'This sale changed before it could be completed.'
      using errcode = '40001';
  end if;

  update public.listings
  set status = 'sold'
  where id = v_listing_id
    and seller_id = v_user_id
    and status = 'reserved';

  if not found then
    raise exception 'This sale changed before it could be completed.'
      using errcode = '40001';
  end if;

  -- Defensive cleanup for legacy inconsistency. A normal acceptance already
  -- rejected every competing pending request in the same transaction.
  update public.reservations
  set
    status = 'rejected',
    responded_at = now(),
    cancelled_at = null,
    completed_at = null
  where listing_id = v_listing_id
    and id <> p_reservation_id
    and status = 'pending';

  return 'completed';
end;
$$;

-- ---------------------------------------------------------------------------
-- Reservation-aware messaging and participant-scoped read projection
-- ---------------------------------------------------------------------------

create or replace function public.start_reservation_conversation(
  p_reservation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing_id uuid;
  v_listing public.listings%rowtype;
  v_reservation public.reservations%rowtype;
  v_conversation_id uuid;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  select reservation.listing_id
  into v_listing_id
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and (
      reservation.buyer_id = v_user_id
      or reservation.seller_id = v_user_id
    );

  if not found then
    raise exception 'This reservation conversation is not available.'
      using errcode = 'P0002';
  end if;

  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = v_listing_id
  for share;

  if not found or v_listing.status not in ('available', 'reserved', 'sold') then
    raise exception 'This reservation conversation is not available.'
      using errcode = 'P0002';
  end if;

  select reservation.*
  into v_reservation
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and reservation.listing_id = v_listing_id
    and (
      reservation.buyer_id = v_user_id
      or reservation.seller_id = v_user_id
    )
  for share;

  if not found
    or v_reservation.status not in (
      'pending', 'accepted', 'rejected', 'cancelled', 'completed'
    )
    or v_listing.seller_id <> v_reservation.seller_id
    or not (select private.is_marketplace_seller(v_reservation.buyer_id))
    or not (select private.is_marketplace_seller(v_reservation.seller_id))
  then
    raise exception 'This reservation conversation is not available.'
      using errcode = 'P0002';
  end if;

  insert into public.conversations (listing_id, buyer_id, seller_id)
  values (
    v_reservation.listing_id,
    v_reservation.buyer_id,
    v_reservation.seller_id
  )
  on conflict (listing_id, buyer_id) do nothing
  returning id into v_conversation_id;

  if v_conversation_id is null then
    select conversation.id
    into v_conversation_id
    from public.conversations as conversation
    where conversation.listing_id = v_reservation.listing_id
      and conversation.buyer_id = v_reservation.buyer_id
      and conversation.seller_id = v_reservation.seller_id;
  end if;

  if v_conversation_id is null then
    raise exception 'Unable to open this reservation conversation.'
      using errcode = '40001';
  end if;

  return v_conversation_id;
end;
$$;

create or replace function public.get_my_reservation_summaries(
  p_reservation_id uuid default null
)
returns table (
  reservation_id uuid,
  listing_id uuid,
  listing_title text,
  listing_status text,
  listing_price numeric(12, 2),
  listing_image_path text,
  buyer_id uuid,
  seller_id uuid,
  viewer_role text,
  other_user_id uuid,
  other_user_name text,
  other_user_avatar_path text,
  other_user_is_verified boolean,
  reservation_status text,
  reservation_message text,
  reservation_created_at timestamptz,
  reservation_updated_at timestamptz,
  responded_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  conversation_id uuid,
  pending_request_count bigint,
  can_view_listing boolean,
  meetup_id uuid,
  meetup_status text,
  meetup_location_name text,
  meetup_location_details text,
  meetup_scheduled_at timestamptz,
  meetup_notes text,
  meetup_created_at timestamptz,
  meetup_updated_at timestamptz,
  meetup_cancelled_at timestamptz,
  meetup_completed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with caller as (
    select (select auth.uid()) as user_id
  ), participant_reservations as (
    select
      reservation.*,
      caller.user_id,
      case
        when reservation.seller_id = caller.user_id then 'seller'::text
        else 'buyer'::text
      end as viewer_role,
      case
        when reservation.seller_id = caller.user_id
          then reservation.buyer_id
        else reservation.seller_id
      end as other_user_id
    from public.reservations as reservation
    cross join caller
    where caller.user_id is not null
      and (select private.is_verified_active_student())
      and (
        reservation.buyer_id = caller.user_id
        or reservation.seller_id = caller.user_id
      )
      and (
        p_reservation_id is null
        or reservation.id = p_reservation_id
      )
  )
  select
    reservation.id as reservation_id,
    reservation.listing_id,
    listing.title as listing_title,
    listing.status as listing_status,
    listing.price as listing_price,
    cover_image.storage_path as listing_image_path,
    reservation.buyer_id,
    reservation.seller_id,
    reservation.viewer_role,
    reservation.other_user_id,
    case
      when other_profile.id is null then 'Former UC Student'
      else coalesce(nullif(btrim(other_profile.full_name), ''), 'UC Student')
    end as other_user_name,
    other_profile.avatar_path as other_user_avatar_path,
    coalesce(other_profile.verification_status = 'verified', false)
      as other_user_is_verified,
    reservation.status as reservation_status,
    reservation.message as reservation_message,
    reservation.created_at as reservation_created_at,
    reservation.updated_at as reservation_updated_at,
    reservation.responded_at,
    reservation.cancelled_at,
    reservation.completed_at,
    conversation.id as conversation_id,
    case
      when reservation.viewer_role = 'seller'
        then coalesce(pending_requests.request_count, 0::bigint)
      else 0::bigint
    end as pending_request_count,
    (
      listing.seller_id = reservation.user_id
      or (
        listing.status in ('available', 'reserved')
        and (select private.is_marketplace_seller(listing.seller_id))
      )
      or (
        listing.status = 'sold'
        and exists (
          select 1
          from public.favorites as favorite
          where favorite.listing_id = listing.id
            and favorite.user_id = reservation.user_id
        )
      )
    ) as can_view_listing,
    meetup.id as meetup_id,
    meetup.status as meetup_status,
    meetup.location_name as meetup_location_name,
    meetup.location_details as meetup_location_details,
    meetup.scheduled_at as meetup_scheduled_at,
    meetup.notes as meetup_notes,
    meetup.created_at as meetup_created_at,
    meetup.updated_at as meetup_updated_at,
    meetup.cancelled_at as meetup_cancelled_at,
    meetup.completed_at as meetup_completed_at
  from participant_reservations as reservation
  join public.listings as listing on listing.id = reservation.listing_id
  left join public.profiles as other_profile
    on other_profile.id = reservation.other_user_id
    and other_profile.role = 'student'
    and other_profile.verification_status = 'verified'
    and other_profile.account_status = 'active'
  left join public.conversations as conversation
    on conversation.listing_id = reservation.listing_id
    and conversation.buyer_id = reservation.buyer_id
    and conversation.seller_id = reservation.seller_id
  left join public.meetups as meetup
    on meetup.reservation_id = reservation.id
  left join lateral (
    select listing_image.storage_path
    from public.listing_images as listing_image
    where listing_image.listing_id = reservation.listing_id
    order by
      listing_image.is_cover desc,
      listing_image.sort_order,
      listing_image.created_at,
      listing_image.id
    limit 1
  ) as cover_image on true
  left join lateral (
    select count(*)::bigint as request_count
    from public.reservations as pending_reservation
    where pending_reservation.listing_id = reservation.listing_id
      and pending_reservation.status = 'pending'
  ) as pending_requests on reservation.viewer_role = 'seller'
  order by reservation.created_at desc, reservation.id;
$$;

-- Preserve a student's saved-item history after a sale without making sold
-- listings public again. New favorites remain limited to available/reserved
-- listings by set_listing_favorite(); this helper only recognizes an existing
-- favorite owned by the current verified, active student.
create or replace function private.can_read_favorited_sold_listing(
  p_listing_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (select private.is_verified_active_student())
    and exists (
      select 1
      from public.favorites as favorite
      join public.listings as listing on listing.id = favorite.listing_id
      where favorite.user_id = (select auth.uid())
        and favorite.listing_id = p_listing_id
        and listing.status = 'sold'
    );
$$;

-- The authorization-hardening migration intentionally uses restrictive
-- policies as a maximum row set. Extend those gates as well as adding the
-- permissive policies below; otherwise PostgreSQL would still filter every
-- sold favorite out after the permissive policy matched it.
alter policy "Marketplace listing reads require authorized account"
on public.listings
using (
  (select private.is_active_admin())
  or (
    (select private.is_verified_active_student())
    and (
      seller_id = (select auth.uid())
      or (
        status in ('available', 'reserved')
        and private.is_marketplace_seller(seller_id)
      )
      or (
        status = 'sold'
        and (select private.can_read_favorited_sold_listing(listings.id))
      )
    )
  )
);

alter policy "Listing image reads require authorized account"
on public.listing_images
using (
  (select private.is_active_admin())
  or (
    (select private.is_verified_active_student())
    and exists (
      select 1
      from public.listings
      where listings.id = listing_images.listing_id
        and (
          listings.seller_id = (select auth.uid())
          or (
            listings.status in ('available', 'reserved')
            and private.is_marketplace_seller(listings.seller_id)
          )
          or (
            listings.status = 'sold'
            and (select private.can_read_favorited_sold_listing(listings.id))
          )
        )
    )
  )
);

drop policy if exists "Students can read their favorited sold listings"
  on public.listings;
create policy "Students can read their favorited sold listings"
on public.listings
for select
to authenticated
using (
  status = 'sold'
  and (select private.can_read_favorited_sold_listing(listings.id))
);

drop policy if exists "Students can read favorited sold listing images"
  on public.listing_images;
create policy "Students can read favorited sold listing images"
on public.listing_images
for select
to authenticated
using (
  (select private.can_read_favorited_sold_listing(
    listing_images.listing_id
  ))
);

-- Private listing images remain path-validated. Verified active participants
-- and the owner of an existing favorite may retrieve retained images after a
-- sale; removed listings remain private to owners/participants.
create or replace function private.can_read_listing_image_object(
  p_name text,
  p_owner_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select private.is_active_admin()) then true
    when not (select private.is_verified_active_student()) then false
    else
      (
        p_owner_id = (select auth.uid()::text)
        and array_length(storage.foldername(p_name), 1) = 2
        and (storage.foldername(p_name))[1] = (select auth.uid()::text)
        and exists (
          select 1
          from public.listings as owned_listing
          where owned_listing.id::text = (storage.foldername(p_name))[2]
            and owned_listing.seller_id = (select auth.uid())
        )
      )
      or exists (
        select 1
        from public.listing_images as listing_image
        join public.listings as listing
          on listing.id = listing_image.listing_id
        where listing_image.storage_path = p_name
          and array_length(storage.foldername(p_name), 1) = 2
          and (storage.foldername(p_name))[1] = listing.seller_id::text
          and (storage.foldername(p_name))[2] = listing.id::text
          and p_owner_id = listing.seller_id::text
          and (
            (
              listing.status in ('available', 'reserved')
              and private.is_marketplace_seller(listing.seller_id)
            )
            or exists (
              select 1
              from public.conversations as conversation
              where conversation.listing_id = listing.id
                and (
                  conversation.buyer_id = (select auth.uid())
                  or conversation.seller_id = (select auth.uid())
                )
            )
            or exists (
              select 1
              from public.reservations as reservation
              where reservation.listing_id = listing.id
                and (
                  reservation.buyer_id = (select auth.uid())
                  or reservation.seller_id = (select auth.uid())
                )
            )
            or private.can_read_favorited_sold_listing(listing.id)
          )
      )
  end;
$$;

comment on function private.can_read_listing_image_object(text, text) is
  'Allows path-validated private image reads to active admins, owners, eligible marketplace viewers, sold-favorite owners, and verified active conversation/reservation participants.';

-- ---------------------------------------------------------------------------
-- Close legacy listing lifecycle paths over the new meetup state
-- ---------------------------------------------------------------------------

create or replace function public.set_owned_listing_status(
  p_listing_id uuid,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing public.listings%rowtype;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  if p_status is distinct from 'removed' then
    raise exception 'Use the accepted reservation to complete a sale.'
      using errcode = '22023';
  end if;

  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = p_listing_id
    and listing.seller_id = v_user_id
  for update;

  if not found then
    raise exception 'Listing was not found.' using errcode = 'P0002';
  end if;

  if v_listing.status in ('draft', 'removed') then
    raise exception 'This listing cannot be removed.' using errcode = '22023';
  end if;

  perform 1
  from public.reservations as reservation
  where reservation.listing_id = p_listing_id
    and reservation.status in ('pending', 'accepted')
  order by reservation.id
  for update;

  perform 1
  from public.meetups as meetup
  where meetup.listing_id = p_listing_id
    and meetup.status in ('proposed', 'scheduled')
  order by meetup.id
  for update;

  update public.meetups
  set
    status = 'cancelled',
    cancelled_at = now(),
    completed_at = null
  where listing_id = p_listing_id
    and status in ('proposed', 'scheduled');

  update public.reservations
  set
    status = case when status = 'accepted' then 'cancelled' else 'rejected' end,
    responded_at = case
      when status = 'pending' then now()
      else responded_at
    end,
    cancelled_at = case
      when status = 'accepted' then now()
      else null
    end,
    completed_at = null
  where listing_id = p_listing_id
    and status in ('pending', 'accepted');

  update public.listings
  set status = 'removed'
  where id = p_listing_id
    and seller_id = v_user_id;

  delete from public.favorites where listing_id = p_listing_id;

  return 'removed';
end;
$$;

create or replace function public.admin_remove_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (select private.is_active_admin())
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  perform 1
  from public.listings
  where id = p_listing_id
  for update;

  if not found then
    raise exception 'Listing was not found.' using errcode = 'P0002';
  end if;

  perform 1
  from public.reservations as reservation
  where reservation.listing_id = p_listing_id
    and reservation.status in ('pending', 'accepted')
  order by reservation.id
  for update;

  perform 1
  from public.meetups as meetup
  where meetup.listing_id = p_listing_id
    and meetup.status in ('proposed', 'scheduled')
  order by meetup.id
  for update;

  update public.meetups
  set
    status = 'cancelled',
    cancelled_at = now(),
    completed_at = null
  where listing_id = p_listing_id
    and status in ('proposed', 'scheduled');

  update public.reservations
  set
    status = case when status = 'accepted' then 'cancelled' else 'rejected' end,
    responded_at = case
      when status = 'pending' then now()
      else responded_at
    end,
    cancelled_at = case
      when status = 'accepted' then now()
      else null
    end,
    completed_at = null
  where listing_id = p_listing_id
    and status in ('pending', 'accepted');

  update public.listings set status = 'removed' where id = p_listing_id;
  delete from public.favorites where listing_id = p_listing_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function public.request_reservation(uuid, text)
  from public, anon, authenticated;
revoke all on function public.request_listing_reservation(uuid)
  from public, anon, authenticated;
revoke all on function public.accept_reservation(uuid)
  from public, anon, authenticated;
revoke all on function public.reject_reservation(uuid)
  from public, anon, authenticated;
revoke all on function public.respond_to_listing_reservation(uuid, text)
  from public, anon, authenticated;
revoke all on function public.cancel_reservation(uuid)
  from public, anon, authenticated;
revoke all on function public.cancel_listing_reservation(uuid)
  from public, anon, authenticated;
revoke all on function public.upsert_meetup(
  uuid, text, text, timestamptz, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.complete_sale(uuid)
  from public, anon, authenticated;
revoke all on function public.start_reservation_conversation(uuid)
  from public, anon, authenticated;
revoke all on function public.get_my_reservation_summaries(uuid)
  from public, anon, authenticated;
revoke all on function public.set_owned_listing_status(uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_remove_listing(uuid)
  from public, anon, authenticated;
revoke all on function private.can_read_listing_image_object(text, text)
  from public, anon;
revoke all on function private.can_read_favorited_sold_listing(uuid)
  from public, anon;

grant execute on function public.request_reservation(uuid, text)
  to authenticated;
grant execute on function public.request_listing_reservation(uuid)
  to authenticated;
grant execute on function public.accept_reservation(uuid)
  to authenticated;
grant execute on function public.reject_reservation(uuid)
  to authenticated;
grant execute on function public.respond_to_listing_reservation(uuid, text)
  to authenticated;
grant execute on function public.cancel_reservation(uuid)
  to authenticated;
grant execute on function public.cancel_listing_reservation(uuid)
  to authenticated;
grant execute on function public.upsert_meetup(
  uuid, text, text, timestamptz, text, timestamptz
) to authenticated;
grant execute on function public.complete_sale(uuid)
  to authenticated;
grant execute on function public.start_reservation_conversation(uuid)
  to authenticated;
grant execute on function public.get_my_reservation_summaries(uuid)
  to authenticated;
grant execute on function public.set_owned_listing_status(uuid, text)
  to authenticated;
grant execute on function public.admin_remove_listing(uuid)
  to authenticated;
grant execute on function private.can_read_listing_image_object(text, text)
  to authenticated;
grant execute on function private.can_read_favorited_sold_listing(uuid)
  to authenticated;

comment on function public.request_reservation(uuid, text) is
  'Creates one pending request for the authenticated buyer and derives its seller from a locked available listing.';
comment on function public.accept_reservation(uuid) is
  'Atomically accepts one pending request, reserves its listing, and rejects competing requests under a listing-first lock.';
comment on function public.cancel_reservation(uuid) is
  'Cancels a buyer pending request or either participant''s accepted reservation, restoring the listing and cancelling its meetup atomically.';
comment on function public.upsert_meetup(
  uuid, text, text, timestamptz, text, timestamptz
) is
  'Creates or version-safely edits the single scheduled meetup for an accepted reservation using reservation-derived participants.';
comment on function public.complete_sale(uuid) is
  'Atomically completes an accepted reservation, completes its meetup when present, and marks the locked listing sold; seller only.';
comment on function public.get_my_reservation_summaries(uuid) is
  'Returns a fixed participant-scoped reservation/listing/profile/conversation/meetup projection; pass NULL for all reservations.';
comment on function private.can_read_favorited_sold_listing(uuid) is
  'Allows only the verified active owner of an existing favorite to retain its sold listing history.';

commit;
