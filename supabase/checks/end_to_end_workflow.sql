-- Step 15: real grants/RLS/RPCs across one coherent buyer/seller transaction.
-- Run as a privileged migration-test user, NEVER from an ordinary app client.
-- Everything (including injected failure triggers and auth fixtures) rolls back.
-- This does not test email delivery, real Auth sessions, HTTP Storage bytes,
-- Realtime, browser behavior, or two simultaneous PostgreSQL connections.
begin;

create temporary table qa15_subjects (label text primary key, id uuid not null unique);
insert into qa15_subjects values
  ('admin', gen_random_uuid()), ('seller', gen_random_uuid()),
  ('buyer', gen_random_uuid()), ('outsider', gen_random_uuid()),
  ('suspended', gen_random_uuid()), ('pending', gen_random_uuid()),
  ('rejected', gen_random_uuid());
create temporary table qa15_resources (label text primary key, id uuid not null unique);
insert into qa15_resources values
  ('category', gen_random_uuid()), ('listing', gen_random_uuid()),
  ('image', gen_random_uuid()), ('seller_verification', gen_random_uuid()),
  ('buyer_verification', gen_random_uuid()), ('pending_verification', gen_random_uuid()),
  ('rejected_verification', gen_random_uuid());
create temporary table qa15_runtime (label text primary key, id uuid not null);
create temporary table qa15_versions (label text primary key, value timestamptz not null);
create temporary table qa15_counts (label text primary key, value bigint not null);
create temporary table qa15_results (scenario text primary key, passed boolean not null, observed text not null);
create temporary table qa15_failure (target_status text not null);
grant select on qa15_subjects, qa15_resources to authenticated, anon;
grant select, insert, update on qa15_runtime, qa15_versions, qa15_counts, qa15_results to authenticated, anon;

create function pg_temp.qa15_assert(p_scenario text, p_passed boolean, p_observed text default 'persisted database state checked')
returns void language sql security invoker set search_path = '' as $$
  insert into pg_temp.qa15_results values (p_scenario, coalesce(p_passed, false), p_observed);
$$;
create function pg_temp.qa15_login(p_label text)
returns void language sql security invoker set search_path = '' as $$
  select set_config('request.jwt.claim.sub', (select id::text from pg_temp.qa15_subjects where label = p_label), true);
  select set_config('request.jwt.claims', json_build_object('sub', (select id::text from pg_temp.qa15_subjects where label = p_label), 'role', 'authenticated')::text, true);
$$;
create function pg_temp.qa15_expect_rejected(p_scenario text, p_statement text, p_expected_state text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  begin
    execute p_statement;
    perform pg_temp.qa15_assert(p_scenario, false, 'operation unexpectedly succeeded');
  exception when others then
    perform pg_temp.qa15_assert(p_scenario, sqlstate = p_expected_state, 'SQLSTATE ' || sqlstate);
  end;
end;
$$;
grant execute on function pg_temp.qa15_assert(text, boolean, text), pg_temp.qa15_login(text), pg_temp.qa15_expect_rejected(text, text, text) to authenticated, anon;

-- Use the REAL registration trigger; malicious authorization metadata is not
-- inserted into profiles manually. Email confirmation is only fixture setup.
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_user_meta_data)
select id, 'authenticated', 'authenticated', label || '+' || id::text || '@example.invalid', now(),
  jsonb_build_object(
    'full_name', 'QA Fifteen ' || label, 'student_id_number', 'QA15-' || upper(replace(id::text, '-', '')),
    'course', 'bscs', 'year_level', '2', 'role', 'admin', 'verification_status', 'verified', 'account_status', 'suspended'
  )
