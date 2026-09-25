-- Run after 20260924000000_complete_listing_creation.sql.
-- Every named row and the final summary row must report passed = true.

with checks(check_name, passed) as (
  values
    (
      'draft is a valid private default listing status',
      coalesce((
        select
          column_default ilike '%draft%'
          and is_nullable = 'NO'
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'listings'
          and column_name = 'status'
      ), false)
      and coalesce((
        select
          pg_get_constraintdef(constraint_record.oid) ilike '%draft%'
          and pg_get_constraintdef(constraint_record.oid) ilike '%available%'
          and pg_get_constraintdef(constraint_record.oid) ilike '%reserved%'
          and pg_get_constraintdef(constraint_record.oid) ilike '%sold%'
          and pg_get_constraintdef(constraint_record.oid) ilike '%removed%'
        from pg_constraint as constraint_record
        where constraint_record.conrelid = 'public.listings'::regclass
          and constraint_record.conname = 'listings_status_check'
          and constraint_record.contype = 'c'
      ), false)
    ),
    (
      'submission token is nullable UUID with seller-scoped uniqueness',
      coalesce((
        select
          data_type = 'uuid'
          and is_nullable = 'YES'
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'listings'
          and column_name = 'submission_token'
      ), false)
      and exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'listings'
          and indexname = 'listings_seller_submission_token_key'
          and indexdef ilike '%unique index%'
          and indexdef ilike '%(seller_id, submission_token)%'
          and indexdef ilike '%submission_token is not null%'
      )
    ),
    (
      'new listing content constraints are present',
      coalesce((
        select
          count(*) = 3
          and bool_and(not constraint_record.convalidated)
          and bool_or(
            constraint_record.conname = 'listings_title_format_check'
            and pg_get_constraintdef(constraint_record.oid) ilike '%btrim(title)%'
            and pg_get_constraintdef(constraint_record.oid) ilike '%char_length(title)%'
            and pg_get_constraintdef(constraint_record.oid) ilike '%100%'
          )
          and bool_or(
            constraint_record.conname = 'listings_description_format_check'
            and pg_get_constraintdef(constraint_record.oid) ilike '%btrim(description)%'
            and pg_get_constraintdef(constraint_record.oid) ilike '%char_length(description)%'
            and pg_get_constraintdef(constraint_record.oid) ilike '%2000%'
          )
          and bool_or(
            constraint_record.conname = 'listings_price_marketplace_range_check'
            and pg_get_constraintdef(constraint_record.oid) ilike '%price >%'
            and pg_get_constraintdef(constraint_record.oid) ilike '%1000000%'
          )
        from pg_constraint as constraint_record
        where constraint_record.conrelid = 'public.listings'::regclass
          and constraint_record.conname in (
            'listings_title_format_check',
            'listings_description_format_check',
            'listings_price_marketplace_range_check'
          )
          and constraint_record.contype = 'c'
      ), false)
    ),
    (
      'authenticated insert privilege is limited to draft input columns',
      has_column_privilege('authenticated', 'public.listings', 'id', 'INSERT')
      and has_column_privilege(
        'authenticated', 'public.listings', 'seller_id', 'INSERT'
      )
      and has_column_privilege(
        'authenticated', 'public.listings', 'category_id', 'INSERT'
      )
      and has_column_privilege(
        'authenticated', 'public.listings', 'title', 'INSERT'
      )
      and has_column_privilege(
        'authenticated', 'public.listings', 'description', 'INSERT'
      )
      and has_column_privilege(
        'authenticated', 'public.listings', 'price', 'INSERT'
      )
      and has_column_privilege(
        'authenticated', 'public.listings', 'condition', 'INSERT'
      )
      and has_column_privilege(
        'authenticated', 'public.listings', 'submission_token', 'INSERT'
      )
      and not has_column_privilege(
        'authenticated', 'public.listings', 'status', 'INSERT'
      )
      and not has_column_privilege(
        'authenticated', 'public.listings', 'created_at', 'INSERT'
      )
      and not has_column_privilege(
        'authenticated', 'public.listings', 'updated_at', 'INSERT'
      )
      and not exists (
        select 1
        from information_schema.column_privileges
        where grantee = 'authenticated'
          and table_schema = 'public'
          and table_name = 'listings'
          and privilege_type = 'INSERT'
          and column_name not in (
            'id',
            'seller_id',
            'category_id',
            'title',
            'description',
            'price',
            'condition',
            'submission_token'
          )
      )
    ),
    (
      'authenticated updates cannot change owner or lifecycle fields',
      has_column_privilege(
        'authenticated', 'public.listings', 'category_id', 'UPDATE'
      )
      and has_column_privilege(
        'authenticated', 'public.listings', 'title', 'UPDATE'
      )
      and has_column_privilege(
        'authenticated', 'public.listings', 'description', 'UPDATE'
      )
      and has_column_privilege(
        'authenticated', 'public.listings', 'price', 'UPDATE'
      )
      and has_column_privilege(
        'authenticated', 'public.listings', 'condition', 'UPDATE'
      )
      and not has_column_privilege(
        'authenticated', 'public.listings', 'id', 'UPDATE'
      )
      and not has_column_privilege(
        'authenticated', 'public.listings', 'seller_id', 'UPDATE'
      )
      and not has_column_privilege(
        'authenticated', 'public.listings', 'status', 'UPDATE'
      )
      and not has_column_privilege(
        'authenticated', 'public.listings', 'submission_token', 'UPDATE'
      )
      and not has_column_privilege(
        'authenticated', 'public.listings', 'created_at', 'UPDATE'
      )
      and not has_column_privilege(
        'authenticated', 'public.listings', 'updated_at', 'UPDATE'
      )
      and not exists (
        select 1
        from information_schema.column_privileges
        where grantee = 'authenticated'
          and table_schema = 'public'
          and table_name = 'listings'
          and privilege_type = 'UPDATE'
          and column_name not in (
            'category_id', 'title', 'description', 'price', 'condition'
          )
      )
    ),
    (
      'listing insert policies admit verified owned drafts only',
      coalesce((
        select
          count(*) = 2
          and bool_and(coalesce(with_check, '') ilike '%auth.uid()%')
          and bool_and(coalesce(with_check, '') ilike '%status =%draft%')
          and bool_and(
            coalesce(with_check, '') ilike '%is_verified_active_student()%'
          )
          and bool_and(coalesce(with_check, '') ilike '%categories.is_active%')
        from pg_policies
        where schemaname = 'public'
          and tablename = 'listings'
          and cmd = 'INSERT'
          and policyname in (
            'Listing creation requires verified ownership',
            'Verified students can create their listings'
          )
      ), false)
    ),
    (
      'publish RPC is hardened and least privileged',
      coalesce((
        select
          procedure_record.prosecdef
          and coalesce(procedure_record.proconfig, '{}'::text[])
            @> array['search_path=""']::text[]
          and procedure_record.prorettype = 'uuid'::regtype
        from pg_proc as procedure_record
        where procedure_record.oid = to_regprocedure(
          'public.publish_listing(uuid)'
        )
      ), false)
      and coalesce(has_function_privilege(
        'authenticated',
        to_regprocedure('public.publish_listing(uuid)'),
        'EXECUTE'
      ), false)
      and not coalesce(has_function_privilege(
        'anon',
        to_regprocedure('public.publish_listing(uuid)'),
        'EXECUTE'
      ), false)
    ),
    (
      'publish RPC validates authorization and complete owned images',
      coalesce(
        pg_get_functiondef(to_regprocedure('public.publish_listing(uuid)'))
          ilike '%private.is_verified_active_student()%'
        and pg_get_functiondef(to_regprocedure('public.publish_listing(uuid)'))
          ilike '%status = ''draft''%'
        and pg_get_functiondef(to_regprocedure('public.publish_listing(uuid)'))
          ilike '%for update%'
        and pg_get_functiondef(to_regprocedure('public.publish_listing(uuid)'))
          ilike '%v_image_count < 1%'
        and pg_get_functiondef(to_regprocedure('public.publish_listing(uuid)'))
          ilike '%v_image_count > 5%'
        and pg_get_functiondef(to_regprocedure('public.publish_listing(uuid)'))
          ilike '%listing_object.owner_id = v_user_id::text%'
        and pg_get_functiondef(to_regprocedure('public.publish_listing(uuid)'))
          ilike '%set status = ''available''%'
      , false)
    ),
    (
      'listing-images bucket remains private and constrained',
      coalesce((
        select
          not public
          and file_size_limit = 5242880
          and allowed_mime_types @> array[
            'image/jpeg', 'image/png', 'image/webp'
          ]::text[]
          and cardinality(allowed_mime_types) = 3
        from storage.buckets
        where id = 'listing-images'
      ), false)
    ),
    (
      'Storage mutation helper accepts owned non-removed drafts',
      coalesce(
        pg_get_functiondef(to_regprocedure(
          'private.can_manage_listing_image_object(text,text)'
        )) ilike '%status <> ''removed''%'
      , false)
    )
)
select check_name, passed
from checks

union all

select '__all_listing_creation_checks_passed__', bool_and(passed)
from checks

order by check_name;
