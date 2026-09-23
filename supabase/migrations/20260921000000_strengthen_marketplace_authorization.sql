begin;

-- Step 5: make the database and Storage authorization rules match the
-- verified-and-active marketplace route rules. This migration is deliberately
-- forward-only; previously applied migrations remain unchanged.

alter table public.categories enable row level security;
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;

revoke select on table public.categories from anon;
revoke select, insert, update, delete on table public.listings from anon;
revoke select, insert, update, delete on table public.listing_images from anon;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

drop policy if exists "Categories are publicly readable"
  on public.categories;
drop policy if exists "Active categories are publicly readable"
  on public.categories;
drop policy if exists "Verified students can read active categories"
  on public.categories;
drop policy if exists "Admins can read inactive categories"
  on public.categories;
drop policy if exists "Admins can read all categories"
  on public.categories;
drop policy if exists "Marketplace category reads require authorized account"
  on public.categories;

create policy "Marketplace category reads require authorized account"
on public.categories
as restrictive
for select
to authenticated
using (
  (select private.is_verified_active_student())
  or (select private.is_active_admin())
);

create policy "Verified students can read active categories"
on public.categories
for select
to authenticated
using (
  is_active
  and (select private.is_verified_active_student())
);

create policy "Admins can read all categories"
on public.categories
for select
to authenticated
using ((select private.is_active_admin()));

-- ---------------------------------------------------------------------------
-- Listings
-- ---------------------------------------------------------------------------

-- PostgreSQL ORs permissive policies, so remove every older listing policy
-- that could continue granting access before creating the final policy set.
drop policy if exists "Marketplace listings are publicly readable"
  on public.listings;
drop policy if exists "Sellers can read their listings"
  on public.listings;
drop policy if exists "Active users can read marketplace listings"
  on public.listings;
drop policy if exists "Verified students can read marketplace listings"
  on public.listings;
drop policy if exists "Verified students can read their own listings"
  on public.listings;
drop policy if exists "Admins can read all listings"
  on public.listings;
drop policy if exists "Marketplace listing reads require authorized account"
  on public.listings;

create policy "Marketplace listing reads require authorized account"
on public.listings
as restrictive
for select
to authenticated
using (
  (select private.is_verified_active_student())
  or (select private.is_active_admin())
);

create policy "Verified students can read marketplace listings"
on public.listings
for select
to authenticated
using (
  (select private.is_verified_active_student())
  and status in ('available', 'reserved')
  and private.is_marketplace_seller(seller_id)
);

-- Owners need their non-public statuses for the future my-listings screen,
-- but only while they remain verified and active.
create policy "Verified students can read their own listings"
on public.listings
for select
to authenticated
using (
  seller_id = (select auth.uid())
  and (select private.is_verified_active_student())
);

create policy "Admins can read all listings"
on public.listings
for select
to authenticated
using ((select private.is_active_admin()));

drop policy if exists "Sellers can create listings"
  on public.listings;
drop policy if exists "Verified students can create their listings"
  on public.listings;
drop policy if exists "Listing creation requires verified ownership"
  on public.listings;

create policy "Listing creation requires verified ownership"
on public.listings
as restrictive
for insert
to authenticated
with check (
  seller_id = (select auth.uid())
  and (select private.is_verified_active_student())
);

create policy "Verified students can create their listings"
on public.listings
for insert
to authenticated
with check (
  seller_id = (select auth.uid())
  and status = 'available'
  and (select private.is_verified_active_student())
  and exists (
    select 1
    from public.categories
    where categories.id = listings.category_id
      and categories.is_active
  )
);

drop policy if exists "Sellers can update their listings"
  on public.listings;
drop policy if exists "Verified students can update their listings"
  on public.listings;
drop policy if exists "Listing updates require verified ownership"
  on public.listings;

create policy "Listing updates require verified ownership"
on public.listings
as restrictive
for update
to authenticated
using (
  seller_id = (select auth.uid())
  and (select private.is_verified_active_student())
)
with check (
  seller_id = (select auth.uid())
  and (select private.is_verified_active_student())
);

create policy "Verified students can update their listings"
on public.listings
for update
to authenticated
using (
  seller_id = (select auth.uid())
  and (select private.is_verified_active_student())
)
with check (
  seller_id = (select auth.uid())
  and (select private.is_verified_active_student())
  and exists (
    select 1
    from public.categories
    where categories.id = listings.category_id
      and categories.is_active
  )
);

drop policy if exists "Sellers can delete their listings"
  on public.listings;
drop policy if exists "Verified students can delete their listings"
  on public.listings;
drop policy if exists "Listing deletes require verified ownership"
  on public.listings;

create policy "Listing deletes require verified ownership"
on public.listings
as restrictive
for delete
to authenticated
using (
  seller_id = (select auth.uid())
  and (select private.is_verified_active_student())
);

create policy "Verified students can delete their listings"
on public.listings
for delete
to authenticated
using (
  seller_id = (select auth.uid())
  and (select private.is_verified_active_student())
);

