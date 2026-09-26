begin;

-- Let interaction participants retain a minimal listing reference after an
-- item leaves normal browsing. This does not widen the listings SELECT policy.
create or replace function public.get_my_listing_interaction_contexts()
returns table (
  listing_id uuid,
  title text,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select listing.id, listing.title, listing.status
  from public.listings as listing
  where (select auth.uid()) is not null
    and (select private.is_verified_active_student())
    and (
      exists (
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
    );
$$;

-- Once metadata no longer references an owned object, the seller must be able
-- to finish cleanup even if the listing concurrently becomes sold or removed.
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
      select 1
      from public.listings
      where listings.id::text = (storage.foldername(p_name))[2]
        and listings.seller_id = (select auth.uid())
        and (
          listings.status = 'draft'
          or not exists (
            select 1
            from public.listing_images
            where listing_images.storage_path = p_name
          )
        )
    );
$$;

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

  -- Removing an existing favorite is always allowed for its owner, including
  -- cleanup of a favorite whose listing has since left browsing.
  delete from public.favorites
  where user_id = v_user_id and listing_id = p_listing_id;

  if found then
    return false;
  end if;

  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = p_listing_id
  for share;

  if not found
    or v_listing.seller_id = v_user_id
    or v_listing.status not in ('available', 'reserved')
    or not (select private.is_marketplace_seller(v_listing.seller_id))
  then
    raise exception 'This listing cannot be favorited.'
      using errcode = 'P0002';
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
  for share;

  if not found
    or v_listing.seller_id = v_user_id
    or v_listing.status = 'removed'
  then
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

  perform 1
  from public.conversations as conversation
  join public.listings as listing on listing.id = conversation.listing_id
  where conversation.id = p_conversation_id
    and (
      conversation.buyer_id = v_user_id
      or conversation.seller_id = v_user_id
    )
    and listing.status <> 'removed'
  for share of listing;

  if not found then
    raise exception 'This conversation is not available.'
      using errcode = 'P0002';
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, v_user_id, v_body)
  returning id into v_message_id;

  return v_message_id;
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
  for share;

  if not found
    or v_listing.seller_id = v_user_id
    or v_listing.status not in ('available', 'reserved')
  then
    raise exception 'This listing cannot be reported.'
      using errcode = 'P0002';
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
  on conflict (reporter_id, listing_id)
    where status in ('pending', 'reviewing')
  do nothing
  returning id into v_report_id;

  if v_report_id is null then
    select report.id
    into v_report_id
    from public.listing_reports as report
    where report.reporter_id = v_user_id
      and report.listing_id = p_listing_id
      and report.status in ('pending', 'reviewing');
  end if;

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

  delete from public.favorites where listing_id = p_listing_id;

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
  v_listing_id uuid;
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

  select reservation.listing_id
  into v_listing_id
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and reservation.seller_id = v_user_id;

  if not found then
    raise exception 'This reservation request is no longer pending.'
      using errcode = 'P0002';
  end if;

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
    and reservation.seller_id = v_user_id
    and reservation.listing_id = v_listing_id
  for update;

  if not found or v_reservation.status <> 'pending' then
    raise exception 'This reservation request is no longer pending.'
      using errcode = 'P0002';
  end if;

  if v_listing.status <> 'available' then
    raise exception 'This listing is no longer available.'
      using errcode = 'P0002';
  end if;

  update public.reservations
  set status = p_decision
  where id = p_reservation_id and status = 'pending';

  if p_decision = 'accepted' then
    update public.listings
    set status = 'reserved'
    where id = v_listing_id and status = 'available';

    update public.reservations
    set status = 'rejected'
    where listing_id = v_listing_id
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
    and reservation.buyer_id = v_user_id;

  if not found then
    raise exception 'This reservation can no longer be cancelled.'
      using errcode = 'P0002';
  end if;

  perform 1
  from public.listings
  where id = v_listing_id
  for update;

  if not found then
    raise exception 'This reservation can no longer be cancelled.'
      using errcode = 'P0002';
  end if;

  select reservation.*
  into v_reservation
  from public.reservations as reservation
  where reservation.id = p_reservation_id
    and reservation.buyer_id = v_user_id
    and reservation.listing_id = v_listing_id
  for update;

  if not found or v_reservation.status not in ('pending', 'accepted') then
    raise exception 'This reservation can no longer be cancelled.'
      using errcode = 'P0002';
  end if;

  update public.reservations
  set status = 'cancelled'
  where id = p_reservation_id;

  if v_reservation.status = 'accepted' then
    update public.listings
    set status = 'available'
    where id = v_listing_id and status = 'reserved';
  end if;

  return 'cancelled';
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

  update public.listings set status = 'removed' where id = p_listing_id;

  update public.reservations
  set status = case when status = 'accepted' then 'cancelled' else 'rejected' end
  where listing_id = p_listing_id and status in ('pending', 'accepted');

  delete from public.favorites where listing_id = p_listing_id;
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

  -- Hold every final object through metadata replacement. A concurrent delete
  -- that wins first makes the later validation fail instead of leaving broken
  -- image metadata.
  perform 1
  from storage.objects as listing_object
  where listing_object.bucket_id = 'listing-images'
    and listing_object.name = any(p_image_paths)
  for key share;

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