from pg_temp.qa15_subjects;
select pg_temp.qa15_assert('registration copies safe metadata but ignores forged privileges', (
  select count(*) = 7 and bool_and(role = 'student' and verification_status = 'unverified' and account_status = 'active'
    and course = 'BSCS' and year_level = 2 and full_name is not null and student_id_number like 'QA15-%')
  from public.profiles where id in (select id from pg_temp.qa15_subjects)
));
-- Privileged QA bootstrap is explicit, never an email-based application bypass.
update public.profiles set role = 'admin', verification_status = 'verified' where id = (select id from pg_temp.qa15_subjects where label = 'admin');
update public.profiles set verification_status = 'verified' where id in (select id from pg_temp.qa15_subjects where label in ('outsider', 'suspended'));
update public.profiles set account_status = 'suspended' where id = (select id from pg_temp.qa15_subjects where label = 'suspended');
insert into public.categories (id, name, slug, is_active)
select id, 'QA workflow ' || id::text, 'qa-workflow-' || id::text, true from pg_temp.qa15_resources where label = 'category';

-- Unverified students upload only their own private school ID and submit the
-- canonical snapshot. Submission, profile pending state, and later approval
-- are produced by production RPCs, not fixture writes.
select pg_temp.qa15_login('seller'); set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id)
select 'student-verifications', subject.id::text || '/' || resource.id::text || '/student-id.png', subject.id::text
from pg_temp.qa15_subjects subject cross join pg_temp.qa15_resources resource where subject.label = 'seller' and resource.label = 'seller_verification';
select public.submit_verification(resource.id, subject.id::text || '/' || resource.id::text || '/student-id.png')
from pg_temp.qa15_subjects subject cross join pg_temp.qa15_resources resource where subject.label = 'seller' and resource.label = 'seller_verification';
select pg_temp.qa15_assert('submission atomically creates evidence snapshot and pending profile',
  (select verification_status = 'pending' from public.profiles where id = auth.uid())
  and (select count(*) = 1 from public.verifications where user_id = auth.uid() and status = 'pending' and course_snapshot = 'BSCS' and year_level_snapshot = 2));
select pg_temp.qa15_expect_rejected('pending seller cannot self-approve', format('select public.review_verification(%L::uuid,%L,null)', (select id from pg_temp.qa15_resources where label = 'seller_verification'), 'approved'), '42501');
select pg_temp.qa15_expect_rejected('pending seller cannot create a listing', format('insert into public.listings(seller_id,category_id,title,description,price,condition) values(%L::uuid,%L::uuid,%L,%L,650,%L)', auth.uid(), (select id from pg_temp.qa15_resources where label = 'category'), 'Forbidden calculator', 'School calculator description', 'good'), '42501');
reset role;

select pg_temp.qa15_login('buyer'); set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id)
select 'student-verifications', subject.id::text || '/' || resource.id::text || '/student-id.png', subject.id::text
from pg_temp.qa15_subjects subject cross join pg_temp.qa15_resources resource where subject.label = 'buyer' and resource.label = 'buyer_verification';
select public.submit_verification(resource.id, subject.id::text || '/' || resource.id::text || '/student-id.png')
from pg_temp.qa15_subjects subject cross join pg_temp.qa15_resources resource where subject.label = 'buyer' and resource.label = 'buyer_verification';
select pg_temp.qa15_assert('buyer cannot browse seller private school ID', not exists (
  select 1 from storage.objects where bucket_id = 'student-verifications' and owner_id = (select id::text from pg_temp.qa15_subjects where label = 'seller')));
reset role;

select pg_temp.qa15_login('pending'); set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id)
select 'student-verifications', subject.id::text || '/' || resource.id::text || '/student-id.png', subject.id::text
from pg_temp.qa15_subjects subject cross join pg_temp.qa15_resources resource where subject.label = 'pending' and resource.label = 'pending_verification';
select public.submit_verification(resource.id, subject.id::text || '/' || resource.id::text || '/student-id.png')
from pg_temp.qa15_subjects subject cross join pg_temp.qa15_resources resource where subject.label = 'pending' and resource.label = 'pending_verification';
reset role;
select pg_temp.qa15_login('rejected'); set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id)
select 'student-verifications', subject.id::text || '/' || resource.id::text || '/student-id.png', subject.id::text
from pg_temp.qa15_subjects subject cross join pg_temp.qa15_resources resource where subject.label = 'rejected' and resource.label = 'rejected_verification';
select public.submit_verification(resource.id, subject.id::text || '/' || resource.id::text || '/student-id.png')
from pg_temp.qa15_subjects subject cross join pg_temp.qa15_resources resource where subject.label = 'rejected' and resource.label = 'rejected_verification';
reset role;

