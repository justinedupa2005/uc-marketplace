-- Read-only catalog assertions for Step 14. Run after all migrations.
with helpers as (
  select oid, prosecdef, proconfig, proacl, proowner
  from pg_proc where oid in (
    to_regprocedure('private.validate_profile_avatar()'),
    to_regprocedure('private.can_manage_avatar_object(text,text)'),
    to_regprocedure('private.can_delete_avatar_object(text,text)')
  )
), checks(check_name, passed) as (
  values
    ('profile updates remain owner-active and protected columns are not writable',
      (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass)
      and exists (select 1 from pg_policies where schemaname = 'public'
        and tablename = 'profiles' and cmd = 'UPDATE' and permissive = 'RESTRICTIVE'
        and qual ilike '%auth.uid()%account_status%active%')
      and has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')
      and has_column_privilege('authenticated', 'public.profiles', 'year_level', 'UPDATE')
      and has_column_privilege('authenticated', 'public.profiles', 'avatar_path', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
      and not exists (select 1 from unnest(array[
        'id','role','verification_status','account_status','created_at','updated_at'
      ]) as protected(column_name)
        where has_column_privilege('authenticated', 'public.profiles', column_name, 'UPDATE'))),
    ('seller projection has only seven safe columns and preserves audience gating',
      (select count(*) = 7 from information_schema.columns
        where table_schema = 'public' and table_name = 'marketplace_profiles')
      and not exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'marketplace_profiles'
          and column_name not in ('id','full_name','course','year_level','avatar_path',
            'verification_status','created_at'))
      and (select coalesce(reloptions, '{}'::text[]) @> array['security_barrier=true']
        from pg_class where oid = 'public.marketplace_profiles'::regclass)
      and pg_get_viewdef('public.marketplace_profiles'::regclass, true)
        ilike '%is_verified_active_student%'
      and pg_get_viewdef('public.marketplace_profiles'::regclass, true)
        ilike '%is_active_admin%'
      and has_table_privilege('authenticated', 'public.marketplace_profiles', 'SELECT')
      and not has_table_privilege('anon', 'public.marketplace_profiles', 'SELECT')),
    ('allowed academic identity and avatar path constraints remain enforced',
      (select count(*) = 4 and bool_and(convalidated) from pg_constraint
        where conrelid = 'public.profiles'::regclass and conname in (
          'profiles_full_name_check','profiles_course_value_check',
          'profiles_year_level_check','profiles_avatar_path_check'))
      and exists (select 1 from pg_trigger
        where tgrelid = 'public.profiles'::regclass
          and tgname = 'profiles_20_protect_verified_identity' and tgenabled = 'O')
      and exists (select 1 from pg_trigger
        where tgrelid = 'public.profiles'::regclass
          and tgname = 'profiles_30_validate_avatar' and tgenabled = 'O')),
    ('avatar bucket is public-safe and enforces 2 MiB image uploads',
      exists (select 1 from storage.buckets where id = 'avatars' and public
        and file_size_limit = 2097152
        and allowed_mime_types = array['image/jpeg','image/png','image/webp']::text[])
      and exists (select 1 from storage.buckets
        where id = 'student-verifications' and not public)),
    ('avatar policies require active ownership and forbid mutable upserts',
      exists (select 1 from pg_policies where schemaname = 'storage'
        and tablename = 'objects' and policyname = 'Avatar inserts require active ownership'
        and cmd = 'INSERT' and permissive = 'RESTRICTIVE')
      and exists (select 1 from pg_policies where schemaname = 'storage'
        and tablename = 'objects' and policyname = 'Avatar objects are immutable'
        and cmd = 'UPDATE' and permissive = 'RESTRICTIVE')
      and exists (select 1 from pg_policies where schemaname = 'storage'
        and tablename = 'objects' and policyname = 'Avatar deletes protect the linked image'
        and cmd = 'DELETE' and permissive = 'RESTRICTIVE')
      and not exists (select 1 from pg_policies where schemaname = 'storage'
        and tablename = 'objects' and policyname = 'Users can update their own avatar')),
    ('avatar helpers use fixed search paths and no anonymous execution',
      (select count(*) = 3 and bool_and(prosecdef)
        and bool_and(coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[])
        and bool_and(not has_function_privilege('anon', oid, 'EXECUTE'))
        from helpers)
      and not exists (select 1 from helpers cross join lateral
        aclexplode(coalesce(helpers.proacl, acldefault('f', helpers.proowner))) as permission
        where permission.grantee = 0 and permission.privilege_type = 'EXECUTE')
      and not has_function_privilege('authenticated', 'private.validate_profile_avatar()', 'EXECUTE')),
    ('avatar deletion serializes with profile replacement',
      (select provolatile = 'v' from pg_proc
        where oid = 'private.can_delete_avatar_object(text,text)'::regprocedure)
      and pg_get_functiondef('private.can_delete_avatar_object(text,text)'::regprocedure)
        ilike '%for update%'
      and pg_get_functiondef('private.validate_profile_avatar()'::regprocedure)
        ilike '%for key share%')
)
select check_name, coalesce(passed, false) as passed from checks
union all
select '__all_profile_security_checks_passed__', bool_and(coalesce(passed, false))
from checks
order by check_name;
