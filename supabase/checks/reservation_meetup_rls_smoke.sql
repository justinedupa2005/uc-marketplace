-- Self-contained transactional Step 11 RPC/RLS matrix.
-- Fixtures are removed before commit. The final row must report all_passed.

begin;

create temporary table step11_subjects (
  label text primary key,
  id uuid not null unique,
  verification_status text not null,
  account_status text not null
);

insert into step11_subjects values
  ('seller', gen_random_uuid(), 'verified', 'active'),
  ('buyer', gen_random_uuid(), 'verified', 'active'),
  ('buyer_two', gen_random_uuid(), 'verified', 'active'),
  ('outsider', gen_random_uuid(), 'verified', 'active'),
  ('pending', gen_random_uuid(), 'pending', 'active'),
  ('suspended', gen_random_uuid(), 'verified', 'suspended');

create temporary table step11_resources (
  label text primary key,
  id uuid not null unique
);

insert into step11_resources values
  ('category', gen_random_uuid()),
  ('listing_complete', gen_random_uuid()),
  ('listing_cancel', gen_random_uuid()),
  ('listing_pending_cancel', gen_random_uuid());

create temporary table step11_runtime (
  label text primary key,
  id uuid not null unique
);

create temporary table step11_results (
  scenario text primary key,
  passed boolean not null,
  observed text not null
);

create temporary table step11_meetup_versions (
  label text primary key,
  updated_at timestamptz not null
);

grant select on pg_temp.step11_subjects to anon, authenticated;
grant select on pg_temp.step11_resources to anon, authenticated;
grant select, insert on pg_temp.step11_runtime to authenticated;
grant select, insert on pg_temp.step11_results to anon, authenticated;
grant select, insert on pg_temp.step11_meetup_versions to authenticated;

