-- Run after 20260926020000_optimize_marketplace_browsing.sql.
-- Every row, including the summary, must report passed = true.

with expected_indexes(index_name) as (
  values
    ('listings_marketplace_newest_idx'),
    ('listings_marketplace_category_newest_idx'),
    ('listings_marketplace_condition_newest_idx'),
    ('listings_marketplace_price_asc_idx')
),
browse_indexes as (
  select
    expected_indexes.index_name,
    pg_index.indisvalid,
    pg_index.indisready,
    pg_get_expr(pg_index.indpred, pg_index.indrelid) as predicate
  from expected_indexes
  left join pg_class as index_class
    on index_class.relname = expected_indexes.index_name
    and index_class.relnamespace = 'public'::regnamespace
  left join pg_index
    on pg_index.indexrelid = index_class.oid
    and pg_index.indrelid = 'public.listings'::regclass
),
checks(check_name, passed) as (
  values
    (
      'search text is a stored generated column',
      coalesce((
        select
          data_type = 'text'
          and is_generated = 'ALWAYS'
          and generation_expression ilike '%title%'
          and generation_expression ilike '%description%'
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'listings'
          and column_name = 'search_text'
      ), false)
    ),
    (
      'marketplace browse indexes are present and ready',
      (
        select count(*) = 4
          and bool_and(indisvalid)
          and bool_and(indisready)
        from browse_indexes
        where indisvalid is not null
      )
    ),
    (
      'marketplace browse indexes contain only visible statuses',
      (
        select count(*) = 4
          and bool_and(predicate ilike '%available%')
          and bool_and(predicate ilike '%reserved%')
          and bool_and(predicate not ilike '%sold%')
          and bool_and(predicate not ilike '%removed%')
          and bool_and(predicate not ilike '%draft%')
        from browse_indexes
        where predicate is not null
      )
    ),
    (
      'category slugs remain uniquely indexed',
      exists (
        select 1
        from pg_index
        join pg_class as table_class
          on table_class.oid = pg_index.indrelid
        join pg_namespace as table_namespace
          on table_namespace.oid = table_class.relnamespace
        where table_namespace.nspname = 'public'
          and table_class.relname = 'categories'
          and pg_index.indisunique
          and pg_index.indisvalid
          and pg_get_indexdef(pg_index.indexrelid) ilike '%(slug)%'
      )
    ),
    (
      'listing browse RLS remains enabled and restrictive',
      coalesce((
        select relrowsecurity
        from pg_class
        join pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'public'
          and pg_class.relname = 'listings'
      ), false)
      and exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'listings'
          and policyname = 'Marketplace listing reads require authorized account'
          and permissive = 'RESTRICTIVE'
          and qual ilike '%private.is_verified_active_student()%'
          and qual ilike '%available%'
          and qual ilike '%reserved%'
          and qual ilike '%private.is_marketplace_seller(seller_id)%'
      )
    ),
    (
      'anonymous users cannot read marketplace catalog tables',
      not has_table_privilege('anon', 'public.listings', 'SELECT')
      and not has_table_privilege('anon', 'public.listing_images', 'SELECT')
      and not has_table_privilege('anon', 'public.categories', 'SELECT')
    )
)
select check_name, passed from checks
union all
select '__all_marketplace_browse_checks_passed__', bool_and(passed) from checks
order by check_name;
