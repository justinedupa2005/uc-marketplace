begin;

-- ---------------------------------------------------------------------------
-- Step 7 interaction records
-- ---------------------------------------------------------------------------

create unique index if not exists listings_id_seller_id_key
  on public.listings (id, seller_id);

create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_participants_differ check (buyer_id <> seller_id),
  constraint conversations_listing_seller_fkey
    foreign key (listing_id, seller_id)
    references public.listings(id, seller_id) on delete cascade,
  constraint conversations_listing_participants_key
    unique (listing_id, buyer_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (
    char_length(btrim(body)) between 1 and 2000
  ),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'rejected', 'cancelled', 'completed')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservations_participants_differ check (buyer_id <> seller_id),
  constraint reservations_listing_seller_fkey
    foreign key (listing_id, seller_id)
    references public.listings(id, seller_id) on delete cascade
);

create table if not exists public.listing_reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (
    reason in (
      'prohibited_item',
      'scam',
      'misleading',
      'duplicate',
      'inappropriate',
      'wrong_category',
      'other'
    )
  ),
  details text check (
    details is null or char_length(details) between 1 and 1000
  ),
  status text not null default 'pending' check (
    status in ('pending', 'reviewing', 'resolved', 'dismissed')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_reports_participants_differ
    check (reporter_id <> seller_id),
  constraint listing_reports_listing_seller_fkey
    foreign key (listing_id, seller_id)
    references public.listings(id, seller_id) on delete cascade,
  constraint listing_reports_other_details_check check (
    reason <> 'other'
    or char_length(coalesce(btrim(details), '')) >= 10
  )
);

create index if not exists favorites_listing_id_idx
  on public.favorites (listing_id, created_at desc);
create index if not exists conversations_buyer_updated_idx
  on public.conversations (buyer_id, updated_at desc);
create index if not exists conversations_seller_updated_idx
  on public.conversations (seller_id, updated_at desc);
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);
create index if not exists reservations_seller_status_created_idx
  on public.reservations (seller_id, status, created_at desc);
create index if not exists reservations_buyer_status_created_idx
  on public.reservations (buyer_id, status, created_at desc);
create unique index if not exists reservations_one_active_buyer_request_idx
  on public.reservations (listing_id, buyer_id)
  where status in ('pending', 'accepted');
create unique index if not exists reservations_one_accepted_listing_idx
  on public.reservations (listing_id)
  where status = 'accepted';
create index if not exists listing_reports_status_created_idx
  on public.listing_reports (status, created_at desc);
create unique index if not exists listing_reports_one_active_report_idx
  on public.listing_reports (reporter_id, listing_id)
  where status in ('pending', 'reviewing');

drop trigger if exists conversations_90_set_updated_at
  on public.conversations;
create trigger conversations_90_set_updated_at
before update on public.conversations
for each row execute function private.set_updated_at();

drop trigger if exists reservations_90_set_updated_at
  on public.reservations;
create trigger reservations_90_set_updated_at
before update on public.reservations
for each row execute function private.set_updated_at();

drop trigger if exists listing_reports_90_set_updated_at
  on public.listing_reports;
create trigger listing_reports_90_set_updated_at
before update on public.listing_reports
for each row execute function private.set_updated_at();

create or replace function private.touch_conversation_after_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set updated_at = greatest(updated_at, new.created_at)
  where id = new.conversation_id;

  return new;
end;
$$;

revoke all on function private.touch_conversation_after_message()
  from public, anon, authenticated;

drop trigger if exists messages_90_touch_conversation on public.messages;
create trigger messages_90_touch_conversation
after insert on public.messages
for each row execute function private.touch_conversation_after_message();

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security
-- ---------------------------------------------------------------------------

alter table public.favorites enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.reservations enable row level security;
alter table public.listing_reports enable row level security;

revoke all on table public.favorites from public, anon, authenticated;
revoke all on table public.conversations from public, anon, authenticated;
revoke all on table public.messages from public, anon, authenticated;
revoke all on table public.reservations from public, anon, authenticated;
revoke all on table public.listing_reports from public, anon, authenticated;

