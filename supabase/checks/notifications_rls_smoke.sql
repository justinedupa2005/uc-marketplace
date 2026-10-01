-- Transactional Step 12 integration and authorization matrix. Use a privileged
-- local/test SQL connection after migrations. Every durable fixture is removed
-- before commit; all identifiers are freshly generated and fixture-scoped.
begin;

create temporary table step12_subjects (
  label text primary key, id uuid not null unique,
  verification_status text not null, account_status text not null
);
insert into step12_subjects values
  ('seller', gen_random_uuid(), 'verified', 'active'),
  ('buyer', gen_random_uuid(), 'verified', 'active'),
  ('buyer_two', gen_random_uuid(), 'verified', 'active'),
  ('outsider', gen_random_uuid(), 'verified', 'active'),
  ('unverified', gen_random_uuid(), 'unverified', 'active'),
  ('pending', gen_random_uuid(), 'pending', 'active'),
  ('rejected', gen_random_uuid(), 'rejected', 'active'),
  ('suspended', gen_random_uuid(), 'verified', 'suspended'),
  ('disabled', gen_random_uuid(), 'verified', 'disabled'),
  ('verify_approve', gen_random_uuid(), 'unverified', 'active'),
  ('verify_reject', gen_random_uuid(), 'unverified', 'active'),
  ('admin', gen_random_uuid(), 'verified', 'active');
create temporary table step12_resources (label text primary key, id uuid not null unique);
insert into step12_resources
select label, gen_random_uuid() from unnest(array[
  'category', 'listing_sale', 'listing_cancel_buyer', 'listing_cancel_seller',
  'listing_reject', 'listing_pending_cancel', 'listing_moderate',
  'listing_own_remove', 'listing_rollback', 'verification_approve', 'verification_reject'
]) as label;
create temporary table step12_runtime (label text primary key, id uuid not null unique);
create temporary table step12_results (scenario text primary key, passed boolean not null, observed text not null);
create temporary table step12_snapshot (label text primary key, snapshot_at timestamptz not null, unread_count bigint not null);
create temporary table step12_read_times (label text primary key, read_at timestamptz not null);
grant select on pg_temp.step12_subjects, pg_temp.step12_resources to authenticated, anon;
grant select, insert, update on pg_temp.step12_runtime, pg_temp.step12_results,
  pg_temp.step12_snapshot, pg_temp.step12_read_times to authenticated, anon;

create function pg_temp.step12_assert(p_scenario text, p_passed boolean, p_observed text default 'state checked')
returns void language sql security invoker set search_path = '' as $$
  insert into pg_temp.step12_results values (p_scenario, coalesce(p_passed, false), p_observed)
$$;
grant execute on function pg_temp.step12_assert(text, boolean, text) to authenticated, anon;

-- SQL statements run with the real authenticated role and auth.uid(). This
-- helper changes only test-session JWT settings; it is never installed in app
-- schemas or granted to Data API roles.
create function pg_temp.step12_as(p_actor text, p_statement text)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_actor uuid;
begin
  select id into strict v_actor from pg_temp.step12_subjects where label = p_actor;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_statement;
  exception when others then
    execute 'reset role';
    raise;
  end;
  execute 'reset role';