select pg_temp.qa15_login('admin'); set local role authenticated;
select public.review_verification(id, 'approved', null) from pg_temp.qa15_resources where label in ('seller_verification', 'buyer_verification');
select public.review_verification(id, 'rejected', 'The school ID photo is unreadable.') from pg_temp.qa15_resources where label = 'rejected_verification';
select pg_temp.qa15_assert('admin approval and rejection update profiles and retain review history',
  (select count(*) = 2 from public.profiles where id in (select id from pg_temp.qa15_subjects where label in ('seller','buyer')) and verification_status = 'verified')
  and (select count(*) = 1 from public.verifications where id = (select id from pg_temp.qa15_resources where label = 'rejected_verification') and status = 'rejected' and reviewed_by = auth.uid() and rejection_reason is not null));
select pg_temp.qa15_assert('admin can inspect submitted private school IDs', (select count(*) = 4 from storage.objects where bucket_id = 'student-verifications' and owner_id in (select id::text from pg_temp.qa15_subjects)));
reset role;

select pg_temp.qa15_login('seller'); set local role authenticated;
insert into public.listings (id, seller_id, category_id, title, description, price, condition)
select listing.id, auth.uid(), category.id, 'QA Casio Scientific Calculator', 'Used for one semester; trigonometry functions work properly.', 650, 'good'
from pg_temp.qa15_resources listing cross join pg_temp.qa15_resources category where listing.label = 'listing' and category.label = 'category';
insert into storage.objects (bucket_id, name, owner_id)
select 'listing-images', auth.uid()::text || '/' || listing.id::text || '/' || image.id::text || '.png', auth.uid()::text
from pg_temp.qa15_resources listing cross join pg_temp.qa15_resources image where listing.label = 'listing' and image.label = 'image';
insert into public.listing_images (listing_id, storage_path, is_cover, sort_order)
select listing.id, auth.uid()::text || '/' || listing.id::text || '/' || image.id::text || '.png', true, 0
from pg_temp.qa15_resources listing cross join pg_temp.qa15_resources image where listing.label = 'listing' and image.label = 'image';
select public.publish_listing(id) from pg_temp.qa15_resources where label = 'listing';
select pg_temp.qa15_assert('seller publishes own draft only after owned Storage image',
  (select status = 'available' and seller_id = auth.uid() from public.listings where id = (select id from pg_temp.qa15_resources where label = 'listing'))
  and (select count(*) = 1 from public.listing_images where listing_id = (select id from pg_temp.qa15_resources where label = 'listing')));
select pg_temp.qa15_expect_rejected('seller cannot self-message', format('select public.start_listing_conversation(%L::uuid)', (select id from pg_temp.qa15_resources where label = 'listing')), 'P0002');
select pg_temp.qa15_expect_rejected('seller cannot self-reserve', format('select public.request_reservation(%L::uuid,null)', (select id from pg_temp.qa15_resources where label = 'listing')), 'P0002');
reset role;

select pg_temp.qa15_login('buyer'); set local role authenticated;
select pg_temp.qa15_assert('buyer search and combined filters match persisted listing', (select count(*) = 1 from public.listings
  where id = (select id from pg_temp.qa15_resources where label = 'listing') and (title ilike '%CALCULATOR%' or description ilike '%trigonometry%')
    and category_id = (select id from pg_temp.qa15_resources where label = 'category') and condition = 'good' and price between 500 and 2000 and status = 'available'));
