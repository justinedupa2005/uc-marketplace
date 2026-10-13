-- Final cross-domain catalog invariants. Read-only; no test/production writes.
with protected_tables(schema_name, table_name) as (
  values ('public','profiles'), ('public','verifications'), ('public','categories'),
    ('public','listings'), ('public','listing_images'), ('public','favorites'),
    ('public','conversations'), ('public','messages'), ('public','reservations'),
    ('public','meetups'), ('public','notifications'), ('public','listing_reports'),
    ('public','student_reports'), ('private','moderation_actions')
), functions as (
  select function.* from pg_proc function join pg_namespace namespace on namespace.oid = function.pronamespace
  where namespace.nspname in ('public','private') and function.prosecdef
), checks(check_name, passed) as (
  values
    ('every private or marketplace table has RLS enabled', (
      select count(*) = 14 and bool_and(class.relrowsecurity)
      from protected_tables target left join pg_namespace namespace on namespace.nspname = target.schema_name
      left join pg_class class on class.relnamespace = namespace.oid and class.relname = target.table_name
    )),
    ('anonymous users have no sensitive table privileges', not exists (
      select 1 from protected_tables target
      where has_table_privilege('anon', format('%I.%I',target.schema_name,target.table_name),'SELECT,INSERT,UPDATE,DELETE')
    )),
    ('all security-definer app functions pin an empty search path', (
      select count(*) > 0 and bool_and(coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[]) from functions
    )),
    ('no app security-definer function grants PUBLIC or anonymous execution', not exists (
      select 1 from functions function
      cross join lateral aclexplode(coalesce(function.proacl, acldefault('f', function.proowner))) acl
      where (acl.grantee = 0 or acl.grantee = (select oid from pg_roles where rolname = 'anon')) and acl.privilege_type = 'EXECUTE'
    )),
    ('ordinary users cannot create replacement functions in trusted schemas',
      not has_schema_privilege('authenticated','public','CREATE')
      and not has_schema_privilege('authenticated','private','CREATE')
      and not has_schema_privilege('anon','public','CREATE')
      and not has_schema_privilege('anon','private','CREATE')),
    ('protected profile authority and timestamps are not client writable', not exists (
      select 1 from unnest(array['id','role','verification_status','account_status','created_at','updated_at']) field
      where has_column_privilege('authenticated','public.profiles',field,'UPDATE')
    )),
    ('public seller projection contains exactly seven privacy-safe fields', (
      select array_agg(column_name::text order by ordinal_position) = array['id','full_name','course','year_level','avatar_path','verification_status','created_at']::text[]
      from information_schema.columns where table_schema = 'public' and table_name = 'marketplace_profiles'
    )),
    ('chat reservation meetup notification tables have no direct client writes', not exists (
      select 1 from unnest(array['conversations','messages','reservations','meetups','notifications']) target
      where has_table_privilege('authenticated','public.' || target,'INSERT,UPDATE,DELETE')
    )),
    ('report admin notes and moderation history remain private',
      not has_column_privilege('authenticated','public.listing_reports','admin_note','SELECT')
      and not has_column_privilege('authenticated','public.student_reports','admin_note','SELECT')
      and not has_table_privilege('authenticated','private.moderation_actions','SELECT,INSERT,UPDATE,DELETE')),
    ('avatar images are public while school IDs and listing images are private', (
      select count(*) = 3 and bool_and(public = (id = 'avatars'))
      from storage.buckets where id in ('avatars','listing-images','student-verifications')
    )),
    ('Storage bucket limits and accepted media types remain configured', (
      select count(*) = 3 and bool_and(file_size_limit = case when id = 'avatars' then 2097152 else 5242880 end
        and cardinality(allowed_mime_types) = 3 and allowed_mime_types @> array['image/jpeg','image/png','image/webp']::text[])
      from storage.buckets where id in ('avatars','listing-images','student-verifications')
    )),
    ('active request and accepted-reservation uniqueness remain enforced',
      exists(select 1 from pg_indexes where schemaname='public' and tablename='reservations' and indexdef ilike '%unique%' and indexdef ilike '%listing_id%' and indexdef ilike '%accepted%')
      and exists(select 1 from pg_indexes where schemaname='public' and tablename='reservations' and indexdef ilike '%unique%' and indexdef ilike '%buyer_id%' and indexdef ilike '%pending%')),
    ('notification delivery events remain deduplicated per recipient',
      exists(select 1 from pg_constraint where conrelid='public.notifications'::regclass and contype='u' and pg_get_constraintdef(oid) ilike '%user_id, event_key%')),
    ('live student eligibility requires both verification and active account status',
      pg_get_functiondef(to_regprocedure('private.is_verified_active_student()')) ilike '%role%student%verification_status%verified%account_status%active%')
)
select check_name, coalesce(passed,false) as passed from checks
union all select '__all_release_security_checks_passed__', bool_and(coalesce(passed,false)) from checks
order by check_name;