end;
$$;
revoke all on function pg_temp.step12_as(text, text) from public, anon, authenticated;
create function pg_temp.step12_expect_rejected(p_scenario text, p_actor text, p_statement text, p_state text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  begin
    if p_actor is null then execute p_statement;
    else perform pg_temp.step12_as(p_actor, p_statement); end if;
    perform pg_temp.step12_assert(p_scenario, false, 'operation unexpectedly succeeded');
  exception when others then
    perform pg_temp.step12_assert(p_scenario, sqlstate = p_state, 'SQLSTATE ' || sqlstate);
  end;
end;
$$;
revoke all on function pg_temp.step12_expect_rejected(text, text, text, text) from public, anon, authenticated;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select id, 'authenticated', 'authenticated',
  label || '+' || replace(id::text, '-', '') || '@example.invalid',
  crypt(gen_random_uuid()::text, gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
from pg_temp.step12_subjects;
insert into public.profiles (id, full_name, student_id_number, course, year_level, role, verification_status, account_status)
select id, 'Step Twelve ' || replace(label, '_', ' '),
  'STEP12-' || upper(left(replace(id::text, '-', ''), 12)), 'BSCS', 1,
  case when label = 'admin' then 'admin' else 'student' end,
  verification_status, account_status from pg_temp.step12_subjects
on conflict (id) do update set full_name = excluded.full_name,
  student_id_number = excluded.student_id_number, course = excluded.course,
  year_level = excluded.year_level, role = excluded.role,
  verification_status = excluded.verification_status, account_status = excluded.account_status;
insert into public.categories (id, name, slug, is_active)
select id, 'Step 12 ' || id::text, 'step12-' || id::text, true
from pg_temp.step12_resources where label = 'category';
insert into public.listings (id, seller_id, category_id, title, description, price, condition, status)
select resource.id, (select id from pg_temp.step12_subjects where label = 'seller'),
  (select id from pg_temp.step12_resources where label = 'category'),
  'Step 12 ' || replace(resource.label, '_', ' '),
  'Disposable notification integration test listing.', 100, 'good', 'available'
from pg_temp.step12_resources as resource where label like 'listing_%';

-- Every account keeps its own inbox, even when marketplace access is gated.
select private.create_notification(id, 'verification_rejected', 'Inbox test',
  'Only the recipient may read this update.', 'step12:seed:' || id::text)
from pg_temp.step12_subjects;
do $$
declare v_label text;
begin
  foreach v_label in array array['seller', 'buyer', 'outsider', 'unverified', 'pending', 'rejected', 'suspended', 'disabled', 'admin'] loop
    perform pg_temp.step12_as(v_label, format(
      'select pg_temp.step12_assert(%L, (select count(*) = 1 and bool_and(user_id = auth.uid()) from public.notifications), %L)',
      v_label || ' reads only their own inbox regardless of marketplace eligibility', 'owner RLS, including restricted account states'));
    perform pg_temp.step12_as(v_label, format(
      'select pg_temp.step12_assert(%L, (select unread_count = 1 from public.get_my_notification_state()), %L)',
      v_label || ' unread state RPC counts only their inbox', 'owner count under RLS'));
  end loop;
end;
$$;
select pg_temp.step12_expect_rejected('student cannot insert a notification', 'buyer',
  format('insert into public.notifications (user_id,type,title,message,event_key) values (%L::uuid,%L,%L,%L,%L)',
    (select id from pg_temp.step12_subjects where label = 'seller'), 'message', 'Forged', 'Forged update', 'forged'), '42501');
select pg_temp.step12_expect_rejected('student cannot edit notification content or read state directly', 'buyer',
  'update public.notifications set title = ''Forged'', is_read = true, read_at = now()', '42501');
select pg_temp.step12_expect_rejected('student cannot delete notifications', 'buyer',
  'delete from public.notifications', '42501');
select pg_temp.step12_expect_rejected('student cannot call trusted notification helper', 'buyer',
  format('select private.create_notification(%L::uuid,%L,%L,%L,%L)',
    (select id from pg_temp.step12_subjects where label = 'seller'), 'message', 'Forged', 'Forged update', 'forged-helper'), '42501');
select pg_temp.step12_expect_rejected('student cannot call notification trigger function', 'buyer',
  'select private.notify_new_message()', '42501');
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
begin
  begin
    perform 1 from public.notifications;
    perform pg_temp.step12_assert('anonymous inbox reads are denied', false);
  exception when others then
    perform pg_temp.step12_assert('anonymous inbox reads are denied', sqlstate = '42501', 'SQLSTATE ' || sqlstate);
  end;
  begin
    perform public.mark_all_notifications_read();
    perform pg_temp.step12_assert('anonymous read-state mutation is denied', false);
  exception when others then
    perform pg_temp.step12_assert('anonymous read-state mutation is denied', sqlstate = '42501', 'SQLSTATE ' || sqlstate);
  end;
  begin
    perform public.get_my_notification_state();
    perform pg_temp.step12_assert('anonymous unread-state RPC is denied', false);
  exception when others then
    perform pg_temp.step12_assert('anonymous unread-state RPC is denied', sqlstate = '42501', 'SQLSTATE ' || sqlstate);
  end;
end;
$$;
reset role;

-- The owner receives the same response for foreign and nonexistent IDs. No
-- read timestamp is invented for a different recipient.
select pg_temp.step12_as('buyer', format(
  'select pg_temp.step12_assert(%L, not public.mark_notification_read(%L::uuid) and not public.mark_notification_read(%L::uuid))',
  'foreign and missing notification ids both return false',
  (select id from public.notifications where user_id = (select id from pg_temp.step12_subjects where label = 'seller')),
  gen_random_uuid()));
select pg_temp.step12_assert('cross-owner read attempt leaves the recipient row unread',
  (select not is_read and read_at is null from public.notifications
   where user_id = (select id from pg_temp.step12_subjects where label = 'seller')));
select pg_temp.step12_as('buyer',
  'select pg_temp.step12_assert(''owner can mark their notification read'', public.mark_notification_read((select id from public.notifications limit 1)))');
insert into pg_temp.step12_read_times select 'buyer_first', read_at from public.notifications
where user_id = (select id from pg_temp.step12_subjects where label = 'buyer');
select pg_temp.step12_as('buyer',
  'select public.mark_notification_read((select id from public.notifications limit 1))');
select pg_temp.step12_assert('individual read is idempotent and preserves its first timestamp',
  (select is_read and read_at = (select read_at from pg_temp.step12_read_times where label = 'buyer_first')
   from public.notifications where user_id = (select id from pg_temp.step12_subjects where label = 'buyer')));
select pg_temp.step12_as('disabled',
  'select pg_temp.step12_assert(''disabled owner can manage their own inbox'', public.mark_all_notifications_read() = 1)');
select pg_temp.step12_expect_rejected('infinite mark-all cutoff is rejected', 'buyer',
  'select public.mark_all_notifications_read(''infinity''::timestamptz)', '22023');

-- Type, read-state, title, recipient, and references must remain constrained
-- even for trusted producers.
select pg_temp.step12_expect_rejected('unknown notification type fails the database constraint', null,
  format('insert into public.notifications(user_id,type,title,message,event_key) values (%L::uuid,%L,%L,%L,%L)',
    (select id from pg_temp.step12_subjects where label = 'buyer'), 'arbitrary_type', 'Test', 'Test', 'invalid-type'), '23514');
select pg_temp.step12_expect_rejected('inconsistent unread timestamp fails the database constraint', null,
  format('insert into public.notifications(user_id,type,title,message,event_key,is_read,read_at) values (%L::uuid,%L,%L,%L,%L,false,now())',
    (select id from pg_temp.step12_subjects where label = 'buyer'), 'message', 'Test', 'Test', 'invalid-read'), '23514');
select pg_temp.step12_expect_rejected('blank notification title fails the database constraint', null,
  format('insert into public.notifications(user_id,type,title,message,event_key) values (%L::uuid,%L,%L,%L,%L)',
    (select id from pg_temp.step12_subjects where label = 'buyer'), 'message', E' \n\t', 'Test', 'invalid-title'), '23514');
select pg_temp.step12_expect_rejected('oversized notification message fails the database constraint', null,
  format('insert into public.notifications(user_id,type,title,message,event_key) values (%L::uuid,%L,%L,%L,%L)',
    (select id from pg_temp.step12_subjects where label = 'buyer'), 'message', 'Test', repeat('x', 501), 'invalid-message'), '23514');
select pg_temp.step12_expect_rejected('null notification recipient is forbidden', null,
  'insert into public.notifications(user_id,type,title,message,event_key) values (null,''message'',''Test'',''Test'',''null-recipient'')', '23502');
select pg_temp.step12_expect_rejected('infinite notification creation timestamp is forbidden', null,
  format('insert into public.notifications(user_id,type,title,message,event_key,created_at) values (%L::uuid,%L,%L,%L,%L,''infinity''::timestamptz)',
    (select id from pg_temp.step12_subjects where label = 'buyer'), 'message', 'Test', 'Test', 'infinite-created'), '23514');
select pg_temp.step12_expect_rejected('infinite notification read timestamp is forbidden', null,
  format('insert into public.notifications(user_id,type,title,message,event_key,is_read,read_at) values (%L::uuid,%L,%L,%L,%L,true,''infinity''::timestamptz)',
    (select id from pg_temp.step12_subjects where label = 'buyer'), 'message', 'Test', 'Test', 'infinite-read'), '23514');
select pg_temp.step12_expect_rejected('unknown recipient fails its foreign key', null,
  format('select private.create_notification(%L::uuid,%L,%L,%L,%L)', gen_random_uuid(), 'message', 'Test', 'Test', 'invalid-recipient'), '23503');
select pg_temp.step12_expect_rejected('unknown related listing fails its foreign key', null,
  format('select private.create_notification(%L::uuid,%L,%L,%L,%L,%L::uuid)',
    (select id from pg_temp.step12_subjects where label = 'buyer'), 'message', 'Test', 'Test', 'invalid-listing', gen_random_uuid()), '23503');

-- Message notifications derive the opposite participant, omit private body
-- text, and never notify the sender. Repeated source updates do not re-deliver.
select pg_temp.step12_as('buyer',
  'insert into pg_temp.step12_runtime select ''conversation'', public.start_listing_conversation((select id from pg_temp.step12_resources where label = ''listing_sale''))');
select pg_temp.step12_as('buyer',
  'insert into pg_temp.step12_runtime select ''message'', public.send_conversation_message((select id from pg_temp.step12_runtime where label = ''conversation''), ''PRIVATE-CHAT-BODY do not duplicate'')');
select pg_temp.step12_assert('new message notifies only its trusted opposite participant and links conversation',
  (select count(*) = 1 and bool_and(user_id = (select id from pg_temp.step12_subjects where label = 'seller'))
     and bool_and(conversation_id = (select id from pg_temp.step12_runtime where label = 'conversation'))
     and bool_and(listing_id = (select id from pg_temp.step12_resources where label = 'listing_sale'))
     and bool_and(message not like '%PRIVATE-CHAT-BODY%')
   from public.notifications where type = 'message'));
select pg_temp.step12_as('seller',
  'select public.mark_conversation_read((select id from pg_temp.step12_runtime where label = ''conversation''))');
select pg_temp.step12_assert('reading a message never re-delivers its notification',
  (select count(*) = 1 from public.notifications where type = 'message'));
select private.create_notification(
  (select id from pg_temp.step12_subjects where label = 'seller'), 'message', 'New message', 'Duplicate delivery',
  'message:' || (select id::text from pg_temp.step12_runtime where label = 'message'));
select pg_temp.step12_assert('retrying the same trusted event key does not duplicate delivery',
  (select count(*) = 1 from public.notifications where type = 'message'));

-- Real Step 11 request/accept/reject/meetup/complete-sale workflows.
select pg_temp.step12_as('buyer',
  'insert into pg_temp.step12_runtime select ''sale_reservation'', public.request_reservation((select id from pg_temp.step12_resources where label = ''listing_sale''), ''PRIVATE-RESERVATION-MESSAGE'')');
select pg_temp.step12_as('buyer_two',
  'insert into pg_temp.step12_runtime select ''competing_reservation'', public.request_reservation((select id from pg_temp.step12_resources where label = ''listing_sale''), null)');
select pg_temp.step12_assert('reservation request notifies only listing seller with derived context',
  (select count(*) = 2 and bool_and(user_id = (select id from pg_temp.step12_subjects where label = 'seller'))
     and bool_and(listing_id = (select id from pg_temp.step12_resources where label = 'listing_sale'))
     and bool_and(reservation_id is not null) and bool_and(message not like '%PRIVATE-RESERVATION-MESSAGE%')
   from public.notifications where type = 'reservation_requested'));
select pg_temp.step12_as('seller',
  'select public.accept_reservation((select id from pg_temp.step12_runtime where label = ''sale_reservation''))');
select pg_temp.step12_assert('acceptance notifies accepted buyer and rejection notifies competing buyer',
  (select count(*) = 1 and bool_and(user_id = (select id from pg_temp.step12_subjects where label = 'buyer'))
   from public.notifications where type = 'reservation_accepted')
  and (select count(*) = 1 and bool_and(user_id = (select id from pg_temp.step12_subjects where label = 'buyer_two'))
   from public.notifications where type = 'reservation_rejected'));
select pg_temp.step12_assert('competing rejection reveals no accepted buyer identity',
  (select bool_and(message not like '%' || (select id::text from pg_temp.step12_subjects where label = 'buyer') || '%'
    and message not like '%Step Twelve buyer%') from public.notifications where type = 'reservation_rejected'));
select pg_temp.step12_expect_rejected('stale repeated acceptance is rejected', 'seller',
  'select public.accept_reservation((select id from pg_temp.step12_runtime where label = ''sale_reservation''))', 'P0002');
select pg_temp.step12_assert('stale repeated acceptance creates no duplicate notification',
  (select count(*) = 1 from public.notifications where type = 'reservation_accepted'));
select pg_temp.step12_as('buyer',
  'insert into pg_temp.step12_runtime select ''sale_meetup'', public.upsert_meetup((select id from pg_temp.step12_runtime where label = ''sale_reservation''), ''PRIVATE-MEETUP-LOCATION'', ''PRIVATE-MEETUP-DETAILS'', now() + interval ''1 day'', ''PRIVATE-MEETUP-NOTES'')');
select pg_temp.step12_assert('scheduled meetup notifies other participant without exposing private details',
  (select count(*) = 1 and bool_and(user_id = (select id from pg_temp.step12_subjects where label = 'seller'))
    and bool_and(meetup_id = (select id from pg_temp.step12_runtime where label = 'sale_meetup'))
    and bool_and(reservation_id = (select id from pg_temp.step12_runtime where label = 'sale_reservation'))
    and bool_and(message not like '%PRIVATE-MEETUP%') from public.notifications where type = 'meetup_scheduled'));
select pg_temp.step12_as('seller',
  'select public.upsert_meetup((select id from pg_temp.step12_runtime where label = ''sale_reservation''), ''PRIVATE-MEETUP-LOCATION-CHANGED'', ''PRIVATE-MEETUP-DETAILS'', now() + interval ''1 day'', ''PRIVATE-MEETUP-NOTES'', (select updated_at from public.meetups where id = (select id from pg_temp.step12_runtime where label = ''sale_meetup'')))');
select pg_temp.step12_assert('meaningful meetup edit notifies the other participant',
  (select count(*) = 1 and bool_and(user_id = (select id from pg_temp.step12_subjects where label = 'buyer'))
   from public.notifications where type = 'meetup_updated'));
select pg_temp.step12_as('seller',
  'select public.upsert_meetup(reservation_id, location_name, location_details, scheduled_at, notes, updated_at) from public.meetups where id = (select id from pg_temp.step12_runtime where label = ''sale_meetup'')');
select pg_temp.step12_assert('unchanged meetup save creates no duplicate notification',
  (select count(*) = 1 from public.notifications where type = 'meetup_updated'));
select pg_temp.step12_as('buyer',
  'select public.upsert_meetup(reservation_id, ''PRIVATE-MEETUP-LOCATION'', location_details, scheduled_at, notes, updated_at) from public.meetups where id = (select id from pg_temp.step12_runtime where label = ''sale_meetup'')');
select pg_temp.step12_assert('returning to previous meetup details is a new meaningful event for the other participant',
  (select count(*) = 2 from public.notifications where type = 'meetup_updated')
  and (select count(*) = 1 from public.notifications where type = 'meetup_updated'
       and user_id = (select id from pg_temp.step12_subjects where label = 'seller')));
select pg_temp.step12_as('seller',
  'select public.complete_sale((select id from pg_temp.step12_runtime where label = ''sale_reservation''))');
select pg_temp.step12_assert('completed sale notifies buyer while closing listing reservation and meetup atomically',
  (select count(*) = 1 and bool_and(user_id = (select id from pg_temp.step12_subjects where label = 'buyer'))
   from public.notifications where type = 'sale_completed')
  and (select status = 'sold' from public.listings where id = (select id from pg_temp.step12_resources where label = 'listing_sale'))
  and (select status = 'completed' from public.reservations where id = (select id from pg_temp.step12_runtime where label = 'sale_reservation'))
  and (select status = 'completed' from public.meetups where id = (select id from pg_temp.step12_runtime where label = 'sale_meetup')));
select pg_temp.step12_expect_rejected('stale repeated sale completion is rejected', 'seller',
  'select public.complete_sale((select id from pg_temp.step12_runtime where label = ''sale_reservation''))', 'P0002');
select pg_temp.step12_assert('stale repeated sale completion creates no duplicate transaction notice',
  (select count(*) = 1 from public.notifications where type = 'sale_completed'));

-- Both participant directions and pending cancellation rules.
do $$
declare v_label text; v_actor text; v_recipient uuid;
begin
  foreach v_label in array array['cancel_buyer', 'cancel_seller', 'pending_cancel', 'reject', 'moderate'] loop
    perform pg_temp.step12_as('buyer', format(
      'insert into pg_temp.step12_runtime select %L, public.request_reservation((select id from pg_temp.step12_resources where label = %L), null)',
      v_label || '_reservation', 'listing_' || v_label));
    if v_label in ('cancel_buyer', 'cancel_seller', 'moderate') then
      perform pg_temp.step12_as('seller', format(
        'select public.accept_reservation((select id from pg_temp.step12_runtime where label = %L))', v_label || '_reservation'));
    end if;
    if v_label = 'moderate' then continue; end if;
    v_actor := case when v_label in ('cancel_buyer', 'pending_cancel') then 'buyer' else 'seller' end;
    if v_label = 'reject' then
      perform pg_temp.step12_as(v_actor, format(
        'select public.reject_reservation((select id from pg_temp.step12_runtime where label = %L))', v_label || '_reservation'));
    else
      perform pg_temp.step12_as(v_actor, format(
        'select public.cancel_reservation((select id from pg_temp.step12_runtime where label = %L))', v_label || '_reservation'));
    end if;
    if v_label = 'pending_cancel' then
      perform pg_temp.step12_assert('pending cancellation does not create an accepted-reservation notice',
        not exists (select 1 from public.notifications where type = 'reservation_cancelled'
                    and reservation_id = (select id from pg_temp.step12_runtime where label = 'pending_cancel_reservation')));
    else
      select id into v_recipient from pg_temp.step12_subjects where label = case when v_actor = 'buyer' then 'seller' else 'buyer' end;
      perform pg_temp.step12_assert(v_label || ' notifies only the other participant',
        (select count(*) = 1 and bool_and(user_id = v_recipient) from public.notifications
         where type = case when v_label = 'reject' then 'reservation_rejected' else 'reservation_cancelled' end
           and reservation_id = (select id from pg_temp.step12_runtime where label = v_label || '_reservation')));
    end if;
  end loop;
end;
$$;

-- Admin review and moderation notifications omit identity documents and
-- rejection reasons. Repeated decisions/status writes create no duplicates.
insert into public.verifications (id, user_id, full_name_snapshot, student_id_number_snapshot,
  course_snapshot, year_level_snapshot, document_path)
select resource.id, subject.id, 'Step Twelve ' || subject.label,
  'STEP12-' || upper(left(replace(subject.id::text, '-', ''), 12)), 'BSCS', 1,
  subject.id::text || '/' || resource.id::text || '/student-id.jpg'
from pg_temp.step12_resources as resource join pg_temp.step12_subjects as subject
  on subject.label = case when resource.label = 'verification_approve' then 'verify_approve' else 'verify_reject' end
where resource.label like 'verification_%';
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
select 'student-verifications', document_path, user_id, user_id::text,
  '{"mimetype":"image/jpeg","size":128}'::jsonb
from public.verifications where id in (select id from pg_temp.step12_resources where label like 'verification_%');
select pg_temp.step12_as('admin',
  'select public.review_verification((select id from pg_temp.step12_resources where label = ''verification_approve''), ''approved'', null)');
select pg_temp.step12_as('admin',
  'select public.review_verification((select id from pg_temp.step12_resources where label = ''verification_reject''), ''rejected'', ''PRIVATE-REJECTION-REASON do not duplicate'')');
select pg_temp.step12_assert('verification approval and rejection each notify their student only',
  (select count(*) = 1 and bool_and(user_id = (select id from pg_temp.step12_subjects where label = 'verify_approve'))
   from public.notifications where type = 'verification_approved')
  and (select count(*) = 1 and bool_and(user_id = (select id from pg_temp.step12_subjects where label = 'verify_reject'))
       from public.notifications where type = 'verification_rejected' and event_key like 'verification:%')
  and not exists (select 1 from public.notifications where message like '%PRIVATE-REJECTION-REASON%' or message like '%student-id.jpg%'));
select pg_temp.step12_expect_rejected('repeated verification review is rejected', 'admin',
  'select public.review_verification((select id from pg_temp.step12_resources where label = ''verification_approve''), ''approved'', null)', 'P0001');
select pg_temp.step12_assert('repeated review creates no duplicate approval notification',
  (select count(*) = 1 from public.notifications where type = 'verification_approved'));
select pg_temp.step12_as('admin',
  'select public.admin_moderate_listing((select id from pg_temp.step12_resources where label = ''listing_moderate''), ''Listing content violates marketplace policy.'')');
select pg_temp.step12_expect_rejected('repeated admin listing removal is rejected', 'admin',
  'select public.admin_moderate_listing((select id from pg_temp.step12_resources where label = ''listing_moderate''), ''Listing content violates marketplace policy.'')', 'P0001');
select pg_temp.step12_assert('admin listing removal notifies seller once and cancels transaction for both participants',
  (select count(*) = 1 and bool_and(user_id = (select id from pg_temp.step12_subjects where label = 'seller'))
   from public.notifications where type = 'listing_removed')
  and (select count(*) = 2 and count(distinct user_id) = 2 from public.notifications
       where type = 'reservation_cancelled' and reservation_id = (select id from pg_temp.step12_runtime where label = 'moderate_reservation')));
select pg_temp.step12_as('seller',
  'select public.set_owned_listing_status((select id from pg_temp.step12_resources where label = ''listing_own_remove''), ''removed'')');
select pg_temp.step12_assert('seller self-removal does not claim to be admin moderation',
  not exists (select 1 from public.notifications where type = 'listing_removed'
              and listing_id = (select id from pg_temp.step12_resources where label = 'listing_own_remove')));
select pg_temp.step12_as('admin',
  'select public.admin_moderate_user((select id from pg_temp.step12_subjects where label = ''outsider''), ''suspended'', ''Repeated unsafe marketplace conduct.'')');
select pg_temp.step12_expect_rejected('repeated suspension is rejected', 'admin',
  'select public.admin_moderate_user((select id from pg_temp.step12_subjects where label = ''outsider''), ''suspended'', ''Repeated unsafe marketplace conduct.'')', 'P0001');
select pg_temp.step12_assert('repeated suspension creates only one recipient notification',
  (select count(*) = 1 and bool_and(user_id = (select id from pg_temp.step12_subjects where label = 'outsider'))
   from public.notifications where type = 'account_suspended'));
select pg_temp.step12_as('outsider',
  'select pg_temp.step12_assert(''suspended user can read their own suspension notice'', (select count(*) = 1 from public.notifications where type = ''account_suspended''))');
select pg_temp.step12_as('admin',
  'select public.admin_moderate_user((select id from pg_temp.step12_subjects where label = ''outsider''), ''active'', ''Student appeal was carefully reviewed.'')');
select pg_temp.step12_expect_rejected('repeated reactivation is rejected', 'admin',
  'select public.admin_moderate_user((select id from pg_temp.step12_subjects where label = ''outsider''), ''active'', ''Student appeal was carefully reviewed.'')', 'P0001');
select pg_temp.step12_assert('repeated reactivation creates only one recipient notification',
  (select count(*) = 1 and bool_and(user_id = (select id from pg_temp.step12_subjects where label = 'outsider'))
   from public.notifications where type = 'account_reactivated'));
select pg_temp.step12_as('admin',
  'select public.admin_moderate_user((select id from pg_temp.step12_subjects where label = ''outsider''), ''suspended'', ''Further conduct review required a suspension.'')');
select pg_temp.step12_as('admin',
  'select public.admin_moderate_user((select id from pg_temp.step12_subjects where label = ''outsider''), ''active'', ''Further appeal restored this account.'')');
select pg_temp.step12_assert('later legitimate suspend and reactivate transitions are not suppressed as duplicates',
  (select count(*) = 2 from public.notifications where type = 'account_suspended')
  and (select count(*) = 2 from public.notifications where type = 'account_reactivated'));
select pg_temp.step12_as('admin',
  'select public.admin_moderate_user((select id from pg_temp.step12_subjects where label = ''outsider''), ''disabled'', ''Severe policy violation requires account closure.'')');
select pg_temp.step12_as('outsider',
  'select pg_temp.step12_assert(''disabled recipient can read an accurate account-disabled notification'', (select count(*) = 1 from public.notifications where type = ''account_suspended'' and title = ''Account disabled''))');
select pg_temp.step12_assert('event workflow never sends an admin their own action notification',
  (select count(*) = 1 from public.notifications where user_id = (select id from pg_temp.step12_subjects where label = 'admin')));

-- Snapshot cutoff: arrivals after the captured database time remain unread.
select pg_temp.step12_as('buyer',
  'insert into pg_temp.step12_snapshot select ''buyer'', snapshot_at, unread_count from public.get_my_notification_state()');
select private.create_notification((select id from pg_temp.step12_subjects where label = 'buyer'),
  'message', 'New arrival', 'This arrived after the inbox snapshot.', 'step12:arrival');
-- Exercise the exact microsecond boundary without relying on client clocks or
-- timing sleeps. This is a privileged fixture adjustment, never a user write.
update public.notifications set created_at =
  (select snapshot_at from pg_temp.step12_snapshot where label = 'buyer') + interval '1 microsecond'
where event_key = 'step12:arrival' and user_id = (select id from pg_temp.step12_subjects where label = 'buyer');
select pg_temp.step12_as('buyer',
  'select pg_temp.step12_assert(''mark all changes only snapshot unread rows'', public.mark_all_notifications_read((select snapshot_at from pg_temp.step12_snapshot where label = ''buyer'')) = (select unread_count from pg_temp.step12_snapshot where label = ''buyer''))');
select pg_temp.step12_as('buyer',
  'select pg_temp.step12_assert(''arrival after snapshot stays unread and badge count remains accurate'', (select not is_read and read_at is null from public.notifications where event_key = ''step12:arrival'') and (select unread_count = 1 from public.get_my_notification_state()))');
select pg_temp.step12_as('buyer',
  'select pg_temp.step12_assert(''repeated snapshot mark-all changes zero rows'', public.mark_all_notifications_read((select snapshot_at from pg_temp.step12_snapshot where label = ''buyer'')) = 0)');
select pg_temp.step12_assert('mark-all preserves other recipients unread state',
  (select count(*) > 0 and bool_and(not is_read and read_at is null) from public.notifications
   where user_id = (select id from pg_temp.step12_subjects where label = 'seller')));

-- Inject a delivery failure inside one event transaction and prove both layers
-- roll back. The temporary trigger is removed immediately after the assertion.
create function pg_temp.step12_fail_delivery() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.listing_id = (select id from pg_temp.step12_resources where label = 'listing_rollback') then
    raise exception 'Injected notification delivery failure' using errcode = 'XX000';
  end if;
  return new;
end;
$$;
create trigger step12_injected_delivery_failure before insert on public.notifications
for each row execute function pg_temp.step12_fail_delivery();
select pg_temp.step12_expect_rejected('notification failure rejects the atomic reservation transaction', 'buyer',
  'select public.request_reservation((select id from pg_temp.step12_resources where label = ''listing_rollback''), null)', 'XX000');
drop trigger step12_injected_delivery_failure on public.notifications;
select pg_temp.step12_assert('notification failure leaves no reservation or partial event behind',
  not exists (select 1 from public.reservations where listing_id = (select id from pg_temp.step12_resources where label = 'listing_rollback'))
  and not exists (select 1 from public.notifications where listing_id = (select id from pg_temp.step12_resources where label = 'listing_rollback'))
  and (select status = 'available' from public.listings where id = (select id from pg_temp.step12_resources where label = 'listing_rollback')));
select pg_temp.step12_as('buyer',
  'insert into pg_temp.step12_runtime select ''rollback_reservation'', public.request_reservation((select id from pg_temp.step12_resources where label = ''listing_rollback''), null)');
select pg_temp.step12_as('buyer',
  'insert into pg_temp.step12_runtime select ''rollback_conversation'', public.start_listing_conversation((select id from pg_temp.step12_resources where label = ''listing_rollback''))');
create trigger step12_injected_delivery_failure before insert on public.notifications
for each row execute function pg_temp.step12_fail_delivery();
select pg_temp.step12_expect_rejected('notification failure rejects the atomic acceptance transaction', 'seller',
  'select public.accept_reservation((select id from pg_temp.step12_runtime where label = ''rollback_reservation''))', 'XX000');
select pg_temp.step12_assert('failed acceptance preserves pending reservation and available listing without an acceptance notice',
  (select status = 'pending' and responded_at is null from public.reservations
   where id = (select id from pg_temp.step12_runtime where label = 'rollback_reservation'))
  and (select status = 'available' from public.listings where id = (select id from pg_temp.step12_resources where label = 'listing_rollback'))
  and not exists (select 1 from public.notifications where type = 'reservation_accepted'
                  and reservation_id = (select id from pg_temp.step12_runtime where label = 'rollback_reservation')));
select pg_temp.step12_expect_rejected('notification failure rejects the atomic message transaction', 'buyer',
  'select public.send_conversation_message((select id from pg_temp.step12_runtime where label = ''rollback_conversation''), ''Delivery failure message'')', 'XX000');
drop trigger step12_injected_delivery_failure on public.notifications;
select pg_temp.step12_assert('failed message delivery leaves neither message nor notification',
  not exists (select 1 from public.messages where conversation_id = (select id from pg_temp.step12_runtime where label = 'rollback_conversation'))
  and not exists (select 1 from public.notifications where type = 'message'
                  and conversation_id = (select id from pg_temp.step12_runtime where label = 'rollback_conversation')));
select pg_temp.step12_assert('notification messages never include private identity or document fields',
  not exists (select 1 from public.notifications where user_id in (select id from pg_temp.step12_subjects)
              and (message like '%STEP12-%' or message like '%@example.invalid%' or message like '%PRIVATE-%')));

-- Related record deletion retains the recipient notification while clearing
-- unusable foreign references. Cleanup cannot rely on auth deletion cascades.
delete from private.moderation_actions where actor_id in (select id from pg_temp.step12_subjects);
delete from public.reservations where buyer_id in (select id from pg_temp.step12_subjects)
  or seller_id in (select id from pg_temp.step12_subjects);
delete from public.listings where seller_id in (select id from pg_temp.step12_subjects);
select pg_temp.step12_assert('context deletion preserves notification history with nullable links',
  exists (select 1 from public.notifications where type = 'sale_completed')
  and not exists (select 1 from public.notifications where user_id in (select id from pg_temp.step12_subjects)
                  and (listing_id is not null or conversation_id is not null or reservation_id is not null or meetup_id is not null)));
delete from storage.objects where owner_id in (select id::text from pg_temp.step12_subjects);
delete from public.verifications where user_id in (select id from pg_temp.step12_subjects);
delete from public.notifications where user_id in (select id from pg_temp.step12_subjects);
delete from auth.users where id in (select id from pg_temp.step12_subjects);
delete from public.categories where id = (select id from pg_temp.step12_resources where label = 'category');
commit;

select count(*) as tests_run, count(*) filter (where passed) as tests_passed,
  bool_and(passed) as all_passed,
  coalesce(jsonb_agg(jsonb_build_object('scenario', scenario, 'observed', observed)
    order by scenario) filter (where not passed), '[]'::jsonb) as failures
from pg_temp.step12_results;