select public.set_listing_favorite(id, true) from pg_temp.qa15_resources where label = 'listing';
select public.set_listing_favorite(id, true) from pg_temp.qa15_resources where label = 'listing';
select pg_temp.qa15_assert('repeated favorite is persistent and idempotent', (select count(*) = 1 from public.favorites where user_id = auth.uid() and listing_id = (select id from pg_temp.qa15_resources where label = 'listing')));
insert into pg_temp.qa15_runtime select 'conversation', public.start_listing_conversation(id) from pg_temp.qa15_resources where label = 'listing';
select pg_temp.qa15_assert('message-seller retry reuses the same conversation', (select public.start_listing_conversation(id) = (select id from pg_temp.qa15_runtime where label = 'conversation') from pg_temp.qa15_resources where label = 'listing'));
insert into pg_temp.qa15_runtime select 'buyer_message', public.send_conversation_message(id, 'Hi, is this still available?') from pg_temp.qa15_runtime where label = 'conversation';
select pg_temp.qa15_expect_rejected('direct message sender spoof is denied', format('insert into public.messages(conversation_id,sender_id,body) values(%L::uuid,%L::uuid,%L)', (select id from pg_temp.qa15_runtime where label = 'conversation'), (select id from pg_temp.qa15_subjects where label = 'seller'), 'Spoofed seller'), '42501');
select pg_temp.qa15_expect_rejected('buyer cannot update seller listing through direct SQL', format('update public.listings set title = %L where id = %L::uuid', 'Hacked', (select id from pg_temp.qa15_resources where label = 'listing')), '42501');
select pg_temp.qa15_expect_rejected('buyer cannot promote own profile role', 'update public.profiles set role = ''admin'' where id = auth.uid()', '42501');
select pg_temp.qa15_expect_rejected('buyer cannot forge verification status', 'update public.profiles set verification_status = ''verified'' where id = auth.uid()', '42501');
insert into pg_temp.qa15_runtime select 'reservation', public.request_reservation(id, 'Can we meet tomorrow after class?') from pg_temp.qa15_resources where label = 'listing';
select pg_temp.qa15_expect_rejected('duplicate active reservation is rejected', format('select public.request_reservation(%L::uuid,null)', (select id from pg_temp.qa15_resources where label = 'listing')), '23505');
reset role;

select pg_temp.qa15_login('seller'); set local role authenticated;
select pg_temp.qa15_assert('seller receives message and request notifications without private body text',
  (select unread_count = 1 from public.get_my_conversation_summaries((select id from pg_temp.qa15_runtime where label = 'conversation')))
  and exists (select 1 from public.notifications where type = 'message' and conversation_id = (select id from pg_temp.qa15_runtime where label = 'conversation') and message not like '%Hi, is this still available?%')
  and exists (select 1 from public.notifications where type = 'reservation_requested' and reservation_id = (select id from pg_temp.qa15_runtime where label = 'reservation')));
select public.mark_conversation_read(id) from pg_temp.qa15_runtime where label = 'conversation';
select pg_temp.qa15_assert('reading a conversation persistently clears received unread count',
  (select unread_count = 0 from public.get_my_conversation_summaries((select id from pg_temp.qa15_runtime where label = 'conversation')))
  and (select read_at is not null from public.messages where id = (select id from pg_temp.qa15_runtime where label = 'buyer_message')));
insert into pg_temp.qa15_runtime select 'seller_message', public.send_conversation_message(id, 'Yes, it is still available.') from pg_temp.qa15_runtime where label = 'conversation';
select pg_temp.qa15_assert('seller cannot read buyer favorite records', not exists(select 1 from public.favorites where user_id = (select id from pg_temp.qa15_subjects where label = 'buyer')));
reset role;