grant select on table public.favorites to authenticated;
grant select on table public.conversations to authenticated;
grant select on table public.messages to authenticated;
grant select on table public.reservations to authenticated;
grant select on table public.listing_reports to authenticated;

create policy "Favorite access requires an eligible student"
on public.favorites
as restrictive
for all
to authenticated
using ((select private.is_verified_active_student()))
with check ((select private.is_verified_active_student()));

create policy "Students can read their favorites"
on public.favorites
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "Students can add eligible marketplace favorites"
on public.favorites
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.listings
    where listings.id = favorites.listing_id
      and listings.seller_id <> (select auth.uid())
      and listings.status in ('available', 'reserved')
      and private.is_marketplace_seller(listings.seller_id)
  )
);

create policy "Students can remove their favorites"
on public.favorites
for delete
to authenticated
using (user_id = (select auth.uid()));

create policy "Conversation reads require an eligible participant"
on public.conversations
as restrictive
for select
to authenticated
using ((select private.is_verified_active_student()));

create policy "Participants can read their conversations"
on public.conversations
for select
to authenticated
using (
  buyer_id = (select auth.uid())
  or seller_id = (select auth.uid())
);

create policy "Message access requires an eligible student"
on public.messages
as restrictive
for all
to authenticated
using ((select private.is_verified_active_student()))
with check ((select private.is_verified_active_student()));

create policy "Participants can read conversation messages"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.conversations
    where conversations.id = messages.conversation_id
      and (
        conversations.buyer_id = (select auth.uid())
        or conversations.seller_id = (select auth.uid())
      )
  )
);

create policy "Participants can send conversation messages"
on public.messages
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and char_length(btrim(body)) between 1 and 2000
  and exists (
    select 1
    from public.conversations
    join public.listings
      on listings.id = conversations.listing_id
    where conversations.id = messages.conversation_id
      and (
        conversations.buyer_id = (select auth.uid())
        or conversations.seller_id = (select auth.uid())
      )
      and listings.status <> 'removed'
  )
);

create policy "Reservation reads require an eligible student"
on public.reservations
as restrictive
for select
to authenticated
using ((select private.is_verified_active_student()));

create policy "Participants can read their reservations"
on public.reservations
for select
to authenticated
using (
  buyer_id = (select auth.uid())
  or seller_id = (select auth.uid())
);

create policy "Report reads require an eligible reporter or admin"
on public.listing_reports
as restrictive
for select
to authenticated
using (
  (select private.is_verified_active_student())
  or (select private.is_active_admin())
);

create policy "Reporters and admins can read reports"
on public.listing_reports
for select
to authenticated
using (
  reporter_id = (select auth.uid())
  or (select private.is_active_admin())
);

-- ---------------------------------------------------------------------------
-- Prevent direct lifecycle and published-image integrity bypasses
-- ---------------------------------------------------------------------------

revoke update (category_id, title, description, price, condition)
  on table public.listings from authenticated;
revoke delete on table public.listings from authenticated;
revoke update, delete on table public.listing_images from authenticated;

alter policy "Listing image creation requires verified ownership"
on public.listing_images
with check (
  (select private.is_verified_active_student())
  and cardinality(storage.foldername(listing_images.storage_path)) = 2
  and (storage.foldername(listing_images.storage_path))[1]
    = (select auth.uid()::text)
  and (storage.foldername(listing_images.storage_path))[2]
    = listing_images.listing_id::text
  and lower(storage.extension(listing_images.storage_path))
    in ('jpg', 'jpeg', 'png', 'webp')
  and exists (
    select 1
    from storage.objects as listing_object
    where listing_object.bucket_id = 'listing-images'
      and listing_object.name = listing_images.storage_path
      and listing_object.owner_id = (select auth.uid()::text)
  )
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
      and listings.status = 'draft'
  )
);

