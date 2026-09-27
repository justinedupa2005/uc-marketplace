-- Run after both 20260927000000_complete_messaging.sql and
-- 20260927010000_enable_messaging_realtime.sql.
-- Every row, including the summary, must report passed = true.

with messaging_rpc_oids(function_oid) as (
  select unnest(array[
    to_regprocedure('public.start_listing_conversation(uuid)'),
    to_regprocedure('public.send_conversation_message(uuid,text)'),
    to_regprocedure('public.mark_conversation_read(uuid)'),
    to_regprocedure('public.get_my_conversation_summaries(uuid)')
  ])::oid
),
checks(check_name, passed) as (
  values
    (
      'messaging tables retain the required columns and RLS',
      to_regclass('public.conversations') is not null
      and to_regclass('public.messages') is not null
      and (
        select bool_and(relrowsecurity)
        from pg_class
        where oid in (
          'public.conversations'::regclass,
          'public.messages'::regclass
        )
      )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'messages'
          and column_name = 'body'
          and data_type = 'text'
          and is_nullable = 'NO'
      )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'messages'
          and column_name = 'read_at'
          and data_type = 'timestamp with time zone'
          and is_nullable = 'YES'
      )
    ),
    (
      'conversation identity and listing ownership stay constrained',
      exists (
        select 1
        from pg_constraint
        where conrelid = 'public.conversations'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) ilike '%buyer_id <> seller_id%'
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.conversations'::regclass
          and contype = 'f'
          and confrelid = 'public.listings'::regclass
          and pg_get_constraintdef(oid)
            ilike '%foreign key (listing_id, seller_id)%'
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.conversations'::regclass
          and contype = 'u'
          and pg_get_constraintdef(oid)
            ilike '%unique (listing_id, buyer_id)%'
      )
    ),
    (
      'messages cascade with conversations and validate their body',
      exists (
        select 1
        from pg_constraint
        where conrelid = 'public.messages'::regclass
          and contype = 'f'
          and confrelid = 'public.conversations'::regclass
          and confdeltype = 'c'
          and pg_get_constraintdef(oid) ilike '%(conversation_id)%'
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.messages'::regclass
          and contype = 'f'
          and confrelid = 'public.profiles'::regclass
          and pg_get_constraintdef(oid) ilike '%(sender_id)%'
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.messages'::regclass
          and contype = 'c'
          and conname = 'messages_body_check'
          and pg_get_constraintdef(oid) ilike '%char_length(btrim(body))%'
          and pg_get_constraintdef(oid) ilike '%2000%'
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.messages'::regclass
          and contype = 'c'
          and conname = 'messages_body_content_check'
          and convalidated
          and pg_get_constraintdef(oid) ilike '%char_length(body)%'
          and pg_get_constraintdef(oid) ilike '%2000%'
          and pg_get_constraintdef(oid) ilike '%[^[:space:]]%'
      )
    ),
    (
      'latest-message and unread lookups are indexed',
      exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'messages'
          and indexname = 'messages_conversation_latest_idx'
          and indexdef
            ilike '%(conversation_id, created_at desc, id desc)%'
      )
      and exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'messages'
          and indexname = 'messages_conversation_unread_idx'
          and indexdef ilike '%(conversation_id, sender_id)%'
          and indexdef ilike '%where (read_at is null)%'
      )
    ),
    (
      'new messages advance conversation activity in the database',
      exists (
        select 1
        from pg_trigger
        where tgrelid = 'public.messages'::regclass
          and tgname = 'messages_90_touch_conversation'
          and not tgisinternal
          and tgenabled <> 'D'
      )
      and pg_get_functiondef(to_regprocedure(
        'private.touch_conversation_after_message()'
      )) ilike '%update public.conversations%updated_at%new.created_at%'
    ),
    (
      'conversation and message reads remain participant scoped',
      exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'conversations'
          and policyname = 'Conversation reads require an eligible participant'
          and permissive = 'RESTRICTIVE'
          and cmd = 'SELECT'
          and qual ilike '%is_verified_active_student()%'
      )
      and exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'conversations'
          and policyname = 'Participants can read their conversations'
          and cmd = 'SELECT'
          and qual ilike '%buyer_id =%auth.uid()%'
          and qual ilike '%seller_id =%auth.uid()%'
      )
      and exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'messages'
          and policyname = 'Participants can read conversation messages'
          and cmd = 'SELECT'
          and qual ilike '%conversations.buyer_id =%auth.uid()%'
          and qual ilike '%conversations.seller_id =%auth.uid()%'
      )
    ),
    (
      'authenticated messaging tables remain read-only',
      has_table_privilege('authenticated', 'public.conversations', 'SELECT')
      and has_table_privilege('authenticated', 'public.messages', 'SELECT')
      and not has_table_privilege(
        'authenticated', 'public.conversations', 'INSERT'
      )
      and not has_table_privilege(
        'authenticated', 'public.conversations', 'UPDATE'
      )
      and not has_table_privilege(
        'authenticated', 'public.conversations', 'DELETE'
      )
      and not has_table_privilege(
        'authenticated', 'public.messages', 'INSERT'
      )
      and not has_table_privilege(
        'authenticated', 'public.messages', 'UPDATE'
      )
      and not has_table_privilege(
        'authenticated', 'public.messages', 'DELETE'
      )
      and not has_table_privilege('anon', 'public.conversations', 'SELECT')
      and not has_table_privilege('anon', 'public.messages', 'SELECT')
    ),
    (
      'messaging RPCs are security definer and authenticated-only',
      (
        select count(*) = 4
          and bool_and(prosecdef)
          and bool_and(
            coalesce(proconfig, '{}'::text[])
              @> array['search_path=""']::text[]
          )
          and bool_and(
            has_function_privilege('authenticated', pg_proc.oid, 'EXECUTE')
          )
          and bool_and(
            not has_function_privilege('anon', pg_proc.oid, 'EXECUTE')
          )
        from pg_proc
        where oid in (select function_oid from messaging_rpc_oids)
      )
      and not exists (
        select 1
        from messaging_rpc_oids
        join pg_proc on pg_proc.oid = messaging_rpc_oids.function_oid
        cross join lateral aclexplode(
          coalesce(pg_proc.proacl, acldefault('f', pg_proc.proowner))
        ) as function_acl
        where function_acl.grantee = 0
          and function_acl.privilege_type = 'EXECUTE'
      )
    ),
    (
      'mark-read updates only received unread messages',
      pg_get_functiondef(to_regprocedure(
        'public.mark_conversation_read(uuid)'
      )) ilike '%private.is_verified_active_student()%'
      and pg_get_functiondef(to_regprocedure(
        'public.mark_conversation_read(uuid)'
      )) ilike '%conversation.buyer_id = v_user_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.mark_conversation_read(uuid)'
      )) ilike '%conversation.seller_id = v_user_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.mark_conversation_read(uuid)'
      )) ilike '%message.sender_id <> v_user_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.mark_conversation_read(uuid)'
      )) ilike '%message.read_at is null%'
    ),
    (
      'conversation summary has the fixed participant-safe contract',
      pg_get_function_arguments(to_regprocedure(
        'public.get_my_conversation_summaries(uuid)'
      )) ilike 'p_conversation_id uuid default null%'
      and pg_get_function_result(to_regprocedure(
        'public.get_my_conversation_summaries(uuid)'
      )) ilike 'table(conversation_id uuid, listing_id uuid,%'
      and pg_get_function_result(to_regprocedure(
        'public.get_my_conversation_summaries(uuid)'
      )) ilike '%unread_count bigint, created_at timestamp with time zone, updated_at timestamp with time zone, can_send boolean)%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_conversation_summaries(uuid)'
      )) ilike '%private.is_verified_active_student()%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_conversation_summaries(uuid)'
      )) ilike '%conversation.buyer_id = caller.user_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_conversation_summaries(uuid)'
      )) ilike '%conversation.seller_id = caller.user_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_conversation_summaries(uuid)'
      )) ilike '%former uc student%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_conversation_summaries(uuid)'
      )) not ilike '%student_id_number%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_conversation_summaries(uuid)'
      )) not ilike '%document_path%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_conversation_summaries(uuid)'
      )) not ilike '%auth.users%'
    ),
    (
      'messaging status rules remain consistent',
      pg_get_functiondef(to_regprocedure(
        'public.start_listing_conversation(uuid)'
      )) ilike '%available%reserved%'
      and pg_get_functiondef(to_regprocedure(
        'public.start_listing_conversation(uuid)'
      )) ilike '%private.is_marketplace_seller%'
      and pg_get_functiondef(to_regprocedure(
        'public.send_conversation_message(uuid,text)'
      )) ilike '%listing.status <>%removed%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_conversation_summaries(uuid)'
      )) ilike '%available%reserved%sold%can_send%'
    ),
    (
      'messages are enabled for Supabase Realtime',
      exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'messages'
      )
      and exists (
        select 1
        from pg_publication
        where pubname = 'supabase_realtime'
          and pubinsert
          and pubupdate
      )
    )
)
select check_name, coalesce(passed, false) as passed
from checks
union all
select
  '__all_messaging_security_checks_passed__',
  bool_and(coalesce(passed, false))
from checks
order by check_name;