select pg_temp.qa15_login('outsider'); set local role authenticated;
insert into pg_temp.qa15_runtime select 'competing_reservation', public.request_reservation(id, 'Another request') from pg_temp.qa15_resources where label = 'listing';
select pg_temp.qa15_assert('knowing IDs does not expose unrelated conversations or meetups',
  not exists(select 1 from public.conversations where id = (select id from pg_temp.qa15_runtime where label = 'conversation'))
  and not exists(select 1 from public.messages where conversation_id = (select id from pg_temp.qa15_runtime where label = 'conversation'))
  and not exists(select 1 from public.reservations where id = (select id from pg_temp.qa15_runtime where label = 'reservation')));
reset role;

-- Inject a late failure after the RPC has already updated the reservation and
-- created its notification. The RPC subtransaction must undo BOTH effects.
create function pg_temp.qa15_fail_listing_transition() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id = (select id from pg_temp.qa15_resources where label = 'listing')
    and new.status = (select target_status from pg_temp.qa15_failure limit 1)
  then raise exception 'QA injected lifecycle failure' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger qa15_injected_listing_failure before update on public.listings for each row execute function pg_temp.qa15_fail_listing_transition();
insert into pg_temp.qa15_failure values ('reserved');
insert into pg_temp.qa15_counts values ('notifications_before_accept', (select count(*) from public.notifications where user_id in (select id from pg_temp.qa15_subjects)));
select pg_temp.qa15_login('seller'); set local role authenticated;
select pg_temp.qa15_expect_rejected('late acceptance failure is surfaced', format('select public.accept_reservation(%L::uuid)', (select id from pg_temp.qa15_runtime where label = 'reservation')), '23514');
reset role;
select pg_temp.qa15_assert('failed acceptance rolls back reservation listing competitors and notifications',
  (select status = 'available' from public.listings where id = (select id from pg_temp.qa15_resources where label = 'listing'))
  and (select count(*) = 2 from public.reservations where listing_id = (select id from pg_temp.qa15_resources where label = 'listing') and status = 'pending')
  and (select count(*) = (select value from pg_temp.qa15_counts where label = 'notifications_before_accept') from public.notifications where user_id in (select id from pg_temp.qa15_subjects)));
truncate pg_temp.qa15_failure;
select pg_temp.qa15_login('seller'); set local role authenticated;
select public.accept_reservation(id) from pg_temp.qa15_runtime where label = 'reservation';
select pg_temp.qa15_assert('successful acceptance reserves exactly one buyer and rejects competitor',
  (select status = 'reserved' from public.listings where id = (select id from pg_temp.qa15_resources where label = 'listing'))
  and (select count(*) = 1 from public.reservations where listing_id = (select id from pg_temp.qa15_resources where label = 'listing') and status = 'accepted')
  and (select status = 'rejected' from public.reservations where id = (select id from pg_temp.qa15_runtime where label = 'competing_reservation')));
select pg_temp.qa15_expect_rejected('stale competing acceptance cannot override the winner', format('select public.accept_reservation(%L::uuid)', (select id from pg_temp.qa15_runtime where label = 'competing_reservation')), 'P0002');
reset role;

select pg_temp.qa15_login('buyer'); set local role authenticated;
insert into pg_temp.qa15_runtime select 'meetup', public.upsert_meetup(id, 'UC Main Campus Lobby', 'Near the security desk', now() + interval '1 day', 'Meet after class.', null) from pg_temp.qa15_runtime where label = 'reservation';
insert into pg_temp.qa15_versions select 'meetup_initial', updated_at from public.meetups where id = (select id from pg_temp.qa15_runtime where label = 'meetup');
select pg_temp.qa15_assert('meetup derives participants and retains private schedule',
  (select status = 'scheduled' and buyer_id = auth.uid() and seller_id = (select id from pg_temp.qa15_subjects where label = 'seller')
    and location_name = 'UC Main Campus Lobby' and notes = 'Meet after class.' from public.meetups where id = (select id from pg_temp.qa15_runtime where label = 'meetup')));