create or replace function pg_temp.step11_expect_rejected(
  p_scenario text,
  p_statement text,
  p_expected_state text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  begin
    execute p_statement;
    insert into pg_temp.step11_results values (
      p_scenario,
      false,
      'operation unexpectedly succeeded'
    );
  exception when others then
    insert into pg_temp.step11_results values (
      p_scenario,
      sqlstate = p_expected_state,
      'SQLSTATE ' || sqlstate
    );
  end;
end;
$$;

grant execute on function pg_temp.step11_expect_rejected(text, text, text)
  to anon, authenticated;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  id,
  'authenticated',
  'authenticated',
  label || '+' || replace(id::text, '-', '') || '@example.invalid',
  crypt(gen_random_uuid()::text, gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
from pg_temp.step11_subjects;

insert into public.profiles (
  id, full_name, student_id_number, course, year_level, avatar_path,
  role, verification_status, account_status
)
select
  id,
  'Step Eleven ' || replace(label, '_', ' '),
  'STEP11-' || upper(left(replace(id::text, '-', ''), 12)),
  'BSCS',
  1,
  id::text || '/avatar.png',
  'student',
  verification_status,
  account_status
from pg_temp.step11_subjects
on conflict (id) do update set
  full_name = excluded.full_name,
  student_id_number = excluded.student_id_number,
  course = excluded.course,
  year_level = excluded.year_level,
  avatar_path = excluded.avatar_path,
  role = excluded.role,
  verification_status = excluded.verification_status,
  account_status = excluded.account_status;

insert into public.categories (id, name, slug, is_active)
select
  id,
  'Step 11 Reservations ' || left(replace(id::text, '-', ''), 12),
  'step-11-reservations-' || id::text,
  true
from pg_temp.step11_resources
where label = 'category';

insert into public.listings (
  id, seller_id, category_id, title, description,
  price, condition, status, created_at, updated_at
)
select
  resource.id,
  (select id from pg_temp.step11_subjects where label = 'seller'),
  (select id from pg_temp.step11_resources where label = 'category'),
  'Step 11 ' || replace(resource.label, '_', ' '),
  'Disposable listing used by the reservation and meetup security matrix.',
  case
    when resource.label = 'listing_complete' then 700
    when resource.label = 'listing_cancel' then 650
    else 500
  end,
  'good',
  'available',
  now() - interval '2 hours',
  now() - interval '2 hours'
from pg_temp.step11_resources as resource
where resource.label like 'listing_%';

insert into public.listing_images (
  listing_id, storage_path, is_cover, sort_order
)
select
  listing.id,
  listing.seller_id::text || '/' || listing.id::text || '/'
    || gen_random_uuid()::text || '.jpg',
  true,
  0
from public.listings as listing
where listing.id in (
  select id
  from pg_temp.step11_resources
  where label like 'listing_%'
);

-- Buyer creates a trimmed request, favorites the item, and cannot forge a
-- direct status change or create a duplicate active request.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'buyer'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select public.set_listing_favorite(
  (select id from pg_temp.step11_resources where label = 'listing_complete'),
  true
);

insert into pg_temp.step11_runtime (label, id)
select
  'complete_buyer_reservation',
  public.request_reservation(
    (select id from pg_temp.step11_resources where label = 'listing_complete'),
    E'  Can we meet after class?  \n'
  );

insert into pg_temp.step11_results
select
  'buyer request derives identity and trims its optional message',
  reservation.buyer_id = (
    select id from pg_temp.step11_subjects where label = 'buyer'
  )
    and reservation.seller_id = (
      select id from pg_temp.step11_subjects where label = 'seller'
    )
    and reservation.status = 'pending'
    and reservation.message = 'Can we meet after class?'
    and reservation.responded_at is null,
  'stored reservation identity, status, message, and timestamps checked'
from public.reservations as reservation
where reservation.id = (
  select id from pg_temp.step11_runtime
  where label = 'complete_buyer_reservation'
);

select pg_temp.step11_expect_rejected(
  'buyer cannot create a duplicate active request',
  format(
    'select public.request_reservation(%L::uuid,%L)',
    (select id from pg_temp.step11_resources where label = 'listing_complete'),
    'Duplicate request'
  ),
  '23505'
);

select pg_temp.step11_expect_rejected(
  'participant cannot promote a reservation directly',
  format(
    'update public.reservations set status = %L where id = %L::uuid',
    'accepted',
    (select id from pg_temp.step11_runtime
     where label = 'complete_buyer_reservation')
  ),
  '42501'
);

reset role;

-- A second buyer may submit a competing pending request.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'buyer_two'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'buyer_two'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step11_runtime (label, id)
select
  'complete_competing_reservation',
  public.request_reservation(
    (select id from pg_temp.step11_resources where label = 'listing_complete'),
    null
  );

reset role;

-- An unrelated verified student cannot read private reservation or meetup
-- records, cannot query them through the summary, and cannot mutate a meetup.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'outsider'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'outsider'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step11_results
select
  'unrelated student cannot read another pair reservation data',
  (select count(*) = 0 from public.reservations)
    and (select count(*) = 0 from public.meetups)
    and (select count(*) = 0 from public.get_my_reservation_summaries()),
  'direct RLS rows and summary rows were empty';

select pg_temp.step11_expect_rejected(
  'unrelated student cannot schedule another pair meetup',
  format(
    'select public.upsert_meetup(%L::uuid,%L,%L,now() + interval ''1 day'',%L)',
    (select id from pg_temp.step11_runtime
     where label = 'complete_buyer_reservation'),
    'UC Main Campus Lobby',
    'Near the security desk',
    'Outsider attempt'
  ),
  'P0002'
);

select pg_temp.step11_expect_rejected(
  'unrelated student cannot accept another seller reservation',
  format(
    'select public.accept_reservation(%L::uuid)',
    (select id from pg_temp.step11_runtime
     where label = 'complete_buyer_reservation')
  ),
  'P0002'
);

reset role;

-- Seller sees both requests, accepts exactly one, and cannot use the legacy
-- listing-only sold path.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'seller'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'seller'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.step11_expect_rejected(
  'seller cannot reserve their own listing',
  format(
    'select public.request_reservation(%L::uuid,null)',
    (select id from pg_temp.step11_resources where label = 'listing_complete')
  ),
  'P0002'
);

insert into pg_temp.step11_results
select
  'seller summary reports both pending requests without extra queries',
  count(*) = 2
    and bool_and(viewer_role = 'seller')
    and bool_and(pending_request_count = 2),
  'summary count and seller role checked'
from public.get_my_reservation_summaries()
where listing_id = (
  select id from pg_temp.step11_resources where label = 'listing_complete'
);

reset role;

-- A request created while eligible must not reserve the item if the buyer
-- becomes suspended before the seller accepts it.
update public.profiles
set account_status = 'suspended'
where id = (select id from pg_temp.step11_subjects where label = 'buyer');

set local role authenticated;

select pg_temp.step11_expect_rejected(
  'seller cannot accept a buyer suspended after requesting',
  format(
    'select public.accept_reservation(%L::uuid)',
    (select id from pg_temp.step11_runtime
     where label = 'complete_buyer_reservation')
  ),
  'P0002'
);

insert into pg_temp.step11_results
select
  'ineligible buyer acceptance leaves listing and requests unchanged',
  (select status = 'available' from public.listings
   where id = (select id from pg_temp.step11_resources
               where label = 'listing_complete'))
    and (select count(*) = 2 and bool_and(status = 'pending')
         from public.reservations
         where listing_id = (select id from pg_temp.step11_resources
                             where label = 'listing_complete')),
  'available listing and two pending requests retained';

reset role;

update public.profiles
set account_status = 'active'
where id = (select id from pg_temp.step11_subjects where label = 'buyer');

set local role authenticated;

select public.accept_reservation(
  (select id from pg_temp.step11_runtime
   where label = 'complete_buyer_reservation')
);

insert into pg_temp.step11_results
select
  'acceptance reserves listing and rejects every competing request',
  (select status = 'reserved' from public.listings
   where id = (select id from pg_temp.step11_resources
               where label = 'listing_complete'))
    and (select status = 'accepted' and responded_at is not null
         from public.reservations
         where id = (select id from pg_temp.step11_runtime
                     where label = 'complete_buyer_reservation'))
    and (select status = 'rejected' and responded_at is not null
         from public.reservations
         where id = (select id from pg_temp.step11_runtime
                     where label = 'complete_competing_reservation')),
  'listing and both reservation rows checked';

reset role;

-- Auth deletion would otherwise cascade through profiles and erase accepted
-- reservations, leaving an item reserved without an accepted buyer.
select pg_temp.step11_expect_rejected(
  'buyer hard deletion cannot erase accepted reservation history',
  format(
    'delete from auth.users where id = %L::uuid',
    (select id from pg_temp.step11_subjects where label = 'buyer')
  ),
  '23001'
);

select pg_temp.step11_expect_rejected(
  'seller hard deletion cannot erase listing and transaction history',
  format(
    'delete from auth.users where id = %L::uuid',
    (select id from pg_temp.step11_subjects where label = 'seller')
  ),
  '23001'
);

insert into pg_temp.step11_results
select
  'blocked participant deletion preserves the accepted listing context',
  (select status = 'reserved' from public.listings
   where id = (select id from pg_temp.step11_resources
               where label = 'listing_complete'))
    and (select status = 'accepted' from public.reservations
         where id = (select id from pg_temp.step11_runtime
                     where label = 'complete_buyer_reservation'))
    and (select count(*) = 2 from public.profiles
         where id in (
           select id from pg_temp.step11_subjects
           where label in ('buyer', 'seller')
         )),
  'both profiles, listing, and accepted reservation retained';

set local role authenticated;

select pg_temp.step11_expect_rejected(
  'stale seller page cannot accept the rejected competing request',
  format(
    'select public.accept_reservation(%L::uuid)',
    (select id from pg_temp.step11_runtime
     where label = 'complete_competing_reservation')
  ),
  'P0002'
);

select pg_temp.step11_expect_rejected(
  'listing-only sold transition cannot bypass meetup completion',
  format(
    'select public.set_owned_listing_status(%L::uuid,%L)',
    (select id from pg_temp.step11_resources where label = 'listing_complete'),
    'sold'
  ),
  '22023'
);

select pg_temp.step11_expect_rejected(
  'null listing status cannot bypass the removal-only lifecycle guard',
  format(
    'select public.set_owned_listing_status(%L::uuid,null)',
    (select id from pg_temp.step11_resources where label = 'listing_complete')
  ),
  '22023'
);

insert into pg_temp.step11_runtime (label, id)
select
  'complete_conversation',
  public.start_reservation_conversation(
    (select id from pg_temp.step11_runtime
     where label = 'complete_buyer_reservation')
  );

insert into pg_temp.step11_results
select
  'seller can start the reservation-derived buyer conversation idempotently',
  conversation.listing_id = (
    select id from pg_temp.step11_resources where label = 'listing_complete'
  )
    and conversation.buyer_id = (
      select id from pg_temp.step11_subjects where label = 'buyer'
    )
    and conversation.seller_id = (
      select id from pg_temp.step11_subjects where label = 'seller'
    )
    and conversation.id = public.start_reservation_conversation(
      (select id from pg_temp.step11_runtime
       where label = 'complete_buyer_reservation')
    ),
  'derived conversation tuple and repeated result checked'
from public.conversations as conversation
where conversation.id = (
  select id from pg_temp.step11_runtime where label = 'complete_conversation'
);

reset role;

-- Either participant may create/edit the single active meetup. The buyer does
-- so here and receives the same row after editing it.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'buyer'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step11_runtime (label, id)
select
  'complete_meetup',
  public.upsert_meetup(
    (select id from pg_temp.step11_runtime
     where label = 'complete_buyer_reservation'),
    'UC Main Campus Lobby',
    'Near the main entrance beside the security desk',
    now() + interval '1 day',
    'Message me when you arrive.'
  );

insert into pg_temp.step11_meetup_versions (label, updated_at)
select 'before_edit', updated_at
from public.meetups
where id = (select id from pg_temp.step11_runtime
            where label = 'complete_meetup');

insert into pg_temp.step11_results
select
  'meetup is reservation-derived and one row is edited in place',
  meetup.id = public.upsert_meetup(
      (select id from pg_temp.step11_runtime
       where label = 'complete_buyer_reservation'),
      'UC Main Campus Canteen',
      'At the tables beside the guard station',
      now() + interval '2 days',
      'Please bring exact payment.',
      meetup.updated_at
    )
    and meetup.listing_id = (
      select id from pg_temp.step11_resources where label = 'listing_complete'
    )
    and meetup.buyer_id = (
      select id from pg_temp.step11_subjects where label = 'buyer'
    )
    and meetup.seller_id = (
      select id from pg_temp.step11_subjects where label = 'seller'
    )
    and (select count(*) = 1 from public.meetups
         where reservation_id = meetup.reservation_id),
  'meetup id, derived context, and row count checked'
from public.meetups as meetup
where meetup.id = (
  select id from pg_temp.step11_runtime where label = 'complete_meetup'
);

select pg_temp.step11_expect_rejected(
  'meetup edit requires the version read by its form',
  format(
    'select public.upsert_meetup(%L::uuid,%L,null,now() + interval ''3 days'',null)',
    (select id from pg_temp.step11_runtime
     where label = 'complete_buyer_reservation'),
    'Stale edit without a version'
  ),
  '40001'
);

select pg_temp.step11_expect_rejected(
  'stale meetup version cannot overwrite current details',
  format(
    'select public.upsert_meetup(%L::uuid,%L,null,now() + interval ''3 days'',null,%L::timestamptz)',
    (select id from pg_temp.step11_runtime
     where label = 'complete_buyer_reservation'),
    'Stale edit with an old version',
    (select updated_at from pg_temp.step11_meetup_versions
     where label = 'before_edit')
  ),
  '40001'
);

insert into pg_temp.step11_results
select
  'rejected stale meetup edits preserve the current arrangement',
  location_name = 'UC Main Campus Canteen'
    and location_details = 'At the tables beside the guard station'
    and scheduled_at = now() + interval '2 days'
    and notes = 'Please bring exact payment.'
    and updated_at > (
      select updated_at from pg_temp.step11_meetup_versions
      where label = 'before_edit'
    ),
  'latest location, schedule, and notes were unchanged'
from public.meetups
where id = (select id from pg_temp.step11_runtime
            where label = 'complete_meetup');

select pg_temp.step11_expect_rejected(
  'buyer cannot complete the seller sale',
  format(
    'select public.complete_sale(%L::uuid)',
    (select id from pg_temp.step11_runtime
     where label = 'complete_buyer_reservation')
  ),
  'P0002'
);

reset role;

-- Seller completes all records in one RPC.
-- Reject only the generated fixture's sold update after complete_sale has
-- already updated its meetup and reservation. This proves statement rollback
-- restores every earlier write when a later lifecycle update fails.
create or replace function pg_temp.step11_reject_fixture_sale()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id::text = tg_argv[0] and new.status = 'sold' then
    raise exception 'Forced Step 11 fixture sale failure.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function pg_temp.step11_reject_fixture_sale()
  from public, anon, authenticated;

do $$
begin
  execute format(
    'create trigger step11_reject_fixture_sale before update on public.listings '
      || 'for each row execute function pg_temp.step11_reject_fixture_sale(%L)',
    (select id::text from pg_temp.step11_resources
     where label = 'listing_complete')
  );
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'seller'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'seller'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.step11_expect_rejected(
  'sale completion failure rolls back its earlier transaction writes',
  format(
    'select public.complete_sale(%L::uuid)',
    (select id from pg_temp.step11_runtime
     where label = 'complete_buyer_reservation')
  ),
  '23514'
);

insert into pg_temp.step11_results
select
  'failed sale retains reserved accepted and scheduled transaction state',
  (select status = 'reserved' from public.listings
   where id = (select id from pg_temp.step11_resources
               where label = 'listing_complete'))
    and (select status = 'accepted' and completed_at is null
         from public.reservations
         where id = (select id from pg_temp.step11_runtime
                     where label = 'complete_buyer_reservation'))
    and (select status = 'scheduled' and completed_at is null
         from public.meetups
         where id = (select id from pg_temp.step11_runtime
                     where label = 'complete_meetup')),
  'listing, reservation, and meetup retained pre-sale states after failure';

reset role;
drop trigger step11_reject_fixture_sale on public.listings;
drop function pg_temp.step11_reject_fixture_sale();
set local role authenticated;

select public.complete_sale(
  (select id from pg_temp.step11_runtime
   where label = 'complete_buyer_reservation')
);

insert into pg_temp.step11_results
select
  'sale completion closes every transaction record atomically',
  (select status = 'sold' from public.listings
   where id = (select id from pg_temp.step11_resources
               where label = 'listing_complete'))
    and (select status = 'completed' and completed_at is not null
         from public.reservations
         where id = (select id from pg_temp.step11_runtime
                     where label = 'complete_buyer_reservation'))
    and (select status = 'completed' and completed_at is not null
         from public.meetups
         where id = (select id from pg_temp.step11_runtime
                     where label = 'complete_meetup')),
  'all persisted terminal states checked in the seller context';

reset role;

-- The completed buyer retains the fixed history projection, saved sold-listing
-- link, and path-validated private image access.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'buyer'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step11_results
select
  'completed buyer retains safe summary and historical cover access',
  summary.reservation_status = 'completed'
    and summary.meetup_status = 'completed'
    and exists (
      select 1
      from public.favorites as favorite
      where favorite.user_id = (
        select id from pg_temp.step11_subjects where label = 'buyer'
      )
        and favorite.listing_id = summary.listing_id
    )
    and summary.conversation_id = (
      select id from pg_temp.step11_runtime where label = 'complete_conversation'
    )
    and summary.listing_image_path is not null
    and summary.can_view_listing
    and private.can_read_favorited_sold_listing(summary.listing_id)
    and private.can_read_listing_image_object(
      summary.listing_image_path,
      summary.seller_id::text
    ),
  'summary terminal fields, conversation, cover path, and Storage predicate checked'
from public.get_my_reservation_summaries(
  (select id from pg_temp.step11_runtime
   where label = 'complete_buyer_reservation')
) as summary;

reset role;

-- Accepted cancellation by the seller restores availability and cancels the
-- active meetup. First create and accept that independent request.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'buyer'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step11_runtime (label, id)
select
  'cancel_reservation',
  public.request_reservation(
    (select id from pg_temp.step11_resources where label = 'listing_cancel'),
    'Please hold this item.'
  );

reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'seller'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'seller'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select public.accept_reservation(
  (select id from pg_temp.step11_runtime where label = 'cancel_reservation')
);

insert into pg_temp.step11_runtime (label, id)
select
  'cancel_meetup',
  public.upsert_meetup(
    (select id from pg_temp.step11_runtime where label = 'cancel_reservation'),
    'UC Main Campus Lobby',
    'Beside the security desk',
    now() + interval '1 day',
    null
  );

select public.cancel_reservation(
  (select id from pg_temp.step11_runtime where label = 'cancel_reservation')
);

insert into pg_temp.step11_results
select
  'seller cancellation atomically restores listing and cancels meetup',
  (select status = 'available' from public.listings
   where id = (select id from pg_temp.step11_resources
               where label = 'listing_cancel'))
    and (select status = 'cancelled' and cancelled_at is not null
         from public.reservations
         where id = (select id from pg_temp.step11_runtime
                     where label = 'cancel_reservation'))
    and (select status = 'cancelled' and cancelled_at is not null
         from public.meetups
         where id = (select id from pg_temp.step11_runtime
                     where label = 'cancel_meetup')),
  'available/cancelled/cancelled state checked';

reset role;

-- Sellers reject rather than cancel a pending request; buyers may cancel it.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'buyer_two'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'buyer_two'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step11_runtime (label, id)
select
  'pending_cancel_reservation',
  public.request_reservation(
    (select id from pg_temp.step11_resources
     where label = 'listing_pending_cancel'),
    null
  );

reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'seller'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'seller'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.step11_expect_rejected(
  'seller cannot cancel a pending request instead of responding',
  format(
    'select public.cancel_reservation(%L::uuid)',
    (select id from pg_temp.step11_runtime
     where label = 'pending_cancel_reservation')
  ),
  'P0002'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'buyer_two'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'buyer_two'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select public.cancel_reservation(
  (select id from pg_temp.step11_runtime
   where label = 'pending_cancel_reservation')
);

insert into pg_temp.step11_results
select
  'buyer pending cancellation preserves available listing',
  (select status = 'available' from public.listings
   where id = (select id from pg_temp.step11_resources
               where label = 'listing_pending_cancel'))
    and (select status = 'cancelled' and cancelled_at is not null
         and responded_at is null
         from public.reservations
         where id = (select id from pg_temp.step11_runtime
                     where label = 'pending_cancel_reservation')),
  'available listing and pending-origin cancellation timestamps checked';

insert into pg_temp.step11_runtime (label, id)
select
  'no_meetup_reservation',
  public.request_reservation(
    (select id from pg_temp.step11_resources
     where label = 'listing_pending_cancel'),
    'Requesting again after the earlier request was cancelled.'
  );

reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'seller'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'seller'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select public.accept_reservation(
  (select id from pg_temp.step11_runtime where label = 'no_meetup_reservation')
);

select public.complete_sale(
  (select id from pg_temp.step11_runtime where label = 'no_meetup_reservation')
);

insert into pg_temp.step11_results
select
  'terminal request permits a new request and completion without a meetup',
  (select status = 'sold' from public.listings
   where id = (select id from pg_temp.step11_resources
               where label = 'listing_pending_cancel'))
    and (select status = 'completed' and completed_at is not null
         from public.reservations
         where id = (select id from pg_temp.step11_runtime
                     where label = 'no_meetup_reservation'))
    and not exists (
      select 1 from public.meetups
      where reservation_id = (
        select id from pg_temp.step11_runtime
        where label = 'no_meetup_reservation'
      )
    ),
  'new terminal reservation completed without creating a meetup';

reset role;

-- Live profile checks block pending and suspended accounts at both RPC and
-- read-projection boundaries.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'pending'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'pending'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.step11_expect_rejected(
  'pending student cannot request a reservation',
  format(
    'select public.request_reservation(%L::uuid,null)',
    (select id from pg_temp.step11_resources
     where label = 'listing_pending_cancel')
  ),
  '42501'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step11_subjects where label = 'suspended'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step11_subjects where label = 'suspended'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step11_results
select
  'suspended student cannot read reservation or meetup data',
  (select count(*) = 0 from public.reservations)
    and (select count(*) = 0 from public.meetups)
    and (select count(*) = 0 from public.get_my_reservation_summaries()),
  'live-profile RLS and projection gates returned zero rows';

select pg_temp.step11_expect_rejected(
  'suspended student cannot request a reservation',
  format(
    'select public.request_reservation(%L::uuid,null)',
    (select id from pg_temp.step11_resources
     where label = 'listing_pending_cancel')
  ),
  '42501'
);

reset role;

delete from public.reservations
where buyer_id in (select id from pg_temp.step11_subjects)
  or seller_id in (select id from pg_temp.step11_subjects);

delete from public.listings
where seller_id in (select id from pg_temp.step11_subjects);

delete from auth.users
where id in (select id from pg_temp.step11_subjects);

delete from public.categories
where id = (
  select id from pg_temp.step11_resources where label = 'category'
);

commit;

select
  count(*) as tests_run,
  count(*) filter (where passed) as tests_passed,
  count(*) = 34 and bool_and(passed) as all_passed,
  coalesce(
    jsonb_agg(
      jsonb_build_object('scenario', scenario, 'observed', observed)
      order by scenario
    ) filter (where not passed),
    '[]'::jsonb
  ) as failures
from pg_temp.step11_results;
