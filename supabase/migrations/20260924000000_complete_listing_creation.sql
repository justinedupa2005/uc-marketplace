begin;

-- Step 6: keep an incomplete listing private until all of its image metadata
-- and Storage objects have been validated. The authenticated client may create
-- and edit draft content, but only publish_listing() may make it available.

-- ---------------------------------------------------------------------------
-- Draft lifecycle, idempotency, and database-level field validation
-- ---------------------------------------------------------------------------

alter table public.listings
  drop constraint if exists listings_status_check;

alter table public.listings
  add constraint listings_status_check check (
    status in ('draft', 'available', 'reserved', 'sold', 'removed')
  );

alter table public.listings
  alter column status set default 'draft';

alter table public.listings
  add column if not exists submission_token uuid;

create unique index if not exists listings_seller_submission_token_key
  on public.listings (seller_id, submission_token)
  where submission_token is not null;

-- NOT VALID avoids making this forward-only migration depend on the quality of
-- historical rows. PostgreSQL still enforces each constraint for every new or
-- subsequently updated row.
alter table public.listings
  drop constraint if exists listings_title_format_check;
alter table public.listings
  add constraint listings_title_format_check check (
    title = btrim(title)
    and char_length(title) between 5 and 100
  ) not valid;

alter table public.listings
  drop constraint if exists listings_description_format_check;
alter table public.listings
  add constraint listings_description_format_check check (
    description = btrim(description)
    and char_length(description) between 10 and 2000
  ) not valid;

alter table public.listings
  drop constraint if exists listings_price_marketplace_range_check;
alter table public.listings
  add constraint listings_price_marketplace_range_check check (
    price > 0
    and price <= 1000000.00
  ) not valid;

comment on column public.listings.submission_token is
  'Optional per-form UUID used to make listing draft creation idempotent for a seller.';

comment on column public.listings.status is
  'draft is private and incomplete; available is the initial published marketplace status.';

-- ---------------------------------------------------------------------------
-- Listing creation and edit privileges
-- ---------------------------------------------------------------------------

-- The two policies are intentionally both updated. PostgreSQL combines the
-- restrictive policy with the permissive policy, and both must describe the
-- same maximum insert set.
alter policy "Listing creation requires verified ownership"
on public.listings
with check (
  seller_id = (select auth.uid())
  and status = 'draft'
  and (select private.is_verified_active_student())
  and exists (
    select 1
    from public.categories
    where categories.id = listings.category_id
      and categories.is_active
  )
);

alter policy "Verified students can create their listings"
on public.listings
with check (
  seller_id = (select auth.uid())
  and status = 'draft'
  and (select private.is_verified_active_student())
  and exists (
    select 1
    from public.categories
    where categories.id = listings.category_id
      and categories.is_active
  )
);

-- Remove the old table-wide privileges. Column grants prevent a direct Data
-- API request from supplying another lifecycle status or changing ownership.
-- Existing SELECT and DELETE privileges remain unchanged for reads and cleanup.
revoke insert, update on table public.listings from authenticated;

grant insert (
  id,
  seller_id,
  category_id,
  title,
  description,
  price,
  condition,
  submission_token
) on table public.listings to authenticated;

grant update (
  category_id,
  title,
  description,
  price,
  condition
) on table public.listings to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic publication gate
-- ---------------------------------------------------------------------------

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

  -- This row lock serializes publication and also prevents a concurrent child
  -- insert from changing the final image set while it is being validated.
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

  -- Lock the current metadata rows before validating their aggregate shape.
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
      bool_and(
        listing_image.is_cover = (listing_image.sort_order = 0)
      ),
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

revoke all on function public.publish_listing(uuid)
  from public, anon, authenticated;
grant execute on function public.publish_listing(uuid)
  to authenticated;

comment on function public.publish_listing(uuid) is
  'Publishes an owned draft only after live student authorization, category, image order, Storage ownership, path, and file-extension checks pass.';

commit;