create or replace function public.publish_listing(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing public.listings%rowtype;
  v_image_count integer;
  v_cover_count integer;
  v_min_sort_order smallint;
  v_max_sort_order smallint;
  v_cover_matches_sort_order boolean;
begin
  if v_user_id is null
    or not (select private.is_verified_active_student())
  then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = p_listing_id
    and listing.seller_id = v_user_id
    and listing.status = 'draft'
  for update;

  if not found then
    raise exception 'Draft listing was not found.'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.categories as category
    where category.id = v_listing.category_id
      and category.is_active
  ) then
    raise exception 'Select an active marketplace category.'
      using errcode = '23514';
  end if;

  perform 1
  from public.listing_images as listing_image
  where listing_image.listing_id = p_listing_id
  order by listing_image.sort_order
  for update;

  select
    count(*)::integer,
    count(*) filter (where listing_image.is_cover)::integer,
    min(listing_image.sort_order),
    max(listing_image.sort_order),
    coalesce(
      bool_and(listing_image.is_cover = (listing_image.sort_order = 0)),
      false
    )
  into
    v_image_count,
    v_cover_count,
    v_min_sort_order,
    v_max_sort_order,
    v_cover_matches_sort_order
  from public.listing_images as listing_image
  where listing_image.listing_id = p_listing_id;

  if v_image_count < 1 or v_image_count > 5 then
    raise exception 'A listing requires between one and five images.'
      using errcode = '23514';
  end if;

  if v_cover_count <> 1
    or not v_cover_matches_sort_order
    or v_min_sort_order <> 0
    or v_max_sort_order <> (v_image_count - 1)
  then
    raise exception 'Listing images must be contiguous and start with one cover image.'
      using errcode = '23514';
  end if;

  perform 1
  from public.listing_images as listing_image
  join storage.objects as listing_object
    on listing_object.bucket_id = 'listing-images'
    and listing_object.name = listing_image.storage_path
  where listing_image.listing_id = p_listing_id
  for key share of listing_object;

  if exists (
    select 1
    from public.listing_images as listing_image
    where listing_image.listing_id = p_listing_id
      and (
        coalesce(cardinality(storage.foldername(listing_image.storage_path)), 0) <> 2
        or coalesce((storage.foldername(listing_image.storage_path))[1], '')
          <> v_user_id::text
        or coalesce((storage.foldername(listing_image.storage_path))[2], '')
          <> p_listing_id::text
        or coalesce(lower(storage.extension(listing_image.storage_path)), '')
          not in ('jpg', 'jpeg', 'png', 'webp')
        or coalesce(lower(storage.filename(listing_image.storage_path)), '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
        or not exists (
          select 1
          from storage.objects as listing_object
          where listing_object.bucket_id = 'listing-images'
            and listing_object.name = listing_image.storage_path
            and listing_object.owner_id = v_user_id::text
        )
      )
  ) then
    raise exception 'One or more listing images are invalid.'
      using errcode = '23514';
  end if;

  update public.listings
  set status = 'available'
  where id = p_listing_id
    and seller_id = v_user_id
    and status = 'draft';

  if not found then
    raise exception 'Draft listing could not be published.'
      using errcode = '40001';
  end if;

  return p_listing_id;
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

  -- Keep the same parent-first order used by publication and edit operations.
  perform 1
  from public.listings
  where id = p_listing_id
    and seller_id = v_user_id
    and status = 'draft'
  for update;

  if not found then
    raise exception 'Draft listing was not found.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from storage.objects as stored_object
    where stored_object.bucket_id = 'listing-images'
      and cardinality(storage.foldername(stored_object.name)) = 2
      and (storage.foldername(stored_object.name))[1] = v_user_id::text
      and (storage.foldername(stored_object.name))[2] = p_listing_id::text
  ) then
    raise exception 'Remove draft image objects before discarding the draft.'
      using errcode = '23503';
  end if;

  delete from public.listing_images where listing_id = p_listing_id;
  delete from public.listings where id = p_listing_id;

  return p_listing_id;