alter policy "Verified students can add their listing images"
on public.listing_images
with check (
  (select private.is_verified_active_student())
  and cardinality(storage.foldername(listing_images.storage_path)) = 2
  and (storage.foldername(listing_images.storage_path))[1]
    = (select auth.uid()::text)
  and (storage.foldername(listing_images.storage_path))[2]
    = listing_images.listing_id::text
  and lower(storage.extension(listing_images.storage_path))
    in ('jpg', 'jpeg', 'png', 'webp')
  and exists (
    select 1
    from storage.objects as listing_object
    where listing_object.bucket_id = 'listing-images'
      and listing_object.name = listing_images.storage_path
      and listing_object.owner_id = (select auth.uid()::text)
  )
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
      and listings.status = 'draft'
  )
);

alter policy "Listing updates require verified ownership"
on public.listings
using (
  seller_id = (select auth.uid())
  and status in ('draft', 'available', 'reserved')
  and (select private.is_verified_active_student())
)
with check (
  seller_id = (select auth.uid())
  and status in ('draft', 'available', 'reserved')
  and (select private.is_verified_active_student())
  and exists (
    select 1 from public.categories
    where categories.id = listings.category_id and categories.is_active
  )
);

alter policy "Verified students can update their listings"
on public.listings
using (
  seller_id = (select auth.uid())
  and status in ('draft', 'available', 'reserved')
  and (select private.is_verified_active_student())
)
with check (
  seller_id = (select auth.uid())
  and status in ('draft', 'available', 'reserved')
  and (select private.is_verified_active_student())
  and exists (
    select 1 from public.categories
    where categories.id = listings.category_id and categories.is_active
  )
);

alter policy "Listing deletes require verified ownership"
on public.listings
using (
  seller_id = (select auth.uid())
  and status = 'draft'
  and (select private.is_verified_active_student())
);

alter policy "Verified students can delete their listings"
on public.listings
using (
  seller_id = (select auth.uid())
  and status = 'draft'
  and (select private.is_verified_active_student())
);