select pg_temp.qa15_expect_rejected('buyer cannot complete seller sale', format('select public.complete_sale(%L::uuid)', (select id from pg_temp.qa15_runtime where label = 'reservation')), 'P0002');
reset role;
select pg_temp.qa15_login('seller'); set local role authenticated;
select public.upsert_meetup(id, 'UC Main Campus Lobby', 'At the front desk', now() + interval '2 days', 'Updated meeting instructions.', (select value from pg_temp.qa15_versions where label = 'meetup_initial')) from pg_temp.qa15_runtime where label = 'reservation';
select pg_temp.qa15_expect_rejected('stale meetup edit is rejected rather than overwriting newer details', format('select public.upsert_meetup(%L::uuid,%L,null,now()+interval ''1 day'',null,%L::timestamptz)', (select id from pg_temp.qa15_runtime where label = 'reservation'), 'Stale location', (select value from pg_temp.qa15_versions where label = 'meetup_initial')), 'PT409');
reset role;

select pg_temp.qa15_login('outsider'); set local role authenticated;
select pg_temp.qa15_assert('unrelated verified student cannot read meetup or recipient notifications',
  not exists(select 1 from public.meetups where id = (select id from pg_temp.qa15_runtime where label = 'meetup'))
  and not exists(select 1 from public.notifications where user_id in (select id from pg_temp.qa15_subjects where label in ('buyer', 'seller'))));
select pg_temp.qa15_expect_rejected('unrelated student cannot edit a known meetup', format('select public.upsert_meetup(%L::uuid,%L,null,now()+interval ''1 day'',null,null)', (select id from pg_temp.qa15_runtime where label = 'reservation'), 'Unauthorized location'), 'P0002');
reset role;

insert into pg_temp.qa15_failure values ('sold');
insert into pg_temp.qa15_counts values ('notifications_before_sale', (select count(*) from public.notifications where user_id in (select id from pg_temp.qa15_subjects)));
select pg_temp.qa15_login('seller'); set local role authenticated;
select pg_temp.qa15_expect_rejected('late sale failure is surfaced', format('select public.complete_sale(%L::uuid)', (select id from pg_temp.qa15_runtime where label = 'reservation')), '23514');
reset role;
select pg_temp.qa15_assert('failed sale rolls back meetup reservation listing and notifications together',
  (select status = 'reserved' from public.listings where id = (select id from pg_temp.qa15_resources where label = 'listing'))
  and (select status = 'accepted' and completed_at is null from public.reservations where id = (select id from pg_temp.qa15_runtime where label = 'reservation'))
  and (select status = 'scheduled' and completed_at is null from public.meetups where id = (select id from pg_temp.qa15_runtime where label = 'meetup'))
  and (select count(*) = (select value from pg_temp.qa15_counts where label = 'notifications_before_sale') from public.notifications where user_id in (select id from pg_temp.qa15_subjects)));
truncate pg_temp.qa15_failure;
select pg_temp.qa15_login('seller'); set local role authenticated;
select public.complete_sale(id) from pg_temp.qa15_runtime where label = 'reservation';
select pg_temp.qa15_assert('successful sale commits listing reservation and meetup completion',
  (select status = 'sold' from public.listings where id = (select id from pg_temp.qa15_resources where label = 'listing'))
  and (select status = 'completed' and completed_at is not null from public.reservations where id = (select id from pg_temp.qa15_runtime where label = 'reservation'))
  and (select status = 'completed' and completed_at is not null from public.meetups where id = (select id from pg_temp.qa15_runtime where label = 'meetup')));
select pg_temp.qa15_expect_rejected('double sale completion cannot create duplicate completion events', format('select public.complete_sale(%L::uuid)', (select id from pg_temp.qa15_runtime where label = 'reservation')), 'P0002');
reset role;

