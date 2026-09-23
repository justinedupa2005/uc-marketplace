begin;

-- Defense-in-depth follow-up for Step 5. The previous migration is already
-- deployed, so this migration tightens its policies without rewriting history.

alter table public.profiles enable row level security;
alter table public.verifications enable row level security;
alter table public.categories enable row level security;
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;

revoke all on table public.categories from anon;
revoke all on table public.listings from anon;
revoke all on table public.listing_images from anon;
revoke all on table public.profiles from anon;
revoke all on table public.verifications from anon;

-- Keep the protected-field ACL explicit alongside the existing column-only
-- grant for student-editable profile fields.
revoke update (role, verification_status, account_status)
  on table public.profiles from authenticated;

-- ---------------------------------------------------------------------------
-- Identity and verification boundaries
-- ---------------------------------------------------------------------------

drop policy if exists "Profile reads require owner or active admin"
  on public.profiles;
create policy "Profile reads require owner or active admin"
on public.profiles
as restrictive
for select
to authenticated
using (
  id = (select auth.uid())
  or (select private.is_active_admin())
);

drop policy if exists "Profile updates require an active owner"
  on public.profiles;
create policy "Profile updates require an active owner"
on public.profiles
as restrictive
for update
to authenticated
using (
  id = (select auth.uid())
  and account_status = 'active'
)
with check (
  id = (select auth.uid())
  and account_status = 'active'
);

drop policy if exists "Verification reads require owner or active admin"
  on public.verifications;
create policy "Verification reads require owner or active admin"
on public.verifications
as restrictive
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_active_admin())
);

-- ---------------------------------------------------------------------------
-- Complete restrictive marketplace predicates
-- ---------------------------------------------------------------------------

-- Restrictive policies carry the complete maximum row set. A future
-- permissive policy therefore cannot expose inactive categories or private
-- listing history merely by using USING (true).
alter policy "Marketplace category reads require authorized account"
on public.categories
using (
  (select private.is_active_admin())
  or (
    (select private.is_verified_active_student())
    and is_active
  )
);

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
    )
  )
);

alter policy "Listing creation requires verified ownership"
on public.listings
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

-- `removed` is the admin moderation lock used by admin_remove_listing().
-- Sellers cannot set it, restore it, edit it, or erase its audit history.
alter policy "Listing updates require verified ownership"
on public.listings
using (
  seller_id = (select auth.uid())
  and status <> 'removed'
  and (select private.is_verified_active_student())
)
with check (
  seller_id = (select auth.uid())
  and status <> 'removed'
  and (select private.is_verified_active_student())
  and exists (
    select 1
    from public.categories
    where categories.id = listings.category_id
      and categories.is_active
  )
);

alter policy "Verified students can update their listings"
on public.listings
using (
  seller_id = (select auth.uid())
  and status <> 'removed'
  and (select private.is_verified_active_student())
)
with check (
  seller_id = (select auth.uid())
  and status <> 'removed'
  and (select private.is_verified_active_student())
  and exists (
    select 1
    from public.categories
    where categories.id = listings.category_id
      and categories.is_active
  )
);

alter policy "Listing deletes require verified ownership"
on public.listings
using (
  seller_id = (select auth.uid())
  and status <> 'removed'
  and (select private.is_verified_active_student())
);

alter policy "Verified students can delete their listings"
on public.listings
using (
  seller_id = (select auth.uid())
  and status <> 'removed'
  and (select private.is_verified_active_student())
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
        )
    )
  )
);

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
      and listings.status <> 'removed'
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
      and listings.status <> 'removed'
  )
);

alter policy "Listing image updates require verified ownership"
on public.listing_images
using (
  (select private.is_verified_active_student())
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
      and listings.status <> 'removed'
  )
)
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
      and listings.status <> 'removed'
  )
);

alter policy "Verified students can update their listing images"
on public.listing_images
using (
  (select private.is_verified_active_student())
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
      and listings.status <> 'removed'
  )
)
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
      and listings.status <> 'removed'
  )
);

alter policy "Listing image deletes require verified ownership"
on public.listing_images
using (
  (select private.is_verified_active_student())
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
      and listings.status <> 'removed'
  )
);

alter policy "Verified students can delete their listing images"
on public.listing_images
using (
  (select private.is_verified_active_student())
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
      and listings.status <> 'removed'
  )
);

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
    and cardinality(storage.foldername(p_name)) = 2
    and (storage.foldername(p_name))[1] = (select auth.uid()::text)
    and lower(storage.extension(p_name)) in ('jpg', 'jpeg', 'png', 'webp')
    and exists (
      select 1
      from public.listings
      where listings.id::text = (storage.foldername(p_name))[2]
        and listings.seller_id = (select auth.uid())
        and listings.status <> 'removed'
    );
$$;

revoke all on function private.can_manage_listing_image_object(text, text)
  from public, anon;
grant execute on function private.can_manage_listing_image_object(text, text)
  to authenticated;

-- Reassert privileged RPC grants. Each function also performs a live active-
-- admin check internally, so a stale session cannot preserve admin access.
revoke all on function public.review_verification(uuid, text, text)
  from public, anon;
revoke all on function public.admin_set_account_status(uuid, text)
  from public, anon;
revoke all on function public.admin_remove_listing(uuid)
  from public, anon;
grant execute on function public.review_verification(uuid, text, text)
  to authenticated;
grant execute on function public.admin_set_account_status(uuid, text)
  to authenticated;
grant execute on function public.admin_remove_listing(uuid)
  to authenticated;

comment on function private.can_manage_listing_image_object(text, text) is
  'Checks live verified-active status, ownership, path integrity, and moderation lock for listing image mutations.';

commit;