create or replace function private.can_upload_listing_image_object(
  p_name text,
  p_owner_id text
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
    and p_owner_id = (select auth.uid()::text)
    and cardinality(storage.foldername(p_name)) = 2
    and (storage.foldername(p_name))[1] = (select auth.uid()::text)
    and lower(storage.extension(p_name)) in ('jpg', 'jpeg', 'png', 'webp')
    and exists (
      select 1 from public.listings
      where listings.id::text = (storage.foldername(p_name))[2]
        and listings.seller_id = (select auth.uid())
        and listings.status in ('draft', 'available', 'reserved')
    );
$$;

create or replace function private.can_update_listing_image_object(
  p_name text,
  p_owner_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.can_upload_listing_image_object(p_name, p_owner_id))
    and exists (
      select 1 from public.listings
      where listings.id::text = (storage.foldername(p_name))[2]
        and listings.seller_id = (select auth.uid())
        and listings.status = 'draft'
    );
$$;

create or replace function private.can_delete_listing_image_object(
  p_name text,
  p_owner_id text
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
    and p_owner_id = (select auth.uid()::text)
    and cardinality(storage.foldername(p_name)) = 2
    and (storage.foldername(p_name))[1] = (select auth.uid()::text)
    and lower(storage.extension(p_name)) in ('jpg', 'jpeg', 'png', 'webp')
    and exists (
      select 1 from public.listings
      where listings.id::text = (storage.foldername(p_name))[2]
        and listings.seller_id = (select auth.uid())
        and (
          listings.status = 'draft'
          or (
            listings.status in ('available', 'reserved')
            and not exists (
              select 1 from public.listing_images
              where listing_images.storage_path = p_name
            )
          )
        )
    );
$$;

revoke all on function private.can_upload_listing_image_object(text, text)
  from public, anon;
revoke all on function private.can_update_listing_image_object(text, text)
  from public, anon;
revoke all on function private.can_delete_listing_image_object(text, text)
  from public, anon;
grant execute on function private.can_upload_listing_image_object(text, text)
  to authenticated;
grant execute on function private.can_update_listing_image_object(text, text)
  to authenticated;
grant execute on function private.can_delete_listing_image_object(text, text)
  to authenticated;

alter policy "Listing image uploads stay owner scoped"
on storage.objects
with check (
  bucket_id <> 'listing-images'
  or private.can_upload_listing_image_object(name, owner_id)
);

alter policy "Verified students can upload listing images"
on storage.objects
with check (
  bucket_id = 'listing-images'
  and private.can_upload_listing_image_object(name, owner_id)
);

alter policy "Listing image updates stay owner scoped"
on storage.objects
using (
  bucket_id <> 'listing-images'
  or private.can_update_listing_image_object(name, owner_id)
)
with check (
  bucket_id <> 'listing-images'
  or private.can_update_listing_image_object(name, owner_id)
);

alter policy "Verified students can update listing image objects"
on storage.objects
using (
  bucket_id = 'listing-images'
  and private.can_update_listing_image_object(name, owner_id)
)
with check (
  bucket_id = 'listing-images'
  and private.can_update_listing_image_object(name, owner_id)
);

alter policy "Listing image deletes stay owner scoped"
on storage.objects
using (
  bucket_id <> 'listing-images'
  or private.can_delete_listing_image_object(name, owner_id)
);

alter policy "Verified students can delete listing image objects"
on storage.objects
using (
  bucket_id = 'listing-images'
  and private.can_delete_listing_image_object(name, owner_id)
);

-- ---------------------------------------------------------------------------
-- Transaction-safe marketplace operations
-- ---------------------------------------------------------------------------

create or replace function public.toggle_listing_favorite(p_listing_id uuid)
returns boolean
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

  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = p_listing_id
  for key share;

  if not found
    or v_listing.seller_id = v_user_id
    or v_listing.status not in ('available', 'reserved')
    or not (select private.is_marketplace_seller(v_listing.seller_id))
  then
    raise exception 'This listing cannot be favorited.'
      using errcode = 'P0002';
  end if;

  delete from public.favorites
  where user_id = v_user_id and listing_id = p_listing_id;

  if found then
    return false;
  end if;

  insert into public.favorites (user_id, listing_id)
  values (v_user_id, p_listing_id)
  on conflict (user_id, listing_id) do nothing;

  return true;
end;
$$;

create or replace function public.start_listing_conversation(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing public.listings%rowtype;
  v_conversation_id uuid;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = p_listing_id
  for key share;

  if not found or v_listing.seller_id = v_user_id then
    raise exception 'The listing is not available for messaging.'
      using errcode = 'P0002';
  end if;

  select conversation.id
  into v_conversation_id
  from public.conversations as conversation
  where conversation.listing_id = p_listing_id
    and conversation.buyer_id = v_user_id
    and conversation.seller_id = v_listing.seller_id;

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  if v_listing.status not in ('available', 'reserved')
    or not (select private.is_marketplace_seller(v_listing.seller_id))
  then
    raise exception 'The listing is not available for a new conversation.'
      using errcode = 'P0002';
  end if;

  insert into public.conversations (listing_id, buyer_id, seller_id)
  values (p_listing_id, v_user_id, v_listing.seller_id)
  on conflict (listing_id, buyer_id) do nothing
  returning id into v_conversation_id;

  if v_conversation_id is null then
    select conversation.id
    into v_conversation_id
    from public.conversations as conversation
    where conversation.listing_id = p_listing_id
      and conversation.buyer_id = v_user_id
      and conversation.seller_id = v_listing.seller_id;
  end if;

  return v_conversation_id;
end;
$$;

create or replace function public.send_conversation_message(
  p_conversation_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_message_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  if char_length(v_body) not between 1 and 2000 then
    raise exception 'Messages must contain between 1 and 2000 characters.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.conversations
    join public.listings on listings.id = conversations.listing_id
    where conversations.id = p_conversation_id
      and (
        conversations.buyer_id = v_user_id
        or conversations.seller_id = v_user_id
      )
      and listings.status <> 'removed'
  ) then
    raise exception 'This conversation is not available.'
      using errcode = 'P0002';
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, v_user_id, v_body)
  returning id into v_message_id;

  return v_message_id;
end;
$$;

create or replace function public.request_listing_reservation(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing public.listings%rowtype;
  v_reservation_id uuid;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
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
    from public.reservations
    where listing_id = p_listing_id
      and buyer_id = v_user_id
      and status in ('pending', 'accepted')
  ) then
    raise exception 'You already have an active reservation request.'
      using errcode = '23505';
  end if;

  insert into public.reservations (listing_id, buyer_id, seller_id)
  values (p_listing_id, v_user_id, v_listing.seller_id)
  returning id into v_reservation_id;

  return v_reservation_id;
end;
$$;

create or replace function public.report_listing(
  p_listing_id uuid,
  p_reason text,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing public.listings%rowtype;
  v_reason text := lower(btrim(coalesce(p_reason, '')));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_report_id uuid;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  if v_reason not in (
    'prohibited_item', 'scam', 'misleading', 'duplicate',
    'inappropriate', 'wrong_category', 'other'
  ) or char_length(coalesce(v_details, '')) > 1000
    or (v_reason = 'other' and char_length(coalesce(v_details, '')) < 10)
  then
    raise exception 'Select a valid report reason and explanation.'
      using errcode = '22023';
  end if;

  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = p_listing_id
  for key share;

  if not found
    or v_listing.seller_id = v_user_id
    or v_listing.status not in ('available', 'reserved')
  then
    raise exception 'This listing cannot be reported.'
      using errcode = 'P0002';
  end if;

  select report.id
  into v_report_id
  from public.listing_reports as report
  where report.reporter_id = v_user_id
    and report.listing_id = p_listing_id
    and report.status in ('pending', 'reviewing');

  if v_report_id is not null then
    return v_report_id;
  end if;

  insert into public.listing_reports (
    listing_id,
    reporter_id,
    seller_id,
    reason,
    details
  ) values (
    p_listing_id,
    v_user_id,
    v_listing.seller_id,
    v_reason,
    v_details
  )
  returning id into v_report_id;

  return v_report_id;
end;
$$;

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

  if p_status not in ('sold', 'removed') then
    raise exception 'Unsupported listing status.' using errcode = '22023';
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

  if p_status = 'sold' and v_listing.status not in ('available', 'reserved') then
    raise exception 'Only an available or reserved listing can be sold.'
      using errcode = '22023';
  end if;

  if p_status = 'removed' and v_listing.status in ('draft', 'removed') then
    raise exception 'This listing cannot be removed.' using errcode = '22023';
  end if;

  update public.listings
  set status = p_status
  where id = p_listing_id and seller_id = v_user_id;

  if p_status = 'sold' then
    update public.reservations
    set status = case when status = 'accepted' then 'completed' else 'rejected' end
    where listing_id = p_listing_id and status in ('pending', 'accepted');
  else
    update public.reservations
    set status = case when status = 'accepted' then 'cancelled' else 'rejected' end
    where listing_id = p_listing_id and status in ('pending', 'accepted');
  end if;

  return p_status;
end;
$$;

create or replace function public.respond_to_listing_reservation(
  p_reservation_id uuid,
  p_decision text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_reservation public.reservations%rowtype;
  v_listing public.listings%rowtype;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  if p_decision not in ('accepted', 'rejected') then
    raise exception 'Unsupported reservation decision.' using errcode = '22023';
  end if;

  select reservation.*
  into v_reservation
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and reservation.seller_id = v_user_id
  for update;

  if not found or v_reservation.status <> 'pending' then
    raise exception 'This reservation request is no longer pending.'
      using errcode = 'P0002';
  end if;

  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = v_reservation.listing_id
    and listing.seller_id = v_user_id
  for update;

  if not found or v_listing.status <> 'available' then
    raise exception 'This listing is no longer available.'
      using errcode = 'P0002';
  end if;

  update public.reservations
  set status = p_decision
  where id = p_reservation_id and status = 'pending';

  if p_decision = 'accepted' then
    update public.listings
    set status = 'reserved'
    where id = v_reservation.listing_id and status = 'available';

    update public.reservations
    set status = 'rejected'
    where listing_id = v_reservation.listing_id
      and id <> p_reservation_id
      and status = 'pending';
  end if;

  return p_decision;
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
declare
  v_user_id uuid := (select auth.uid());
  v_reservation public.reservations%rowtype;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  select reservation.*
  into v_reservation
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and reservation.buyer_id = v_user_id
  for update;

  if not found or v_reservation.status not in ('pending', 'accepted') then
    raise exception 'This reservation can no longer be cancelled.'
      using errcode = 'P0002';
  end if;

  perform 1
  from public.listings
  where id = v_reservation.listing_id
  for update;

  update public.reservations
  set status = 'cancelled'
  where id = p_reservation_id;

  if v_reservation.status = 'accepted' then
    update public.listings
    set status = 'available'
    where id = v_reservation.listing_id
      and status = 'reserved';
  end if;

  return 'cancelled';
end;
$$;

create or replace function public.update_owned_listing(
  p_listing_id uuid,
  p_expected_updated_at timestamptz,
  p_title text,
  p_description text,
  p_category_id uuid,
  p_price numeric,
  p_condition text,
  p_image_paths text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing public.listings%rowtype;
  v_updated_at timestamptz;
  v_removed_paths text[] := array[]::text[];
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
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

  if v_listing.status not in ('available', 'reserved') then
    raise exception 'This listing can no longer be edited.' using errcode = '22023';
  end if;

  if p_expected_updated_at is null
    or v_listing.updated_at <> p_expected_updated_at
  then
    raise exception 'This listing changed after the form was opened.'
      using errcode = '40001';
  end if;

  if char_length(btrim(coalesce(p_title, ''))) not between 5 and 100
    or char_length(btrim(coalesce(p_description, ''))) not between 10 and 2000
    or p_price is null or p_price <= 0 or p_price > 1000000.00
    or p_condition not in ('new', 'like_new', 'good', 'fair')
    or not exists (
      select 1 from public.categories
      where id = p_category_id and is_active
    )
  then
    raise exception 'One or more listing fields are invalid.' using errcode = '22023';
  end if;

  if coalesce(cardinality(p_image_paths), 0) not between 1 and 5
    or exists (
      select 1
      from unnest(p_image_paths) as image_path
      group by image_path
      having image_path is null or count(*) > 1
    )
  then
    raise exception 'A listing requires one to five unique images.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_image_paths) as image_path
    where coalesce(cardinality(storage.foldername(image_path)), 0) <> 2
      or coalesce((storage.foldername(image_path))[1], '') <> v_user_id::text
      or coalesce((storage.foldername(image_path))[2], '') <> p_listing_id::text
      or coalesce(lower(storage.extension(image_path)), '')
        not in ('jpg', 'jpeg', 'png', 'webp')
      or (
        not exists (
          select 1 from public.listing_images as existing_image
          where existing_image.listing_id = p_listing_id
            and existing_image.storage_path = image_path
        )
        and coalesce(lower(storage.filename(image_path)), '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
      )
      or not exists (
        select 1
        from storage.objects as listing_object
        where listing_object.bucket_id = 'listing-images'
          and listing_object.name = image_path
          and listing_object.owner_id = v_user_id::text
      )
  ) then
    raise exception 'One or more listing images are invalid.' using errcode = '22023';
  end if;

  select coalesce(array_agg(storage_path), array[]::text[])
  into v_removed_paths
  from public.listing_images
  where listing_id = p_listing_id
    and not (storage_path = any(p_image_paths));

  delete from public.listing_images where listing_id = p_listing_id;

  insert into public.listing_images (
    listing_id,
    storage_path,
    is_cover,
    sort_order
  )
  select
    p_listing_id,
    ordered_image.image_path,
    ordered_image.ordinality = 1,
    (ordered_image.ordinality - 1)::smallint
  from unnest(p_image_paths) with ordinality
    as ordered_image(image_path, ordinality);

  update public.listings
  set
    title = btrim(p_title),
    description = btrim(p_description),
    category_id = p_category_id,
    price = p_price,
    condition = p_condition
  where id = p_listing_id and seller_id = v_user_id
  returning updated_at into v_updated_at;

  return jsonb_build_object(
    'listingId', p_listing_id,
    'updatedAt', v_updated_at,
    'removedPaths', to_jsonb(v_removed_paths)
  );
end;
$$;

create or replace function public.discard_listing_draft(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.listing_images
    join storage.objects as stored_object
      on stored_object.bucket_id = 'listing-images'
      and stored_object.name = listing_images.storage_path
    where listing_images.listing_id = p_listing_id
  ) then
    raise exception 'Remove draft image objects before discarding the draft.'
      using errcode = '23503';
  end if;

  delete from public.listing_images
  where listing_id = p_listing_id
    and exists (
      select 1 from public.listings
      where listings.id = p_listing_id
        and listings.seller_id = v_user_id
        and listings.status = 'draft'
    );

  delete from public.listings
  where id = p_listing_id
    and seller_id = v_user_id
    and status = 'draft';

  if not found then
    raise exception 'Draft listing was not found.' using errcode = 'P0002';
  end if;

  return p_listing_id;
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

  update public.listings
  set status = 'removed'
  where id = p_listing_id;

  update public.reservations
  set status = case when status = 'accepted' then 'cancelled' else 'rejected' end
  where listing_id = p_listing_id and status in ('pending', 'accepted');
end;
$$;

revoke all on function public.toggle_listing_favorite(uuid)
  from public, anon, authenticated;
revoke all on function public.start_listing_conversation(uuid)
  from public, anon, authenticated;
revoke all on function public.send_conversation_message(uuid, text)
  from public, anon, authenticated;
revoke all on function public.request_listing_reservation(uuid)
  from public, anon, authenticated;
revoke all on function public.report_listing(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.set_owned_listing_status(uuid, text)
  from public, anon, authenticated;
revoke all on function public.respond_to_listing_reservation(uuid, text)
  from public, anon, authenticated;
revoke all on function public.cancel_listing_reservation(uuid)
  from public, anon, authenticated;
revoke all on function public.update_owned_listing(
  uuid, timestamptz, text, text, uuid, numeric, text, text[]
) from public, anon, authenticated;
revoke all on function public.discard_listing_draft(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_remove_listing(uuid)
  from public, anon, authenticated;

grant execute on function public.toggle_listing_favorite(uuid)
  to authenticated;
grant execute on function public.start_listing_conversation(uuid)
  to authenticated;
grant execute on function public.send_conversation_message(uuid, text)
  to authenticated;
grant execute on function public.request_listing_reservation(uuid)
  to authenticated;
grant execute on function public.report_listing(uuid, text, text)
  to authenticated;
grant execute on function public.set_owned_listing_status(uuid, text)
  to authenticated;
grant execute on function public.respond_to_listing_reservation(uuid, text)
  to authenticated;
grant execute on function public.cancel_listing_reservation(uuid)
  to authenticated;
grant execute on function public.update_owned_listing(
  uuid, timestamptz, text, text, uuid, numeric, text, text[]
) to authenticated;
grant execute on function public.discard_listing_draft(uuid)
  to authenticated;
grant execute on function public.admin_remove_listing(uuid)
  to authenticated;

comment on function public.update_owned_listing(
  uuid, timestamptz, text, text, uuid, numeric, text, text[]
) is
  'Atomically validates and updates owned listing fields and ordered image metadata with optimistic concurrency.';

comment on table public.listing_reports is
  'Private listing moderation reports. Seller access is intentionally excluded by RLS.';

commit;
