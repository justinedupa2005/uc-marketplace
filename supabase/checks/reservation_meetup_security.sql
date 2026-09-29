-- Run after 20260928000000_complete_reservations_and_meetups.sql.
-- Every row, including the summary, must report passed = true.

with reservation_rpc_oids(function_oid) as (
  select unnest(array[
    to_regprocedure('public.request_reservation(uuid,text)'),
    to_regprocedure('public.accept_reservation(uuid)'),
    to_regprocedure('public.reject_reservation(uuid)'),
    to_regprocedure('public.cancel_reservation(uuid)'),
    to_regprocedure('public.upsert_meetup(uuid,text,text,timestamptz,text,timestamptz)'),
    to_regprocedure('public.complete_sale(uuid)'),
    to_regprocedure('public.start_reservation_conversation(uuid)'),
    to_regprocedure('public.get_my_reservation_summaries(uuid)')
  ])::oid
),
checks(check_name, passed) as (
  values
    (
      'reservation history columns and meetups table exist with RLS',
      to_regclass('public.reservations') is not null
      and to_regclass('public.meetups') is not null
      and (
        select bool_and(relrowsecurity)
        from pg_class
        where oid in (
          'public.reservations'::regclass,
          'public.meetups'::regclass
        )
      )
      and (
        select count(*) = 4
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservations'
          and column_name in (
            'message', 'responded_at', 'cancelled_at', 'completed_at'
          )
      )
      and (
        select count(*) = 14
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'meetups'
          and column_name in (
            'id', 'reservation_id', 'listing_id', 'buyer_id', 'seller_id',
            'status', 'location_name', 'location_details', 'scheduled_at',
            'notes', 'created_at', 'updated_at', 'cancelled_at',
            'completed_at'
          )
      )
    ),
    (
      'participant deletion cannot erase listing or reservation history',
      exists (
        select 1
        from pg_constraint
        where conrelid = 'public.listings'::regclass
          and conname = 'listings_seller_id_fkey'
          and contype = 'f'
          and confrelid = 'auth.users'::regclass
          and confdeltype = 'r'
          and convalidated
      )
      and (
        select count(*) = 2
          and bool_and(confdeltype = 'r' and convalidated)
        from pg_constraint
        where conrelid = 'public.reservations'::regclass
          and conname in (
            'reservations_buyer_id_fkey', 'reservations_seller_id_fkey'
          )
          and contype = 'f'
          and confrelid = 'public.profiles'::regclass
      )
    ),
    (
      'reservation text and transition timestamps are constrained',
      exists (
        select 1
        from pg_constraint
        where conrelid = 'public.reservations'::regclass
          and conname = 'reservations_message_check'
          and contype = 'c'
          and convalidated
          and pg_get_constraintdef(oid) ilike '%500%'
          and pg_get_constraintdef(oid) ilike '%[^[:space:]]%'
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.reservations'::regclass
          and conname = 'reservations_response_timestamp_check'
          and convalidated
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.reservations'::regclass
          and conname = 'reservations_cancelled_timestamp_check'
          and convalidated
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.reservations'::regclass
          and conname = 'reservations_completed_timestamp_check'
          and convalidated
      )
    ),
    (
      'meetup identity, one-per-reservation, fields, and statuses are constrained',
      exists (
        select 1
        from pg_constraint
        where conrelid = 'public.meetups'::regclass
          and conname = 'meetups_reservation_key'
          and contype = 'u'
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.meetups'::regclass
          and conname = 'meetups_reservation_context_fkey'
          and contype = 'f'
          and confrelid = 'public.reservations'::regclass
          and confdeltype = 'c'
          and pg_get_constraintdef(oid)
            ilike '%reservation_id, listing_id, buyer_id, seller_id%'
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.meetups'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid)
            ilike '%proposed%scheduled%cancelled%completed%'
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.meetups'::regclass
          and conname = 'meetups_location_name_check'
          and pg_get_constraintdef(oid) ilike '%120%'
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.meetups'::regclass
          and conname = 'meetups_location_details_check'
          and pg_get_constraintdef(oid) ilike '%300%'
      )
      and exists (
        select 1
        from pg_constraint
        where conrelid = 'public.meetups'::regclass
          and conname = 'meetups_notes_check'
          and pg_get_constraintdef(oid) ilike '%500%'
      )
    ),
    (
      'reservation and meetup query paths are indexed',
      exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and indexname = 'reservations_one_active_buyer_request_idx'
          and indexdef ilike '%unique%'
          and indexdef ilike '%pending%accepted%'
      )
      and exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and indexname = 'reservations_one_accepted_listing_idx'
          and indexdef ilike '%unique%'
          and indexdef ilike '%accepted%'
      )
      and exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and indexname = 'meetups_buyer_status_scheduled_idx'
          and indexdef ilike '%buyer_id, status, scheduled_at%'
      )
      and exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and indexname = 'meetups_seller_status_scheduled_idx'
          and indexdef ilike '%seller_id, status, scheduled_at%'
      )
    ),
    (
      'reservation and meetup updated-at triggers are enabled',
      (
        select count(*) = 2 and bool_and(tgenabled <> 'D')
        from pg_trigger
        where not tgisinternal
          and (
            (tgrelid = 'public.reservations'::regclass
              and tgname = 'reservations_90_set_updated_at')
            or (tgrelid = 'public.meetups'::regclass
              and tgname = 'meetups_90_set_updated_at')
          )
      )
    ),
    (
      'meetup concurrency token advances with a private locked-search-path trigger',
      exists (
        select 1
        from pg_trigger
        where tgrelid = 'public.meetups'::regclass
          and tgname = 'meetups_90_set_updated_at'
          and tgenabled <> 'D'
          and not tgisinternal
          and tgfoid = to_regprocedure('private.set_meetup_updated_at()')
      )
      and exists (
        select 1
        from pg_proc
        where oid = to_regprocedure('private.set_meetup_updated_at()')
          and coalesce(proconfig, '{}'::text[])
            @> array['search_path=""']::text[]
          and pg_get_functiondef(oid) ilike '%clock_timestamp()%'
          and pg_get_functiondef(oid)
            ilike '%old.updated_at + interval ''1 microsecond''%'
      )
      and not has_function_privilege(
        'authenticated', 'private.set_meetup_updated_at()', 'EXECUTE'
      )
      and not has_function_privilege(
        'anon', 'private.set_meetup_updated_at()', 'EXECUTE'
      )
      and not exists (
        select 1
        from pg_proc
        cross join lateral aclexplode(
          coalesce(pg_proc.proacl, acldefault('f', pg_proc.proowner))
        ) as function_acl
        where pg_proc.oid = to_regprocedure('private.set_meetup_updated_at()')
          and function_acl.grantee = 0
          and function_acl.privilege_type = 'EXECUTE'
      )
    ),
    (
      'reservation and meetup tables are participant-read-only',
      has_table_privilege('authenticated', 'public.reservations', 'SELECT')
      and has_table_privilege('authenticated', 'public.meetups', 'SELECT')
      and not has_table_privilege(
        'authenticated', 'public.reservations', 'INSERT'
      )
      and not has_table_privilege(
        'authenticated', 'public.reservations', 'UPDATE'
      )
      and not has_table_privilege(
        'authenticated', 'public.reservations', 'DELETE'
      )
      and not has_table_privilege(
        'authenticated', 'public.meetups', 'INSERT'
      )
      and not has_table_privilege(
        'authenticated', 'public.meetups', 'UPDATE'
      )
      and not has_table_privilege(
        'authenticated', 'public.meetups', 'DELETE'
      )
      and not has_table_privilege('anon', 'public.reservations', 'SELECT')
      and not has_table_privilege('anon', 'public.meetups', 'SELECT')
      and not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename in ('reservations', 'meetups')
          and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      )
    ),
    (
      'meetup reads require eligibility and participation',
      exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'meetups'
          and policyname = 'Meetup reads require an eligible student'
          and permissive = 'RESTRICTIVE'
          and cmd = 'SELECT'
          and qual ilike '%is_verified_active_student()%'
      )
      and exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'meetups'
          and policyname = 'Participants can read their meetups'
          and cmd = 'SELECT'
          and qual ilike '%buyer_id =%auth.uid()%'
          and qual ilike '%seller_id =%auth.uid()%'
      )
    ),
    (
      'canonical reservation RPCs are security-definer and authenticated-only',
      (
        select count(*) = 8
          and bool_and(prosecdef)
          and bool_and(
            coalesce(proconfig, '{}'::text[])
              @> array['search_path=""']::text[]
          )
          and bool_and(
            pg_get_functiondef(pg_proc.oid)
              ilike '%private.is_verified_active_student()%'
          )
          and bool_and(
            has_function_privilege('authenticated', pg_proc.oid, 'EXECUTE')
          )
          and bool_and(
            not has_function_privilege('anon', pg_proc.oid, 'EXECUTE')
          )
        from pg_proc
        where oid in (select function_oid from reservation_rpc_oids)
      )
      and not exists (
        select 1
        from reservation_rpc_oids
        join pg_proc on pg_proc.oid = reservation_rpc_oids.function_oid
        cross join lateral aclexplode(
          coalesce(pg_proc.proacl, acldefault('f', pg_proc.proowner))
        ) as function_acl
        where function_acl.grantee = 0
          and function_acl.privilege_type = 'EXECUTE'
      )
    ),
    (
      'request RPC derives participants and validates live availability',
      pg_get_function_arguments(to_regprocedure(
        'public.request_reservation(uuid,text)'
      )) ilike 'p_listing_id uuid, p_message text default null%'
      and pg_get_function_result(to_regprocedure(
        'public.request_reservation(uuid,text)'
      )) = 'uuid'
      and pg_get_functiondef(to_regprocedure(
        'public.request_reservation(uuid,text)'
      )) ilike '%private.is_verified_active_student()%'
      and pg_get_functiondef(to_regprocedure(
        'public.request_reservation(uuid,text)'
      )) ilike '%from public.listings%for update%'
      and pg_get_functiondef(to_regprocedure(
        'public.request_reservation(uuid,text)'
      )) ilike '%v_listing.seller_id = v_user_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.request_reservation(uuid,text)'
      )) ilike '%values%v_user_id%v_listing.seller_id%v_message%'
    ),
    (
      'acceptance is listing-lock-first and performs every state change',
      pg_get_functiondef(to_regprocedure(
        'public.accept_reservation(uuid)'
      )) ilike '%from public.listings%for update%from public.reservations%for update%'
      and pg_get_functiondef(to_regprocedure(
        'public.accept_reservation(uuid)'
      )) ilike '%status = ''accepted''%responded_at = now()%'
      and pg_get_functiondef(to_regprocedure(
        'public.accept_reservation(uuid)'
      )) ilike '%update public.listings%status = ''reserved''%'
      and pg_get_functiondef(to_regprocedure(
        'public.accept_reservation(uuid)'
      )) ilike '%id <> p_reservation_id%status = ''pending''%'
      and pg_get_functiondef(to_regprocedure(
        'public.accept_reservation(uuid)'
      )) ilike '%private.is_marketplace_seller(v_reservation.buyer_id)%'
    ),
    (
      'cancellation restores accepted listings and cancels active meetups',
      pg_get_functiondef(to_regprocedure(
        'public.cancel_reservation(uuid)'
      )) ilike '%from public.listings%for update%from public.reservations%for update%from public.meetups%for update%'
      and pg_get_functiondef(to_regprocedure(
        'public.cancel_reservation(uuid)'
      )) ilike '%v_reservation.status = ''pending''%v_reservation.buyer_id <> v_user_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.cancel_reservation(uuid)'
      )) ilike '%update public.meetups%status = ''cancelled''%'
      and pg_get_functiondef(to_regprocedure(
        'public.cancel_reservation(uuid)'
      )) ilike '%update public.listings%status = ''available''%'
    ),
    (
      'meetup upsert derives context and protects terminal rows and stale edits',
      pg_get_functiondef(to_regprocedure(
        'public.upsert_meetup(uuid,text,text,timestamptz,text,timestamptz)'
      )) ilike '%v_reservation.status <> ''accepted''%'
      and pg_get_functiondef(to_regprocedure(
        'public.upsert_meetup(uuid,text,text,timestamptz,text,timestamptz)'
      )) ilike '%v_listing.status <> ''reserved''%'
      and pg_get_functiondef(to_regprocedure(
        'public.upsert_meetup(uuid,text,text,timestamptz,text,timestamptz)'
      )) ilike '%v_reservation.listing_id%v_reservation.buyer_id%v_reservation.seller_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.upsert_meetup(uuid,text,text,timestamptz,text,timestamptz)'
      )) ilike '%v_meetup.status not in (''proposed'', ''scheduled'')%'
      and pg_get_functiondef(to_regprocedure(
        'public.upsert_meetup(uuid,text,text,timestamptz,text,timestamptz)'
      )) ilike '%interval ''5 minutes''%'
      and pg_get_functiondef(to_regprocedure(
        'public.upsert_meetup(uuid,text,text,timestamptz,text,timestamptz)'
      )) ilike '%interval ''1 year''%'
      and pg_get_function_arguments(to_regprocedure(
        'public.upsert_meetup(uuid,text,text,timestamptz,text,timestamptz)'
      )) ilike '%p_expected_updated_at timestamp with time zone default null%'
      and pg_get_functiondef(to_regprocedure(
        'public.upsert_meetup(uuid,text,text,timestamptz,text,timestamptz)'
      )) ilike '%p_expected_updated_at is null%p_expected_updated_at <> v_meetup.updated_at%'
      and pg_get_functiondef(to_regprocedure(
        'public.upsert_meetup(uuid,text,text,timestamptz,text,timestamptz)'
      )) ilike '%if not found and p_expected_updated_at is not null%'
      and pg_get_functiondef(to_regprocedure(
        'public.upsert_meetup(uuid,text,text,timestamptz,text,timestamptz)'
      )) ilike '%errcode = ''40001''%'
    ),
    (
      'sale completion is seller-only and atomically closes all three records',
      pg_get_functiondef(to_regprocedure(
        'public.complete_sale(uuid)'
      )) ilike '%reservation.seller_id = v_user_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.complete_sale(uuid)'
      )) ilike '%from public.listings%for update%from public.reservations%for update%from public.meetups%for update%'
      and pg_get_functiondef(to_regprocedure(
        'public.complete_sale(uuid)'
      )) ilike '%update public.meetups%status = ''completed''%completed_at = now()%'
      and pg_get_functiondef(to_regprocedure(
        'public.complete_sale(uuid)'
      )) ilike '%update public.reservations%status = ''completed''%'
      and pg_get_functiondef(to_regprocedure(
        'public.complete_sale(uuid)'
      )) ilike '%update public.listings%status = ''sold''%'
      and pg_get_functiondef(to_regprocedure(
        'public.complete_sale(uuid)'
      )) not ilike '%delete from public.favorites%'
    ),
    (
      'legacy seller status RPC cannot bypass reservation completion',
      pg_get_functiondef(to_regprocedure(
        'public.set_owned_listing_status(uuid,text)'
      )) ilike '%p_status is distinct from ''removed''%'
      and pg_get_functiondef(to_regprocedure(
        'public.set_owned_listing_status(uuid,text)'
      )) ilike '%use the accepted reservation to complete a sale%'
      and pg_get_functiondef(to_regprocedure(
        'public.set_owned_listing_status(uuid,text)'
      )) ilike '%update public.meetups%status = ''cancelled''%'
    ),
    (
      'sold favorites remain private readable history for their owner',
      exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'listings'
          and policyname = 'Students can read their favorited sold listings'
          and cmd = 'SELECT'
          and qual ilike '%can_read_favorited_sold_listing%'
      )
      and exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'listing_images'
          and policyname = 'Students can read favorited sold listing images'
          and cmd = 'SELECT'
          and qual ilike '%can_read_favorited_sold_listing%'
      )
      and pg_get_functiondef(to_regprocedure(
        'private.can_read_favorited_sold_listing(uuid)'
      )) ilike '%favorite.user_id =%auth.uid()%'
      and pg_get_functiondef(to_regprocedure(
        'private.can_read_favorited_sold_listing(uuid)'
      )) ilike '%listing.status = ''sold''%'
      and pg_get_functiondef(to_regprocedure(
        'private.can_read_favorited_sold_listing(uuid)'
      )) ilike '%private.is_verified_active_student()%'
      and pg_get_functiondef(to_regprocedure(
        'private.can_read_favorited_sold_listing(uuid)'
      )) not ilike '%private.is_marketplace_seller(listing.seller_id)%'
      and has_function_privilege(
        'authenticated',
        'private.can_read_favorited_sold_listing(uuid)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'anon',
        'private.can_read_favorited_sold_listing(uuid)',
        'EXECUTE'
      )
    ),
    (
      'reservation conversation derives the fixed participant tuple',
      pg_get_functiondef(to_regprocedure(
        'public.start_reservation_conversation(uuid)'
      )) ilike '%reservation.buyer_id = v_user_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.start_reservation_conversation(uuid)'
      )) ilike '%reservation.seller_id = v_user_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.start_reservation_conversation(uuid)'
      )) ilike '%values%v_reservation.listing_id%v_reservation.buyer_id%v_reservation.seller_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.start_reservation_conversation(uuid)'
      )) ilike '%on conflict (listing_id, buyer_id) do nothing%'
    ),
    (
      'reservation summary exposes the fixed participant-safe contract',
      pg_get_function_arguments(to_regprocedure(
        'public.get_my_reservation_summaries(uuid)'
      )) ilike 'p_reservation_id uuid default null%'
      and pg_get_function_result(to_regprocedure(
        'public.get_my_reservation_summaries(uuid)'
      )) ilike 'table(reservation_id uuid, listing_id uuid, listing_title text,%'
      and pg_get_function_result(to_regprocedure(
        'public.get_my_reservation_summaries(uuid)'
      )) ilike '%reservation_updated_at timestamp with time zone,%'
      and pg_get_function_result(to_regprocedure(
        'public.get_my_reservation_summaries(uuid)'
      )) ilike '%meetup_completed_at timestamp with time zone)%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_reservation_summaries(uuid)'
      )) ilike '%reservation.buyer_id = caller.user_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_reservation_summaries(uuid)'
      )) ilike '%reservation.seller_id = caller.user_id%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_reservation_summaries(uuid)'
      )) ilike '%former uc student%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_reservation_summaries(uuid)'
      )) not ilike '%student_id_number%'
      and pg_get_functiondef(to_regprocedure(
        'public.get_my_reservation_summaries(uuid)'
      )) not ilike '%auth.users%'
    ),
    (
      'historical image delivery remains path-valid and participant-scoped',
      pg_get_functiondef(to_regprocedure(
        'private.can_read_listing_image_object(text,text)'
      )) ilike '%private.is_verified_active_student()%'
      and pg_get_functiondef(to_regprocedure(
        'private.can_read_listing_image_object(text,text)'
      )) ilike '%listing_image.storage_path = p_name%'
      and pg_get_functiondef(to_regprocedure(
        'private.can_read_listing_image_object(text,text)'
      )) ilike '%conversation.buyer_id =%auth.uid()%'
      and pg_get_functiondef(to_regprocedure(
        'private.can_read_listing_image_object(text,text)'
      )) ilike '%reservation.buyer_id =%auth.uid()%'
      and pg_get_functiondef(to_regprocedure(
        'private.can_read_listing_image_object(text,text)'
      )) ilike '%can_read_favorited_sold_listing(listing.id)%'
      and pg_get_functiondef(to_regprocedure(
        'private.can_read_listing_image_object(text,text)'
      )) ilike '%p_owner_id = listing.seller_id::text%'
    )
)
select check_name, coalesce(passed, false) as passed
from checks
union all
select
  '__all_reservation_meetup_security_checks_passed__',
  bool_and(coalesce(passed, false))
from checks
order by check_name;
