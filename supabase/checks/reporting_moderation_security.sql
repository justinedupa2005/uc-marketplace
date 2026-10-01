-- Read-only Step 13 catalog/security assertions. Run after all migrations.
with required_functions as (
  select function.oid, function.prosecdef, function.proconfig,
    function.proacl, function.proowner
  from pg_proc as function
  where function.oid in (
    to_regprocedure('public.report_student(uuid,text,text)'),
    to_regprocedure('public.admin_review_report(text,uuid,text,text)'),
    to_regprocedure('public.get_admin_report_note(text,uuid)'),
    to_regprocedure('public.admin_moderate_user(uuid,text,text)'),
    to_regprocedure('public.admin_moderate_listing(uuid,text)')
  )
), checks(check_name, passed) as (
  values
    ('student reports constrain identity, review state and duplicate active cases',
      to_regclass('public.student_reports') is not null
      and (select relrowsecurity from pg_class where oid = to_regclass('public.student_reports'))
      and (select count(*) = 11 from information_schema.columns
        where table_schema = 'public' and table_name = 'student_reports'
          and column_name in ('id', 'reporter_id', 'subject_id', 'reason',
            'details', 'status', 'created_at', 'updated_at', 'reviewed_by',
            'reviewed_at', 'admin_note'))
      and exists (select 1 from pg_indexes
        where schemaname = 'public' and tablename = 'student_reports'
          and indexname = 'student_reports_one_active_report_idx'
          and indexdef ilike '%UNIQUE%'
          and indexdef ilike '%reporter_id, subject_id%'
          and indexdef ilike '%WHERE%status%')
      and exists (select 1 from pg_constraint
        where conrelid = to_regclass('public.student_reports')
          and conname = 'student_reports_no_self_report')
      and exists (select 1 from pg_constraint
        where conrelid = to_regclass('public.student_reports')
          and conname = 'student_reports_review_metadata')),
    ('both report tables hide reviewer notes from reporters and deny direct writes',
      has_any_column_privilege('authenticated', 'public.student_reports', 'SELECT')
      and has_any_column_privilege('authenticated', 'public.listing_reports', 'SELECT')
      and not has_column_privilege('authenticated', 'public.student_reports', 'admin_note', 'SELECT')
      and not has_column_privilege('authenticated', 'public.listing_reports', 'admin_note', 'SELECT')
      and not has_any_column_privilege('anon', 'public.student_reports', 'SELECT')
      and not has_table_privilege('authenticated', 'public.student_reports', 'INSERT')
      and not has_any_column_privilege('authenticated', 'public.student_reports', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.student_reports', 'DELETE')
      and not has_table_privilege('authenticated', 'public.listing_reports', 'INSERT')
      and not has_any_column_privilege('authenticated', 'public.listing_reports', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.listing_reports', 'DELETE')),
    ('student report rows remain reporter-private with active admin override',
      exists (select 1 from pg_policies
        where schemaname = 'public' and tablename = 'student_reports'
          and cmd = 'SELECT' and qual ilike '%reporter_id%auth.uid()%'
          and qual ilike '%is_active_admin%')
      and not exists (select 1 from pg_policies
        where schemaname = 'public' and tablename = 'student_reports'
          and cmd <> 'SELECT')),
    ('report and moderation RPCs are hardened and authenticated-only',
      (select count(*) = 5 and bool_and(prosecdef)
        and bool_and(coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[])
        from required_functions)
      and not exists (select 1 from required_functions as function
        cross join lateral aclexplode(coalesce(function.proacl,
          acldefault('f', function.proowner))) as permission
        where permission.grantee = 0 and permission.privilege_type = 'EXECUTE')
      and (select bool_and(has_function_privilege('authenticated', oid, 'EXECUTE'))
        and bool_and(not has_function_privilege('anon', oid, 'EXECUTE'))
        from required_functions)),
    ('legacy unaudited moderation RPCs cannot be called by clients',
      not has_function_privilege('authenticated',
        'public.admin_set_account_status(uuid,text)', 'EXECUTE')
      and not has_function_privilege('authenticated',
        'public.admin_remove_listing(uuid)', 'EXECUTE')
      and not has_function_privilege('anon',
        'public.admin_set_account_status(uuid,text)', 'EXECUTE')
      and not has_function_privilege('anon',
        'public.admin_remove_listing(uuid)', 'EXECUTE')),
    ('immutable moderation audit is private and indexed',
      to_regclass('private.moderation_actions') is not null
      and (select relrowsecurity from pg_class
        where oid = to_regclass('private.moderation_actions'))
      and not has_any_column_privilege('authenticated',
        'private.moderation_actions', 'SELECT')
      and not has_table_privilege('authenticated',
        'private.moderation_actions', 'INSERT')
      and not has_any_column_privilege('authenticated',
        'private.moderation_actions', 'UPDATE')
      and not has_table_privilege('authenticated',
        'private.moderation_actions', 'DELETE')
      and (select count(*) = 3 from pg_indexes
        where schemaname = 'private' and tablename = 'moderation_actions'
          and indexname in ('moderation_actions_actor_created_idx',
            'moderation_actions_target_user_created_idx',
            'moderation_actions_listing_created_idx')))
)
select check_name, coalesce(passed, false) as passed from checks
union all
select '__all_reporting_moderation_security_checks_passed__',
  bool_and(coalesce(passed, false)) from checks
order by check_name;
