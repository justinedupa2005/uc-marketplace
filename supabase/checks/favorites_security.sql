-- Run after 20260926030000_complete_favorites.sql.
-- Every row, including the summary, must report passed = true.

with favorite_rpc_oids(function_oid) as (
  select unnest(array[
    to_regprocedure('public.set_listing_favorite(uuid,boolean)'),
    to_regprocedure('public.toggle_listing_favorite(uuid)')
  ])::oid
),
checks(check_name, passed) as (
  values
    (
      'favorites has the required columns and default',
      to_regclass('public.favorites') is not null
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'favorites'
          and column_name = 'user_id'
          and data_type = 'uuid'
          and is_nullable = 'NO'
      )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'favorites'
          and column_name = 'listing_id'
          and data_type = 'uuid'
          and is_nullable = 'NO'
      )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'favorites'
          and column_name = 'created_at'
          and data_type = 'timestamp with time zone'
          and is_nullable = 'NO'
          and column_default ilike '%now()%'
      )
    ),
    (
      'favorite ownership and listing references cascade safely',
      exists (
        select 1
        from pg_constraint
        where conrelid = 'public.favorites'::regclass
          and contype = 'f'
          and confrelid = 'public.profiles'::regclass
          and confdeltype = 'c'
          and pg_get_constraintdef(oid) ilike '%(user_id)%'
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.profiles'::regclass
          and contype = 'f'
          and confrelid = 'auth.users'::regclass
          and confdeltype = 'c'
          and pg_get_constraintdef(oid) ilike '%(id)%'
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.favorites'::regclass
          and contype = 'f'
          and confrelid = 'public.listings'::regclass
          and confdeltype = 'c'
          and pg_get_constraintdef(oid) ilike '%(listing_id)%'
      )
    ),
    (
      'duplicate favorites are database constrained',
      exists (
        select 1
        from pg_constraint
        where conrelid = 'public.favorites'::regclass
          and contype in ('p', 'u')
          and pg_get_constraintdef(oid) ilike '%(user_id, listing_id)%'
      )
    ),
    (
      'favorites newest-first lookup is indexed',
      exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'favorites'
          and indexname = 'favorites_user_created_at_idx'
          and indexdef ilike '%(user_id, created_at desc, listing_id desc)%'
      )
    ),
    (
      'favorites RLS is enabled with only the intended policies',
      (
        select relrowsecurity
        from pg_class
        where oid = 'public.favorites'::regclass
      )
      and (
        select count(*) = 4
        from pg_policies
        where schemaname = 'public'
          and tablename = 'favorites'
      )
      and exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'favorites'
          and policyname = 'Favorite access requires an eligible student'
          and permissive = 'RESTRICTIVE'
          and cmd = 'ALL'
          and qual ilike '%is_verified_active_student()%'
          and with_check ilike '%is_verified_active_student()%'
      )
      and not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'favorites'
          and cmd = 'UPDATE'
      )
    ),
    (
      'favorite row policies enforce ownership and eligible listings',
      exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'favorites'
          and policyname = 'Students can read their favorites'
          and cmd = 'SELECT'
          and qual ilike '%user_id =%auth.uid()%'
      )
      and exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'favorites'
          and policyname = 'Students can add eligible marketplace favorites'
          and cmd = 'INSERT'
          and with_check ilike '%user_id =%auth.uid()%'
          and with_check ilike '%seller_id <>%auth.uid()%'
          and with_check ilike '%available%reserved%'
          and with_check ilike '%is_marketplace_seller%'
      )
      and exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'favorites'
          and policyname = 'Students can remove their favorites'
          and cmd = 'DELETE'
          and qual ilike '%user_id =%auth.uid()%'
      )
    ),
    (
      'favorite table grants are read-only and authenticated-only',
      has_table_privilege('authenticated', 'public.favorites', 'SELECT')
      and not has_table_privilege('authenticated', 'public.favorites', 'INSERT')
      and not has_table_privilege('authenticated', 'public.favorites', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.favorites', 'DELETE')
      and not has_table_privilege('anon', 'public.favorites', 'SELECT')
      and not has_table_privilege('anon', 'public.favorites', 'INSERT')
      and not has_table_privilege('anon', 'public.favorites', 'UPDATE')
      and not has_table_privilege('anon', 'public.favorites', 'DELETE')
    ),
    (
      'favorite RPCs are security definer and authenticated-only',
      (
        select count(*) = 2
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
        where oid in (select function_oid from favorite_rpc_oids)
      )
      and not exists (
        select 1
        from favorite_rpc_oids
        join pg_proc on pg_proc.oid = favorite_rpc_oids.function_oid
        cross join lateral aclexplode(
          coalesce(pg_proc.proacl, acldefault('f', pg_proc.proowner))
        ) as function_acl
        where function_acl.grantee = 0
          and function_acl.privilege_type = 'EXECUTE'
      )
    ),
    (
      'explicit favorite state is authenticated validated and idempotent',
      pg_get_function_arguments(to_regprocedure(
        'public.set_listing_favorite(uuid,boolean)'
      )) = 'p_listing_id uuid, p_should_favorite boolean'
      and pg_get_functiondef(to_regprocedure(
        'public.set_listing_favorite(uuid,boolean)'
      )) ilike '%auth.uid()%'
      and pg_get_functiondef(to_regprocedure(
        'public.set_listing_favorite(uuid,boolean)'
      )) ilike '%private.is_verified_active_student()%'
      and pg_get_functiondef(to_regprocedure(
        'public.set_listing_favorite(uuid,boolean)'
      )) ilike '%for share%'
      and pg_get_functiondef(to_regprocedure(
        'public.set_listing_favorite(uuid,boolean)'
      )) ilike '%seller_id = v_user_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.set_listing_favorite(uuid,boolean)'
      )) ilike '%available%reserved%'
      and pg_get_functiondef(to_regprocedure(
        'public.set_listing_favorite(uuid,boolean)'
      )) ilike '%private.is_marketplace_seller%'
      and pg_get_functiondef(to_regprocedure(
        'public.set_listing_favorite(uuid,boolean)'
      )) ilike '%on conflict (user_id, listing_id) do nothing%'
    ),
    (
      'legacy toggle uses listing-first lock order',
      position(
        'for share' in lower(pg_get_functiondef(to_regprocedure(
          'public.toggle_listing_favorite(uuid)'
        )))
      ) > 0
      and position(
        'for share' in lower(pg_get_functiondef(to_regprocedure(
          'public.toggle_listing_favorite(uuid)'
        )))
      ) < position(
        'delete from public.favorites' in lower(pg_get_functiondef(
          to_regprocedure('public.toggle_listing_favorite(uuid)')
        ))
      )
    ),
    (
      'sold and removed lifecycle operations clean favorites',
      pg_get_functiondef(to_regprocedure(
        'public.set_owned_listing_status(uuid,text)'
      )) ilike '%delete from public.favorites where listing_id = p_listing_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.admin_remove_listing(uuid)'
      )) ilike '%delete from public.favorites where listing_id = p_listing_id%'
    )
)
select check_name, passed
from checks
union all
select
  '__all_favorites_security_checks_passed__',
  bool_and(passed)
from checks
order by check_name;