-- Remove the emulated JWT, then establish a fresh one and re-query persisted
-- data. This demonstrates SQL persistence; it is NOT a real logout/login test.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
set local role anon;
select pg_temp.qa15_expect_rejected('missing session cannot read private messages', 'select * from public.messages', '42501');
reset role;
select pg_temp.qa15_login('buyer'); set local role authenticated;
select pg_temp.qa15_assert('fresh buyer context sees persisted completed transaction and conversation',
  (select status = 'sold' from public.listings where id = (select id from pg_temp.qa15_resources where label = 'listing'))
  and (select status = 'completed' from public.reservations where id = (select id from pg_temp.qa15_runtime where label = 'reservation'))
  and (select status = 'completed' from public.meetups where id = (select id from pg_temp.qa15_runtime where label = 'meetup'))
  and (select count(*) = 2 from public.messages where conversation_id = (select id from pg_temp.qa15_runtime where label = 'conversation'))
  and exists(select 1 from public.favorites where listing_id = (select id from pg_temp.qa15_resources where label = 'listing'))
  and exists(select 1 from public.notifications where type = 'sale_completed' and reservation_id = (select id from pg_temp.qa15_runtime where label = 'reservation')));
select pg_temp.qa15_expect_rejected('sold listing cannot receive another reservation', format('select public.request_reservation(%L::uuid,null)', (select id from pg_temp.qa15_resources where label = 'listing')), 'P0002');
select pg_temp.qa15_expect_rejected('completed meetup history cannot be rewritten', format('select public.upsert_meetup(%L::uuid,%L,null,now()+interval ''1 day'',null,null)', (select id from pg_temp.qa15_runtime where label = 'reservation'), 'Rewritten location'), 'P0002');
reset role;

select pg_temp.qa15_login('suspended'); set local role authenticated;
select pg_temp.qa15_assert('suspension blocks direct marketplace reads while preserving own account',
  not exists(select 1 from public.listings where id = (select id from pg_temp.qa15_resources where label = 'listing'))
  and not exists(select 1 from public.messages where conversation_id = (select id from pg_temp.qa15_runtime where label = 'conversation'))
  and (select account_status = 'suspended' from public.profiles where id = auth.uid()));
select pg_temp.qa15_expect_rejected('suspended student cannot self-reactivate', 'update public.profiles set account_status = ''active'' where id = auth.uid()', '42501');
select pg_temp.qa15_expect_rejected('suspended student cannot send new marketplace messages', format('select public.send_conversation_message(%L::uuid,%L)', (select id from pg_temp.qa15_runtime where label = 'conversation'), 'Suspended message'), '42501');
select pg_temp.qa15_expect_rejected('suspended student cannot request reservations directly', format('select public.request_reservation(%L::uuid,null)', (select id from pg_temp.qa15_resources where label = 'listing')), '42501');
reset role;
select pg_temp.qa15_login('pending'); set local role authenticated;
select pg_temp.qa15_assert('pending account has no seller-projection or transaction access',
  not exists(select 1 from public.marketplace_profiles)
  and not exists(select 1 from public.reservations where id = (select id from pg_temp.qa15_runtime where label = 'reservation')));
reset role;
select pg_temp.qa15_login('rejected'); set local role authenticated;
select pg_temp.qa15_assert('rejection reason remains available only on own private verification history',
  (select verification_status = 'rejected' from public.profiles where id = auth.uid())
  and exists(select 1 from public.verifications where user_id = auth.uid() and rejection_reason = 'The school ID photo is unreadable.')
  and not exists(select 1 from public.verifications where user_id = (select id from pg_temp.qa15_subjects where label = 'seller')));
reset role;

select scenario, passed, observed from pg_temp.qa15_results order by scenario;
select '__all_end_to_end_workflow_checks_passed__' as scenario, count(*) as tests_run,
  bool_and(passed) and count(*) = 45 as all_passed,
  coalesce(jsonb_agg(jsonb_build_object('scenario',scenario,'observed',observed)) filter(where not passed), '[]'::jsonb) as failures
from pg_temp.qa15_results;
rollback;
