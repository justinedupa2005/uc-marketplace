begin;

-- Free listings are valid marketplace posts. Keep the same upper bound and
-- decimal precision while aligning database and shared form validation.
alter table public.listings
  drop constraint if exists listings_price_marketplace_range_check;
alter table public.listings
  add constraint listings_price_marketplace_range_check check (
    price >= 0
    and price <= 1000000.00
  ) not valid;

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
    or p_price is null or p_price < 0 or p_price > 1000000.00
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

revoke all on function public.update_owned_listing(
  uuid, timestamptz, text, text, uuid, numeric, text, text[]
) from public, anon, authenticated;
grant execute on function public.update_owned_listing(
  uuid, timestamptz, text, text, uuid, numeric, text, text[]
) to authenticated;

commit;
