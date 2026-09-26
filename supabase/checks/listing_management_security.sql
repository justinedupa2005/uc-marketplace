-- Run after 20260926000000_harden_listing_interaction_lifecycle.sql.
-- Every row, including the summary, must report passed = true.

with rpc_oids(function_oid) as (
  select unnest(array[
    to_regprocedure('public.toggle_listing_favorite(uuid)'),
    to_regprocedure('public.start_listing_conversation(uuid)'),
    to_regprocedure('public.send_conversation_message(uuid,text)'),
    to_regprocedure('public.request_listing_reservation(uuid)'),
    to_regprocedure('public.report_listing(uuid,text,text)'),
    to_regprocedure('public.set_owned_listing_status(uuid,text)'),
    to_regprocedure('public.respond_to_listing_reservation(uuid,text)'),
    to_regprocedure('public.cancel_listing_reservation(uuid)'),
    to_regprocedure('public.update_owned_listing(uuid,timestamptz,text,text,uuid,numeric,text,text[])'),
    to_regprocedure('public.discard_listing_draft(uuid)'),
    to_regprocedure('public.get_my_listing_interaction_contexts()')
  ])::oid
),
checks(check_name, passed) as (
  values
    (
      'interaction tables exist with RLS enabled',
      (
        select count(*) = 5 and bool_and(relrowsecurity)
        from pg_class
        join pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'public'
          and pg_class.relname in (
            'favorites', 'conversations', 'messages',
            'reservations', 'listing_reports'
          )
      )
    ),
    (
      'authenticated interaction tables are read-only',
      has_table_privilege('authenticated', 'public.favorites', 'SELECT')
      and has_table_privilege('authenticated', 'public.conversations', 'SELECT')
      and has_table_privilege('authenticated', 'public.messages', 'SELECT')
      and has_table_privilege('authenticated', 'public.reservations', 'SELECT')
      and has_table_privilege('authenticated', 'public.listing_reports', 'SELECT')
      and not has_table_privilege('authenticated', 'public.favorites', 'INSERT')
      and not has_table_privilege('authenticated', 'public.favorites', 'DELETE')
      and not has_table_privilege('authenticated', 'public.conversations', 'INSERT')
      and not has_table_privilege('authenticated', 'public.messages', 'INSERT')
      and not has_table_privilege('authenticated', 'public.reservations', 'INSERT')
      and not has_table_privilege('authenticated', 'public.listing_reports', 'INSERT')
    ),
    (
      'duplicate active interactions are database constrained',
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'reservations_one_active_buyer_request_idx'
          and indexdef ilike '%unique%'
          and indexdef ilike '%pending%accepted%'
      )
      and exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'reservations_one_accepted_listing_idx'
          and indexdef ilike '%unique%'
      )
      and exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'listing_reports_one_active_report_idx'
          and indexdef ilike '%unique%'
      )
    ),
    (
      'interaction RPCs are security definer and auth-only',
      (
        select count(*) = 11
          and bool_and(prosecdef)
          and bool_and(coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[])
          and bool_and(has_function_privilege('authenticated', pg_proc.oid, 'EXECUTE'))
          and bool_and(not has_function_privilege('anon', pg_proc.oid, 'EXECUTE'))
        from pg_proc
        where oid in (select function_oid from rpc_oids)
      )
      and not exists (
        select 1
        from rpc_oids
        join pg_proc on pg_proc.oid = rpc_oids.function_oid
        cross join lateral aclexplode(
          coalesce(pg_proc.proacl, acldefault('f', pg_proc.proowner))
        ) as function_acl
        where function_acl.grantee = 0
          and function_acl.privilege_type = 'EXECUTE'
      )
    ),
    (
      'interaction history context is participant scoped',
      pg_get_functiondef(to_regprocedure(
        'public.get_my_listing_interaction_contexts()'
      )) ilike '%private.is_verified_active_student()%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_listing_interaction_contexts()'
      )) ilike '%conversation.buyer_id =%auth.uid()%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_listing_interaction_contexts()'
      )) ilike '%reservation.seller_id =%auth.uid()%'
    ),
    (
      'lifecycle RPCs serialize listing status decisions',
      pg_get_functiondef(to_regprocedure(
        'public.toggle_listing_favorite(uuid)'
      )) ilike '%for share%'
      and pg_get_functiondef(to_regprocedure(
        'public.start_listing_conversation(uuid)'
      )) ilike '%for share%'
      and pg_get_functiondef(to_regprocedure(
        'public.send_conversation_message(uuid,text)'
      )) ilike '%for share of listing%'
      and pg_get_functiondef(to_regprocedure(
        'public.respond_to_listing_reservation(uuid,text)'
      )) ilike '%from public.listings%for update%from public.reservations%for update%'
    ),
    (
      'published listing and image mutations are RPC-only',
      not has_table_privilege('authenticated', 'public.listings', 'DELETE')
      and not has_table_privilege('authenticated', 'public.listing_images', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.listing_images', 'DELETE')
      and not has_column_privilege('authenticated', 'public.listings', 'title', 'UPDATE')
      and has_table_privilege('authenticated', 'public.listing_images', 'INSERT')
    ),
    (
      'atomic edit validates owner state concurrency and image set',
      pg_get_functiondef(to_regprocedure(
        'public.update_owned_listing(uuid,timestamptz,text,text,uuid,numeric,text,text[])'
      )) ilike '%private.is_verified_active_student()%'
      and pg_get_functiondef(to_regprocedure(
        'public.update_owned_listing(uuid,timestamptz,text,text,uuid,numeric,text,text[])'
      )) ilike '%for update%'
      and pg_get_functiondef(to_regprocedure(
        'public.update_owned_listing(uuid,timestamptz,text,text,uuid,numeric,text,text[])'
      )) ilike '%updated_at <> p_expected_updated_at%'
      and pg_get_functiondef(to_regprocedure(
        'public.update_owned_listing(uuid,timestamptz,text,text,uuid,numeric,text,text[])'
      )) ilike '%cardinality(p_image_paths)%between 1 and 5%'
      and pg_get_functiondef(to_regprocedure(
        'public.update_owned_listing(uuid,timestamptz,text,text,uuid,numeric,text,text[])'
      )) ilike '%p_price < 0%'
    ),
    (
      'report readers exclude listing sellers',
      exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'listing_reports'
          and policyname = 'Reporters and admins can read reports'
          and qual ilike '%reporter_id%auth.uid()%'
          and qual not ilike '%seller_id%auth.uid()%'
      )
    )
)
select check_name, passed from checks
union all
select '__all_listing_management_checks_passed__', bool_and(passed) from checks
order by check_name;
