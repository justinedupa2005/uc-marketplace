-- Read-only catalog checks for Step 12. Run after the notification migration.
with notification_functions as (
  select function.oid, function.prosecdef, function.proconfig,
    function.proacl, function.proowner, namespace.nspname
  from pg_proc as function
  join pg_namespace as namespace on namespace.oid = function.pronamespace
  where function.oid in (
    to_regprocedure('public.mark_notification_read(uuid)'),
    to_regprocedure('public.mark_all_notifications_read(timestamptz)'),
    to_regprocedure('public.get_my_notification_state()'),
    to_regprocedure('private.create_notification(uuid,text,text,text,text,uuid,uuid,uuid,uuid)'),
    to_regprocedure('private.notify_new_message()'),
    to_regprocedure('private.notify_reservation_event()'),
    to_regprocedure('private.notify_meetup_event()'),
    to_regprocedure('private.notify_verification_review()'),
    to_regprocedure('private.notify_listing_removed()'),
    to_regprocedure('private.notify_account_status_change()')
  )
), checks(check_name, passed) as (
  values
    ('notifications exist with recipient, generated id, and durable timestamps',
      exists (select 1 from pg_class where oid = to_regclass('public.notifications') and relrowsecurity)
      and (select count(*) = 13 from information_schema.columns
           where table_schema = 'public' and table_name = 'notifications'
             and column_name in ('id', 'user_id', 'type', 'title', 'message', 'listing_id',
               'conversation_id', 'reservation_id', 'meetup_id', 'is_read', 'created_at', 'read_at', 'event_key'))
      and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'notifications'
                    and column_name = 'user_id' and is_nullable = 'NO')
      and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'notifications'
                    and column_name = 'created_at' and is_nullable = 'NO'
                    and column_default is not null)),
    ('recipient and related context use private-preserving foreign keys',
      (select count(*) = 5 from pg_constraint
       where conrelid = to_regclass('public.notifications') and contype = 'f')
      and exists (select 1 from pg_constraint
                  where conrelid = to_regclass('public.notifications') and contype = 'f'
                    and confrelid = to_regclass('auth.users') and confdeltype = 'c')
      and (select count(*) = 4 from pg_constraint
           where conrelid = to_regclass('public.notifications') and contype = 'f'
             and confrelid in (
               to_regclass('public.listings'), to_regclass('public.conversations'),
               to_regclass('public.reservations'), to_regclass('public.meetups')
             ) and confdeltype = 'n')),
    ('read state and controlled notification content are constrained',
      exists (select 1 from pg_constraint
                  where conrelid = to_regclass('public.notifications') and contype = 'c'
                    and pg_get_constraintdef(oid) ilike '%is_read%read_at%')
      and exists (select 1 from pg_constraint
                  where conrelid = to_regclass('public.notifications') and contype = 'c'
                    and pg_get_constraintdef(oid) ilike '%reservation_requested%'
                    and pg_get_constraintdef(oid) ilike '%account_reactivated%')
      and exists (select 1 from pg_constraint
                  where conrelid = to_regclass('public.notifications') and contype = 'c'
                    and pg_get_constraintdef(oid) ilike '%char_length%title%')
      and exists (select 1 from pg_constraint
                  where conrelid = to_regclass('public.notifications') and contype = 'c'
                    and pg_get_constraintdef(oid) ilike '%char_length%message%')),
    ('only authenticated owners can select and no table mutations are exposed',
      has_table_privilege('authenticated', 'public.notifications', 'SELECT')
      and not has_table_privilege('anon', 'public.notifications', 'SELECT')
      and not has_table_privilege('authenticated', 'public.notifications', 'INSERT')
      and not has_table_privilege('authenticated', 'public.notifications', 'DELETE')
      and not has_any_column_privilege('authenticated', 'public.notifications', 'UPDATE')
      and not exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'notifications'
                        and cmd <> 'SELECT')
      and exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'notifications'
                    and cmd = 'SELECT' and qual ilike '%user_id%auth.uid()%')
      and not exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'notifications'
                        and qual ilike '%is_verified_active_student%')),
    ('notification functions lock their search path and have no public execution',
      (select count(*) = 10 and count(*) filter (where prosecdef) = 9
         and bool_and(coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[])
       from notification_functions)
      and not exists (select 1 from notification_functions as function
                       cross join lateral aclexplode(coalesce(function.proacl, acldefault('f', function.proowner))) as permission
                       where permission.grantee = 0 and permission.privilege_type = 'EXECUTE')),
    ('trusted notification creation and trigger functions cannot be called by clients',
      (select count(*) = 7
         and bool_and(not has_function_privilege('authenticated', oid, 'EXECUTE'))
         and bool_and(not has_function_privilege('anon', oid, 'EXECUTE'))
       from notification_functions where nspname = 'private')),
    ('read and unread-state RPCs are authenticated-only',
      (select count(*) = 3
         and bool_and(has_function_privilege('authenticated', oid, 'EXECUTE'))
         and bool_and(not has_function_privilege('anon', oid, 'EXECUTE'))
       from notification_functions where nspname = 'public')
      and pg_get_function_result(to_regprocedure('public.mark_notification_read(uuid)')) = 'boolean'
      and pg_get_function_result(to_regprocedure('public.mark_all_notifications_read(timestamptz)')) = 'integer'
      and pg_get_function_result(to_regprocedure('public.get_my_notification_state()'))
        = 'TABLE(unread_count bigint, snapshot_at timestamp with time zone)'),
    ('newest-first inbox, unread count, and duplicate event paths are indexed',
      exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'notifications'
               and indexdef ilike '%user_id, created_at DESC, id DESC%')
      and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'notifications'
               and indexdef ilike '%user_id%' and indexdef ilike '%WHERE%is_read%')
      and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'notifications'
               and indexdef ilike '%UNIQUE%' and indexdef ilike '%user_id, event_key%')),
    ('all six event sources have enabled notification triggers',
      (select count(*) = 6 from pg_trigger where not tgisinternal and tgenabled <> 'D'
       and (tgrelid, tgfoid) in (
         (to_regclass('public.messages'), to_regprocedure('private.notify_new_message()')),
         (to_regclass('public.reservations'), to_regprocedure('private.notify_reservation_event()')),
         (to_regclass('public.meetups'), to_regprocedure('private.notify_meetup_event()')),
         (to_regclass('public.verifications'), to_regprocedure('private.notify_verification_review()')),
         (to_regclass('public.listings'), to_regprocedure('private.notify_listing_removed()')),
         (to_regclass('public.profiles'), to_regprocedure('private.notify_account_status_change()'))
       )))
)
select check_name, coalesce(passed, false) as passed from checks
union all
select '__all_notification_security_checks_passed__', bool_and(coalesce(passed, false)) from checks
order by check_name;
