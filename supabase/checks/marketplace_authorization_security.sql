-- Run after 20260921000000_strengthen_marketplace_authorization.sql.
-- Every row in the first result set should report passed = true.

select
  check_name,
  passed
from (
  values
    (
      'listing-images bucket is private and constrained',
      coalesce((
        select
          not public
          and file_size_limit = 5242880
          and allowed_mime_types @> array[
            'image/jpeg', 'image/png', 'image/webp'
          ]::text[]
          and cardinality(allowed_mime_types) = 3
        from storage.buckets
        where id = 'listing-images'
      ), false)
    ),
    (
      'marketplace catalog tables have RLS enabled',
      (
        select count(*) = 3
        from pg_class as class
        join pg_namespace as namespace on namespace.oid = class.relnamespace
        where namespace.nspname = 'public'
          and class.relname in ('categories', 'listings', 'listing_images')
          and class.relrowsecurity
      )
    ),
    (
      'anonymous role has no marketplace table privileges',
      not has_table_privilege('anon', 'public.categories', 'SELECT')
      and not has_table_privilege('anon', 'public.categories', 'INSERT')
      and not has_table_privilege('anon', 'public.categories', 'UPDATE')
      and not has_table_privilege('anon', 'public.categories', 'DELETE')
      and not has_table_privilege('anon', 'public.listings', 'SELECT')
      and not has_table_privilege('anon', 'public.listings', 'INSERT')
      and not has_table_privilege('anon', 'public.listings', 'UPDATE')
      and not has_table_privilege('anon', 'public.listings', 'DELETE')
      and not has_table_privilege('anon', 'public.listing_images', 'SELECT')
      and not has_table_privilege('anon', 'public.listing_images', 'INSERT')
      and not has_table_privilege('anon', 'public.listing_images', 'UPDATE')
      and not has_table_privilege('anon', 'public.listing_images', 'DELETE')
    ),
    (
      'profile authorization fields are database controlled',
      not has_column_privilege(
        'authenticated', 'public.profiles', 'role', 'UPDATE'
      )
      and not has_column_privilege(
        'authenticated', 'public.profiles', 'verification_status', 'UPDATE'
      )
      and not has_column_privilege(
        'authenticated', 'public.profiles', 'account_status', 'UPDATE'
      )
    ),
    (
      'marketplace catalog has restrictive authorization gates',
      (
        select count(*) = 9
        from pg_policies
        where schemaname = 'public'
          and tablename in ('categories', 'listings', 'listing_images')
          and permissive = 'RESTRICTIVE'
          and policyname in (
            'Marketplace category reads require authorized account',
            'Marketplace listing reads require authorized account',
            'Listing creation requires verified ownership',
            'Listing updates require verified ownership',
            'Listing deletes require verified ownership',
            'Listing image reads require authorized account',
            'Listing image creation requires verified ownership',
            'Listing image updates require verified ownership',
            'Listing image deletes require verified ownership'
          )
      )
    ),
    (
      'old permissive listing read policies are absent',
      not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'listings'
          and policyname in (
            'Marketplace listings are publicly readable',
            'Sellers can read their listings',
            'Active users can read marketplace listings'
          )
      )
    ),
    (
      'old permissive listing image read policies are absent',
      not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'listing_images'
          and policyname in (
            'Listing images are publicly readable',
            'Active users can read marketplace listing images',
            'Sellers can read their listing images'
          )
      )
    ),
    (
      'marketplace catalog policies use only authenticated role',
      not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename in ('categories', 'listings', 'listing_images')
          and roles <> array['authenticated']::name[]
      )
    ),
    (
      'private listing Storage restrictive policies exist',
      (
        select count(*) = 5
        from pg_policies
        where schemaname = 'storage'
          and tablename = 'objects'
          and permissive = 'RESTRICTIVE'
          and policyname in (
            'Anonymous users cannot access listing image objects',
            'Listing image objects stay marketplace private',
            'Listing image uploads stay owner scoped',
            'Listing image updates stay owner scoped',
            'Listing image deletes stay owner scoped'
          )
      )
    ),
    (
      'listing Storage helper execution is not anonymous',
      not has_function_privilege(
        'anon',
        'private.can_manage_listing_image_object(text,text)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'anon',
        'private.can_read_listing_image_object(text,text)',
        'EXECUTE'
      )
    ),
    (
      'marketplace profile projection is not anonymous',
      not has_table_privilege(
        'anon',
        'public.marketplace_profiles',
        'SELECT'
      )
    )
) as checks(check_name, passed)
order by check_name;

-- Inspect the final policy inventory. There should be no anonymous marketplace
-- table policy and no older active-account-only or unverified-owner read policy.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where (
    schemaname = 'public'
    and tablename in ('categories', 'listings', 'listing_images')
  )
   or (
     schemaname = 'storage'
     and tablename = 'objects'
     and policyname ilike '%listing image%'
   )
order by schemaname, tablename, cmd, policyname;

select pg_get_viewdef('public.marketplace_profiles'::regclass, true)
  as marketplace_profiles_definition;

-- Compact final result for CLI clients that display only the last statement.
select
  coalesce((
    select not public
    from storage.buckets
    where id = 'listing-images'
  ), false) as bucket_private,
  not has_table_privilege('anon', 'public.categories', 'SELECT')
    and not has_table_privilege('anon', 'public.listings', 'SELECT')
    and not has_table_privilege('anon', 'public.listing_images', 'SELECT')
    as anonymous_catalog_access_revoked,
  (
    select count(*) = 9
    from pg_policies
    where schemaname = 'public'
      and tablename in ('categories', 'listings', 'listing_images')
      and permissive = 'RESTRICTIVE'
  ) as catalog_restrictive_gates_present,
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'Marketplace listings are publicly readable',
        'Sellers can read their listings',
        'Active users can read marketplace listings',
        'Listing images are publicly readable',
        'Sellers can read their listing images',
        'Active users can read marketplace listing images',
        'Active categories are publicly readable'
      )
  ) as weak_read_policies_absent,
  (
    select count(*) = 5
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and permissive = 'RESTRICTIVE'
      and policyname ilike '%listing image%'
  ) as storage_restrictive_gates_present,
  pg_get_viewdef('public.marketplace_profiles'::regclass, true)
      ilike '%private.is_verified_active_student%'
    and pg_get_viewdef('public.marketplace_profiles'::regclass, true)
      ilike '%private.is_active_admin%'
    as seller_projection_is_gated;