-- ---------------------------------------------------------------------------
-- Safe seller profile projection
-- ---------------------------------------------------------------------------

-- This owner-context view intentionally exposes only its fixed safe columns.
-- Gate the projection itself so pending, rejected, and suspended sessions
-- cannot query seller information through the Data API.
create or replace view public.marketplace_profiles
with (security_barrier = true)
as
select
  id,
  full_name,
  course,
  year_level,
  avatar_path,
  verification_status
from public.profiles
where role = 'student'
  and verification_status = 'verified'
  and account_status = 'active'
  and (
    (select private.is_verified_active_student())
    or (select private.is_active_admin())
  );

revoke all on table public.marketplace_profiles
  from public, anon, authenticated;
grant select on table public.marketplace_profiles to authenticated;

comment on view public.marketplace_profiles is
  'Safe seller projection available only to verified active students and active administrators.';

-- ---------------------------------------------------------------------------
-- Listing image metadata
-- ---------------------------------------------------------------------------

drop policy if exists "Listing images are publicly readable"
  on public.listing_images;
drop policy if exists "Active users can read marketplace listing images"
  on public.listing_images;
drop policy if exists "Sellers can read their listing images"
  on public.listing_images;
drop policy if exists "Verified students can read marketplace listing images"
  on public.listing_images;
drop policy if exists "Verified students can read their own listing images"
  on public.listing_images;
drop policy if exists "Admins can read all listing images"
  on public.listing_images;
drop policy if exists "Listing image reads require authorized account"
  on public.listing_images;

create policy "Listing image reads require authorized account"
on public.listing_images
as restrictive
for select
to authenticated
using (
  (select private.is_verified_active_student())
  or (select private.is_active_admin())
);

create policy "Verified students can read marketplace listing images"
on public.listing_images
for select
to authenticated
using (
  (select private.is_verified_active_student())
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.status in ('available', 'reserved')
      and private.is_marketplace_seller(listings.seller_id)
  )
);

create policy "Verified students can read their own listing images"
on public.listing_images
for select
to authenticated
using (
  (select private.is_verified_active_student())
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
);

create policy "Admins can read all listing images"
on public.listing_images
for select
to authenticated
using ((select private.is_active_admin()));

drop policy if exists "Sellers can add listing images"
  on public.listing_images;
drop policy if exists "Verified students can add their listing images"
  on public.listing_images;
drop policy if exists "Listing image creation requires verified ownership"
  on public.listing_images;

create policy "Listing image creation requires verified ownership"
on public.listing_images
as restrictive
for insert
to authenticated
with check (
  (select private.is_verified_active_student())
  and (storage.foldername(listing_images.storage_path))[1]
    = (select auth.uid()::text)
  and (storage.foldername(listing_images.storage_path))[2]
    = listing_images.listing_id::text
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
);

create policy "Verified students can add their listing images"
on public.listing_images
for insert
to authenticated
with check (
  (select private.is_verified_active_student())
  and (storage.foldername(listing_images.storage_path))[1]
    = (select auth.uid()::text)
  and (storage.foldername(listing_images.storage_path))[2]
    = listing_images.listing_id::text
  and array_length(storage.foldername(listing_images.storage_path), 1) = 2
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
  )
);

drop policy if exists "Sellers can update listing images"
  on public.listing_images;
drop policy if exists "Verified students can update their listing images"
  on public.listing_images;
drop policy if exists "Listing image updates require verified ownership"
  on public.listing_images;

create policy "Listing image updates require verified ownership"
on public.listing_images
as restrictive
for update
to authenticated
using (
  (select private.is_verified_active_student())
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
)
with check (
  (select private.is_verified_active_student())
  and (storage.foldername(listing_images.storage_path))[1]
    = (select auth.uid()::text)
  and (storage.foldername(listing_images.storage_path))[2]
    = listing_images.listing_id::text
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
);

create policy "Verified students can update their listing images"
on public.listing_images
for update
to authenticated
using (
  (select private.is_verified_active_student())
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
)
with check (
  (select private.is_verified_active_student())
  and (storage.foldername(listing_images.storage_path))[1]
    = (select auth.uid()::text)
  and (storage.foldername(listing_images.storage_path))[2]
    = listing_images.listing_id::text
  and array_length(storage.foldername(listing_images.storage_path), 1) = 2
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
  )
);

drop policy if exists "Sellers can delete listing images"
  on public.listing_images;
drop policy if exists "Verified students can delete their listing images"
  on public.listing_images;
drop policy if exists "Listing image deletes require verified ownership"
  on public.listing_images;

create policy "Listing image deletes require verified ownership"
on public.listing_images
as restrictive
for delete
to authenticated
using (
  (select private.is_verified_active_student())
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
);

create policy "Verified students can delete their listing images"
on public.listing_images
for delete
to authenticated
using (
  (select private.is_verified_active_student())
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
);

-- ---------------------------------------------------------------------------
-- Private listing image Storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'listing-images',
  'listing-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- These security-definer predicates bypass nested table RLS only after
