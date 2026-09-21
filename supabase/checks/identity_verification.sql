-- Read-only checks for 20260917010000_add_identity_and_verification.sql.
-- Run this in the Supabase SQL Editor after the migration succeeds.

-- Expected: profiles and verifications both have RLS enabled.
select
  namespace.nspname as schema_name,
  relation.relname as table_name,
  relation.relrowsecurity as rls_enabled
from pg_class as relation
join pg_namespace as namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname in (
    'profiles',
    'verifications',
    'categories',
    'listings',
    'listing_images'
  )
order by relation.relname;

-- Expected: 0. Every existing Auth user must have a profile.
select count(*) as auth_users_missing_profiles
from auth.users as auth_user
left join public.profiles as profile on profile.id = auth_user.id
where profile.id is null;

-- Inspect safe server-assigned defaults without displaying email addresses.
select id, role, verification_status, account_status, created_at
from public.profiles
order by created_at desc
limit 10;

-- Expected: avatars is public; student-verifications is private.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('avatars', 'student-verifications', 'listing-images')
order by id;

-- Expected: all ten MVP categories are present and active.
select name, slug, is_active
from public.categories
order by name;

-- Inspect table and Storage policies.
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where (
    schemaname = 'public'
    and tablename in (
      'profiles',
      'verifications',
      'categories',
      'listings',
      'listing_images'
    )
  )
  or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

-- Expected: authenticated has profile SELECT plus UPDATE only on editable
-- columns. There must be no profile INSERT or DELETE grant.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('profiles', 'verifications')
order by table_name, grantee, privilege_type;

select grantee, table_name, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in ('profiles', 'verifications')
  and grantee = 'authenticated'
order by table_name, privilege_type, column_name;

-- Inspect automatic timestamp, signup, and verification-state triggers.
select
  trigger_schema,
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation
from information_schema.triggers
where trigger_schema in ('public', 'auth')
  and event_object_table in (
    'profiles',
    'verifications',
    'categories',
    'listings',
    'users'
  )
order by event_object_table, trigger_name, event_manipulation;

-- Expected: 0. There can never be multiple pending requests per student.
select user_id, count(*) as pending_count
from public.verifications
where status = 'pending'
group by user_id
having count(*) > 1;
