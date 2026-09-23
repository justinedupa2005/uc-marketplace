-- Run after 20260922000000_complete_authorization_hardening.sql.
-- Every row in the first result set must report passed = true.

select
  check_name,
  passed
from (
  values
    (
      'all protected tables have RLS enabled',
      (
        select count(*) = 5
        from pg_class as class
        join pg_namespace as namespace on namespace.oid = class.relnamespace
        where namespace.nspname = 'public'
          and class.relname in (
            'profiles',
            'verifications',
            'categories',
            'listings',
            'listing_images'
          )
          and class.relrowsecurity
      )
    ),
    (
      'anonymous role has no protected table privileges',
      not has_table_privilege('anon', 'public.profiles', 'SELECT')
      and not has_table_privilege('anon', 'public.profiles', 'INSERT')
      and not has_table_privilege('anon', 'public.profiles', 'UPDATE')
      and not has_table_privilege('anon', 'public.profiles', 'DELETE')
      and not has_table_privilege('anon', 'public.verifications', 'SELECT')
      and not has_table_privilege('anon', 'public.verifications', 'INSERT')
      and not has_table_privilege('anon', 'public.verifications', 'UPDATE')
      and not has_table_privilege('anon', 'public.verifications', 'DELETE')
      and not has_table_privilege('anon', 'public.categories', 'SELECT')
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
      'profile authorization fields are not client writable',
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
      'identity and verification restrictive gates exist',
      (
        select count(*) = 3
        from pg_policies
        where schemaname = 'public'
          and permissive = 'RESTRICTIVE'
          and (tablename, policyname) in (
            ('profiles', 'Profile reads require owner or active admin'),
            ('profiles', 'Profile updates require an active owner'),
            ('verifications', 'Verification reads require owner or active admin')
          )
      )
    ),
    (
      'no unexpected permissive protected-table policy exists',
      not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename in (
            'profiles',
            'verifications',
            'categories',
            'listings',
            'listing_images'
          )
          and permissive = 'PERMISSIVE'
          and (tablename, policyname) not in (
            ('profiles', 'Users can read their own profile'),
            ('profiles', 'Admins can read all profiles'),
            ('profiles', 'Users can update their editable profile fields'),
            ('verifications', 'Users can read their verification history'),
            ('verifications', 'Admins can read all verification requests'),
            ('categories', 'Verified students can read active categories'),
            ('categories', 'Admins can read all categories'),
            ('listings', 'Verified students can read marketplace listings'),
            ('listings', 'Verified students can read their own listings'),
            ('listings', 'Admins can read all listings'),
            ('listings', 'Verified students can create their listings'),
            ('listings', 'Verified students can update their listings'),
            ('listings', 'Verified students can delete their listings'),
            ('listing_images', 'Verified students can read marketplace listing images'),
            ('listing_images', 'Verified students can read their own listing images'),
            ('listing_images', 'Admins can read all listing images'),
            ('listing_images', 'Verified students can add their listing images'),
            ('listing_images', 'Verified students can update their listing images'),
            ('listing_images', 'Verified students can delete their listing images')
          )
      )
    ),
    (
      'seller update and delete policies preserve admin removals',
      (
        select count(*) = 4
        from pg_policies
        where schemaname = 'public'
          and tablename = 'listings'
          and policyname in (
            'Listing updates require verified ownership',
            'Verified students can update their listings',
            'Listing deletes require verified ownership',
            'Verified students can delete their listings'
          )
          and coalesce(qual, '') ilike '%removed%'
          and (
            cmd = 'DELETE'
            or coalesce(with_check, '') ilike '%removed%'
          )
      )
    ),
    (
      'listing image policies preserve admin removals',
      (
        select count(*) = 6
        from pg_policies
        where schemaname = 'public'
          and tablename = 'listing_images'
          and policyname in (
            'Listing image creation requires verified ownership',
            'Verified students can add their listing images',
            'Listing image updates require verified ownership',
            'Verified students can update their listing images',
            'Listing image deletes require verified ownership',
            'Verified students can delete their listing images'
          )
          and (
            coalesce(qual, '') ilike '%removed%'
            or coalesce(with_check, '') ilike '%removed%'
          )
      )
    ),
    (
      'listing Storage mutation helper preserves admin removals',
      pg_get_functiondef(
        'private.can_manage_listing_image_object(text,text)'::regprocedure
      ) ilike '%status <> ''removed''%'
    ),
    (
      'privileged RPCs are not anonymously executable',
      not has_function_privilege(
        'anon', 'public.review_verification(uuid,text,text)', 'EXECUTE'
      )
      and not has_function_privilege(
        'anon', 'public.admin_set_account_status(uuid,text)', 'EXECUTE'
      )
      and not has_function_privilege(
        'anon', 'public.admin_remove_listing(uuid)', 'EXECUTE'
      )
    )
) as checks(check_name, passed)
order by check_name;