-- explicitly checking the live profile, listing owner, path, and visibility.
-- They keep Storage policy evaluation free of circular table-policy lookups.
create or replace function private.can_manage_listing_image_object(
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
    and array_length(storage.foldername(p_name), 1) = 2
    and (storage.foldername(p_name))[1] = (select auth.uid()::text)
    and lower(storage.extension(p_name)) in ('jpg', 'jpeg', 'png', 'webp')
    and exists (
      select 1
      from public.listings
      where listings.id::text = (storage.foldername(p_name))[2]
        and listings.seller_id = (select auth.uid())
    );
$$;

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
      -- An owner may read a freshly uploaded object before inserting its
      -- listing_images metadata row, which keeps the two-step upload working.
      (
        p_owner_id = (select auth.uid()::text)
        and array_length(storage.foldername(p_name), 1) = 2
        and (storage.foldername(p_name))[1] = (select auth.uid()::text)
        and exists (
          select 1
          from public.listings
          where listings.id::text = (storage.foldername(p_name))[2]
            and listings.seller_id = (select auth.uid())
        )
      )
      or exists (
        select 1
        from public.listing_images
        join public.listings
          on listings.id = listing_images.listing_id
        where listing_images.storage_path = p_name
          and listings.status in ('available', 'reserved')
          and private.is_marketplace_seller(listings.seller_id)
          and array_length(storage.foldername(p_name), 1) = 2
          and (storage.foldername(p_name))[1] = listings.seller_id::text
          and (storage.foldername(p_name))[2] = listings.id::text
          and p_owner_id = listings.seller_id::text
      )
  end;
$$;

revoke all on function private.can_manage_listing_image_object(text, text)
  from public, anon;
revoke all on function private.can_read_listing_image_object(text, text)
  from public, anon;
grant execute on function private.can_manage_listing_image_object(text, text)
  to authenticated;
grant execute on function private.can_read_listing_image_object(text, text)
  to authenticated;

drop policy if exists "Users can upload listing images"
  on storage.objects;
drop policy if exists "Verified students can upload listing images"
  on storage.objects;
drop policy if exists "Users can manage their listing images"
  on storage.objects;
drop policy if exists "Verified students can update listing image objects"
  on storage.objects;
drop policy if exists "Users can delete their listing images"
  on storage.objects;
drop policy if exists "Verified students can delete listing image objects"
  on storage.objects;
drop policy if exists "Verified students can read their listing image objects"
  on storage.objects;
drop policy if exists "Authorized marketplace users can read listing image objects"
  on storage.objects;

drop policy if exists "Anonymous users cannot access listing image objects"
  on storage.objects;
create policy "Anonymous users cannot access listing image objects"
on storage.objects
as restrictive
for all
to anon
using (bucket_id <> 'listing-images')
with check (bucket_id <> 'listing-images');

drop policy if exists "Listing image objects stay marketplace private"
  on storage.objects;
create policy "Listing image objects stay marketplace private"
on storage.objects
as restrictive
for select
to authenticated
using (
  bucket_id <> 'listing-images'
  or private.can_read_listing_image_object(name, owner_id)
);

drop policy if exists "Listing image uploads stay owner scoped"
  on storage.objects;
create policy "Listing image uploads stay owner scoped"
on storage.objects
as restrictive
for insert
to authenticated
with check (
  bucket_id <> 'listing-images'
  or private.can_manage_listing_image_object(name, owner_id)
);

drop policy if exists "Listing image updates stay owner scoped"
  on storage.objects;
create policy "Listing image updates stay owner scoped"
on storage.objects
as restrictive
for update
to authenticated
using (
  bucket_id <> 'listing-images'
  or private.can_manage_listing_image_object(name, owner_id)
)
with check (
  bucket_id <> 'listing-images'
  or private.can_manage_listing_image_object(name, owner_id)
);

drop policy if exists "Listing image deletes stay owner scoped"
  on storage.objects;
create policy "Listing image deletes stay owner scoped"
on storage.objects
as restrictive
for delete
to authenticated
using (
  bucket_id <> 'listing-images'
  or private.can_manage_listing_image_object(name, owner_id)
);

create policy "Authorized marketplace users can read listing image objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'listing-images'
  and private.can_read_listing_image_object(name, owner_id)
);

create policy "Verified students can upload listing images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'listing-images'
  and private.can_manage_listing_image_object(name, owner_id)
);

create policy "Verified students can update listing image objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'listing-images'
  and private.can_manage_listing_image_object(name, owner_id)
)
with check (
  bucket_id = 'listing-images'
  and private.can_manage_listing_image_object(name, owner_id)
);

create policy "Verified students can delete listing image objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'listing-images'
  and private.can_manage_listing_image_object(name, owner_id)
);

comment on function private.can_manage_listing_image_object(text, text) is
  'Checks live verified-active status and ownership for listing image Storage mutations.';
comment on function private.can_read_listing_image_object(text, text) is
  'Checks live marketplace or active-admin access for private listing image delivery.';

commit;