end;
$$;

-- Remove favorites left behind by listings that exited browsing before this
-- lifecycle hardening was installed.
delete from public.favorites as favorite
using public.listings as listing
where listing.id = favorite.listing_id
  and listing.status not in ('available', 'reserved');

revoke all on function public.get_my_listing_interaction_contexts()
  from public, anon, authenticated;
grant execute on function public.get_my_listing_interaction_contexts()
  to authenticated;

revoke all on function private.can_delete_listing_image_object(text, text)
  from public, anon;
grant execute on function private.can_delete_listing_image_object(text, text)
  to authenticated;

revoke all on function public.toggle_listing_favorite(uuid)
  from public, anon, authenticated;
revoke all on function public.start_listing_conversation(uuid)
  from public, anon, authenticated;
revoke all on function public.send_conversation_message(uuid, text)
  from public, anon, authenticated;
revoke all on function public.report_listing(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.set_owned_listing_status(uuid, text)
  from public, anon, authenticated;
revoke all on function public.respond_to_listing_reservation(uuid, text)
  from public, anon, authenticated;
revoke all on function public.cancel_listing_reservation(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_remove_listing(uuid)
  from public, anon, authenticated;
revoke all on function public.discard_listing_draft(uuid)
  from public, anon, authenticated;
revoke all on function public.update_owned_listing(
  uuid, timestamptz, text, text, uuid, numeric, text, text[]
) from public, anon, authenticated;
revoke all on function public.publish_listing(uuid)
  from public, anon, authenticated;

grant execute on function public.toggle_listing_favorite(uuid) to authenticated;
grant execute on function public.start_listing_conversation(uuid) to authenticated;
grant execute on function public.send_conversation_message(uuid, text) to authenticated;
grant execute on function public.report_listing(uuid, text, text) to authenticated;
grant execute on function public.set_owned_listing_status(uuid, text) to authenticated;
grant execute on function public.respond_to_listing_reservation(uuid, text) to authenticated;
grant execute on function public.cancel_listing_reservation(uuid) to authenticated;
grant execute on function public.admin_remove_listing(uuid) to authenticated;
grant execute on function public.discard_listing_draft(uuid) to authenticated;
grant execute on function public.update_owned_listing(
  uuid, timestamptz, text, text, uuid, numeric, text, text[]
) to authenticated;
grant execute on function public.publish_listing(uuid) to authenticated;

commit;