-- Inspect the exact final inventory after the boolean checks.
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
where schemaname = 'public'
  and tablename in (
    'profiles',
    'verifications',
    'categories',
    'listings',
    'listing_images'
  )
order by tablename, cmd, policyname;

-- Compact result for CLI clients that display only the final statement.
select
  (
    select count(*) = 5
    from pg_class as class
    join pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname in (
        'profiles', 'verifications', 'categories', 'listings', 'listing_images'
      )
      and class.relrowsecurity
  ) as protected_tables_rls_enabled,
  not has_table_privilege('anon', 'public.profiles', 'SELECT')
    and not has_table_privilege('anon', 'public.profiles', 'INSERT')
    and not has_table_privilege('anon', 'public.profiles', 'UPDATE')
    and not has_table_privilege('anon', 'public.profiles', 'DELETE')
    and not has_table_privilege('anon', 'public.verifications', 'SELECT')
    and not has_table_privilege('anon', 'public.verifications', 'INSERT')
    and not has_table_privilege('anon', 'public.verifications', 'UPDATE')
    and not has_table_privilege('anon', 'public.verifications', 'DELETE')
    and not has_table_privilege('anon', 'public.categories', 'SELECT')
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
    as anonymous_access_revoked,
  not has_column_privilege(
    'authenticated', 'public.profiles', 'role', 'UPDATE'
  )
    and not has_column_privilege(
      'authenticated', 'public.profiles', 'verification_status', 'UPDATE'
    )
    and not has_column_privilege(
      'authenticated', 'public.profiles', 'account_status', 'UPDATE'
    ) as authorization_fields_protected,
  (
    select count(*) = 3
    from pg_policies
    where schemaname = 'public'
      and permissive = 'RESTRICTIVE'
      and (tablename, policyname) in (
        ('profiles', 'Profile reads require owner or active admin'),
        ('profiles', 'Profile updates require an active owner'),
        ('verifications', 'Verification reads require owner or active admin')
      )
  ) as identity_restrictive_gates_present,
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles', 'verifications', 'categories', 'listings', 'listing_images'
      )
      and permissive = 'PERMISSIVE'
      and (tablename, policyname) not in (
        ('profiles', 'Users can read their own profile'),
        ('profiles', 'Admins can read all profiles'),
        ('profiles', 'Users can update their editable profile fields'),
        ('verifications', 'Users can read their verification history'),
        ('verifications', 'Admins can read all verification requests'),
        ('categories', 'Verified students can read active categories'),
        ('categories', 'Admins can read all categories'),
        ('listings', 'Verified students can read marketplace listings'),
        ('listings', 'Verified students can read their own listings'),
        ('listings', 'Admins can read all listings'),
        ('listings', 'Verified students can create their listings'),
        ('listings', 'Verified students can update their listings'),
        ('listings', 'Verified students can delete their listings'),
        ('listing_images', 'Verified students can read marketplace listing images'),
        ('listing_images', 'Verified students can read their own listing images'),
        ('listing_images', 'Admins can read all listing images'),
        ('listing_images', 'Verified students can add their listing images'),
        ('listing_images', 'Verified students can update their listing images'),
        ('listing_images', 'Verified students can delete their listing images')
      )
  ) as permissive_policy_allowlist_clean,
  (
    select count(*) = 4
    from pg_policies
    where schemaname = 'public'
      and tablename = 'listings'
      and policyname in (
        'Listing updates require verified ownership',
        'Verified students can update their listings',
        'Listing deletes require verified ownership',
        'Verified students can delete their listings'
      )
      and coalesce(qual, '') ilike '%removed%'
      and (cmd = 'DELETE' or coalesce(with_check, '') ilike '%removed%')
  ) as removed_listings_locked,
  (
    select count(*) = 6
    from pg_policies
    where schemaname = 'public'
      and tablename = 'listing_images'
      and policyname in (
        'Listing image creation requires verified ownership',
        'Verified students can add their listing images',
        'Listing image updates require verified ownership',
        'Verified students can update their listing images',
        'Listing image deletes require verified ownership',
        'Verified students can delete their listing images'
      )
      and (
        coalesce(qual, '') ilike '%removed%'
        or coalesce(with_check, '') ilike '%removed%'
      )
  ) as removed_listing_images_locked,
  pg_get_functiondef(
    'private.can_manage_listing_image_object(text,text)'::regprocedure
  ) ilike '%status <> ''removed''%' as removed_storage_objects_locked,
  not has_function_privilege(
    'anon', 'public.review_verification(uuid,text,text)', 'EXECUTE'
  )
    and not has_function_privilege(
      'anon', 'public.admin_set_account_status(uuid,text)', 'EXECUTE'
    )
    and not has_function_privilege(
      'anon', 'public.admin_remove_listing(uuid)', 'EXECUTE'
    ) as privileged_rpcs_not_anonymous;
