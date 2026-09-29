-- Self-contained transactional messaging RPC/RLS matrix.
-- Run after 20260927000000_complete_messaging.sql. Realtime is tested
-- separately with two browser sessions after the database-only flow passes.
-- Fixtures are removed before commit. The final row must report all_passed.

begin;

create temporary table step10_messaging_subjects (
  label text primary key,
  id uuid not null unique,
  verification_status text not null,
  account_status text not null
);

insert into step10_messaging_subjects values
  ('seller', gen_random_uuid(), 'verified', 'active'),
  ('buyer', gen_random_uuid(), 'verified', 'active'),
  ('outsider', gen_random_uuid(), 'verified', 'active'),
  ('pending', gen_random_uuid(), 'pending', 'active'),
  ('suspended_buyer', gen_random_uuid(), 'verified', 'suspended'),
  ('suspended_seller', gen_random_uuid(), 'verified', 'suspended');

create temporary table step10_messaging_resources (
  label text primary key,
  id uuid not null unique
);

insert into step10_messaging_resources values
  ('category', gen_random_uuid()),
  ('listing_available', gen_random_uuid()),
  ('listing_sold_without_thread', gen_random_uuid()),
  ('listing_sold_with_thread', gen_random_uuid()),
  ('listing_removed_with_thread', gen_random_uuid()),
  ('listing_suspended_buyer_thread', gen_random_uuid()),
  ('listing_suspended_seller', gen_random_uuid());

create temporary table step10_messaging_runtime (
  label text primary key,
  id uuid not null unique
);

create temporary table step10_messaging_results (
  scenario text primary key,
  passed boolean not null,
  observed text not null
);

grant select on pg_temp.step10_messaging_subjects to anon, authenticated;
grant select on pg_temp.step10_messaging_resources to anon, authenticated;
grant select, insert on pg_temp.step10_messaging_runtime to authenticated;
grant select, insert on pg_temp.step10_messaging_results to anon, authenticated;

create or replace function pg_temp.step10_messaging_expect_rejected(
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
    insert into pg_temp.step10_messaging_results values (
      p_scenario,
      false,
      'operation unexpectedly succeeded'
    );
  exception when others then
    insert into pg_temp.step10_messaging_results values (
      p_scenario,
      sqlstate = p_expected_state,
      'SQLSTATE ' || sqlstate
    );
  end;
end;
$$;

grant execute on function pg_temp.step10_messaging_expect_rejected(
  text, text, text
) to anon, authenticated;

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
from pg_temp.step10_messaging_subjects;

insert into public.profiles (
  id, full_name, student_id_number, course, year_level, avatar_path,
  role, verification_status, account_status
)
select
  id,
  'Step Ten ' || replace(label, '_', ' '),
  'STEP10-' || upper(left(replace(id::text, '-', ''), 12)),
  'BSCS',
  1,
  id::text || '/avatar.png',
  'student',
  verification_status,
  account_status
from pg_temp.step10_messaging_subjects
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
  'Step 10 Messaging ' || left(replace(id::text, '-', ''), 12),
  'step-10-messaging-' || id::text,
  true
from pg_temp.step10_messaging_resources
where label = 'category';

insert into public.listings (
  id, seller_id, category_id, title, description,
  price, condition, status, created_at, updated_at
)
select
  resource.id,
  case
    when resource.label = 'listing_suspended_seller' then (
      select id from pg_temp.step10_messaging_subjects
      where label = 'suspended_seller'
    )
    else (
      select id from pg_temp.step10_messaging_subjects where label = 'seller'
    )
  end,
  (select id from pg_temp.step10_messaging_resources where label = 'category'),
  'Step 10 ' || replace(resource.label, '_', ' '),
  'Disposable listing used by the focused messaging security matrix.',
  700,
  'good',
  case
    when resource.label in (
      'listing_sold_without_thread', 'listing_sold_with_thread'
    ) then 'sold'
    when resource.label = 'listing_removed_with_thread' then 'removed'
    else 'available'
  end,
  now() - interval '2 hours',
  now() - interval '2 hours'
from pg_temp.step10_messaging_resources as resource
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
  from pg_temp.step10_messaging_resources
  where label like 'listing_%'
);

-- These existing threads exercise sold/removed history and a participant whose
-- account became suspended after the thread was established.
insert into public.conversations (
  id, listing_id, buyer_id, seller_id, created_at, updated_at
)
select
  gen_random_uuid(),
  resource.id,
  case
    when resource.label = 'listing_suspended_buyer_thread' then (
      select id from pg_temp.step10_messaging_subjects
      where label = 'suspended_buyer'
    )
    else (
      select id from pg_temp.step10_messaging_subjects where label = 'buyer'
    )
  end,
  (select id from pg_temp.step10_messaging_subjects where label = 'seller'),
  now() - interval '1 hour',
  now() - interval '1 hour'
from pg_temp.step10_messaging_resources as resource
where resource.label in (
  'listing_sold_with_thread',
  'listing_removed_with_thread',
  'listing_suspended_buyer_thread'
)
returning id;

insert into pg_temp.step10_messaging_runtime (label, id)
select
  case listing.status
    when 'sold' then 'sold_conversation'
    when 'removed' then 'removed_conversation'
    else 'suspended_buyer_conversation'
  end,
  conversation.id
from public.conversations as conversation
join public.listings as listing on listing.id = conversation.listing_id
where conversation.listing_id in (
  select id
  from pg_temp.step10_messaging_resources
  where label in (
    'listing_sold_with_thread',
    'listing_removed_with_thread',
    'listing_suspended_buyer_thread'
  )
);

-- Anonymous callers cannot read or invoke any messaging surface.
set local role anon;

select pg_temp.step10_messaging_expect_rejected(
  'anonymous user cannot read conversations',
  'select count(*) from public.conversations',
  '42501'
);

select pg_temp.step10_messaging_expect_rejected(
  'anonymous user cannot read messages',
  'select count(*) from public.messages',
  '42501'
);

select pg_temp.step10_messaging_expect_rejected(
  'anonymous user cannot read conversation summaries',
  'select count(*) from public.get_my_conversation_summaries()',
  '42501'
);

reset role;

-- The buyer creates one available-listing thread and a real database message.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step10_messaging_subjects where label = 'buyer'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step10_messaging_subjects where label = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step10_messaging_runtime (label, id)
select
  'available_conversation',
  public.start_listing_conversation(
    (select id from pg_temp.step10_messaging_resources
     where label = 'listing_available')
  );

insert into pg_temp.step10_messaging_results
select
  'available conversation creation is idempotent',
  public.start_listing_conversation(
    (select id from pg_temp.step10_messaging_resources
     where label = 'listing_available')
  ) = runtime.id
  and (
    select count(*) = 1
    from public.conversations
    where listing_id = (
      select id from pg_temp.step10_messaging_resources
      where label = 'listing_available'
    )
      and buyer_id = (
        select id from pg_temp.step10_messaging_subjects where label = 'buyer'
      )
  ),
  'conversation identity and row count checked'
from pg_temp.step10_messaging_runtime as runtime
where runtime.label = 'available_conversation';

insert into pg_temp.step10_messaging_runtime (label, id)
select
  'buyer_message',
  public.send_conversation_message(
    (select id from pg_temp.step10_messaging_runtime
     where label = 'available_conversation'),
    '   Is this still available?   '
  );

insert into pg_temp.step10_messaging_results
select
  'send derives sender trims body and starts unread',
  message.sender_id = (
    select id from pg_temp.step10_messaging_subjects where label = 'buyer'
  )
    and message.body = 'Is this still available?'
    and message.read_at is null,
  'stored sender, body, and read_at checked'
from public.messages as message
where message.id = (
  select id from pg_temp.step10_messaging_runtime where label = 'buyer_message'
);

select pg_temp.step10_messaging_expect_rejected(
  'database rejects a whitespace-only message',
  format(
    'select public.send_conversation_message(%L::uuid,%L)',
    (select id from pg_temp.step10_messaging_runtime
     where label = 'available_conversation'),
    E' \n \t '
  ),
  '22023'
);

select pg_temp.step10_messaging_expect_rejected(
  'database rejects a message over two thousand characters',
  format(
    'select public.send_conversation_message(%L::uuid,%L)',
    (select id from pg_temp.step10_messaging_runtime
     where label = 'available_conversation'),
    repeat('x', 2001)
  ),
  '22023'
);

insert into pg_temp.step10_messaging_results
select
  'buyer summary exposes only its thread aggregate',
  count(*) = 1
    and bool_and(other_user_id = (
      select id from pg_temp.step10_messaging_subjects where label = 'seller'
    ))
    and bool_and(other_user_name = 'Step Ten seller')
    and bool_and(other_user_is_verified)
    and bool_and(listing_status = 'available')
    and bool_and(listing_price = 700)
    and bool_and(listing_image_path is not null)
    and bool_and(last_message_body = 'Is this still available?')
    and bool_and(unread_count = 0)
    and bool_and(can_send),
  'available conversation summary checked'
from public.get_my_conversation_summaries(
  (select id from pg_temp.step10_messaging_runtime
   where label = 'available_conversation')
);

insert into pg_temp.step10_messaging_results
select
  'sold thread is reusable and removed thread is not reopened',
  public.start_listing_conversation(
    (select id from pg_temp.step10_messaging_resources
     where label = 'listing_sold_with_thread')
  ) = (
    select id from pg_temp.step10_messaging_runtime
    where label = 'sold_conversation'
  ),
  'existing sold conversation identity checked';

select pg_temp.step10_messaging_expect_rejected(
  'sold listing rejects a new conversation',
  format(
    'select public.start_listing_conversation(%L::uuid)',
    (select id from pg_temp.step10_messaging_resources
     where label = 'listing_sold_without_thread')
  ),
  'P0002'
);

select pg_temp.step10_messaging_expect_rejected(
  'removed listing rejects reopening an existing conversation',
  format(
    'select public.start_listing_conversation(%L::uuid)',
    (select id from pg_temp.step10_messaging_resources
     where label = 'listing_removed_with_thread')
  ),
  'P0002'
);

select public.send_conversation_message(
  (select id from pg_temp.step10_messaging_runtime
   where label = 'sold_conversation'),
  'Sold-listing follow-up remains available.'
);

select pg_temp.step10_messaging_expect_rejected(
  'removed listing makes its conversation read-only',
  format(
    'select public.send_conversation_message(%L::uuid,%L)',
    (select id from pg_temp.step10_messaging_runtime
     where label = 'removed_conversation'),
    'This must not be stored.'
  ),
  'P0002'
);

insert into pg_temp.step10_messaging_results
select
  'sold and removed summaries preserve safe history context',
  count(*) = 2
    and count(*) filter (
      where listing_status = 'sold'
        and can_send
        and listing_image_path is null
    ) = 1
    and count(*) filter (
      where listing_status = 'removed'
        and not can_send
        and listing_image_path is null
    ) = 1,
  'sold/removed summary states and buyer image boundary checked'
from public.get_my_conversation_summaries()
where conversation_id in (
  (select id from pg_temp.step10_messaging_runtime
   where label = 'sold_conversation'),
  (select id from pg_temp.step10_messaging_runtime
   where label = 'removed_conversation')
);

select pg_temp.step10_messaging_expect_rejected(
  'authenticated users cannot forge message senders',
  format(
    'insert into public.messages (conversation_id,sender_id,body) values (%L::uuid,%L::uuid,%L)',
    (select id from pg_temp.step10_messaging_runtime
     where label = 'available_conversation'),
    (select id from pg_temp.step10_messaging_subjects where label = 'outsider'),
    'Forged sender'
  ),
  '42501'
);

select pg_temp.step10_messaging_expect_rejected(
  'authenticated users cannot forge conversation participants',
  format(
    'insert into public.conversations (listing_id,buyer_id,seller_id) values (%L::uuid,%L::uuid,%L::uuid)',
    (select id from pg_temp.step10_messaging_resources
     where label = 'listing_available'),
    (select id from pg_temp.step10_messaging_subjects where label = 'buyer'),
    (select id from pg_temp.step10_messaging_subjects where label = 'outsider')
  ),
  '42501'
);

select pg_temp.step10_messaging_expect_rejected(
  'authenticated users cannot edit message content',
  format(
    'update public.messages set body = %L where id = %L::uuid',
    'Edited content',
    (select id from pg_temp.step10_messaging_runtime where label = 'buyer_message')
  ),
  '42501'
);

select pg_temp.step10_messaging_expect_rejected(
  'authenticated users cannot set read timestamps directly',
  format(
    'update public.messages set read_at = now() where id = %L::uuid',
    (select id from pg_temp.step10_messaging_runtime where label = 'buyer_message')
  ),
  '42501'
);

select pg_temp.step10_messaging_expect_rejected(
  'authenticated users cannot delete messages',
  format(
    'delete from public.messages where id = %L::uuid',
    (select id from pg_temp.step10_messaging_runtime where label = 'buyer_message')
  ),
  '42501'
);

reset role;

-- Give the first message a deterministic earlier time inside this single test
-- transaction so the later seller reply is unambiguously the newest message.
update public.messages
set created_at = now() - interval '2 minutes'
where id = (
  select id from pg_temp.step10_messaging_runtime where label = 'buyer_message'
);

-- The seller sees one unread incoming message, marks exactly that row, and
-- cannot accidentally mark their own reply through recipient logic.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step10_messaging_subjects where label = 'seller'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step10_messaging_subjects where label = 'seller'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.step10_messaging_expect_rejected(
  'seller cannot start a conversation with self',
  format(
    'select public.start_listing_conversation(%L::uuid)',
    (select id from pg_temp.step10_messaging_resources
     where label = 'listing_available')
  ),
  'P0002'
);

insert into pg_temp.step10_messaging_results
select
  'recipient summary counts only incoming unread messages',
  count(*) = 1
    and bool_and(unread_count = 1)
    and bool_and(last_message_body = 'Is this still available?'),
  'seller unread count and latest body checked'
from public.get_my_conversation_summaries(
  (select id from pg_temp.step10_messaging_runtime
   where label = 'available_conversation')
);

insert into pg_temp.step10_messaging_results values (
  'recipient mark-read updates one incoming message',
  public.mark_conversation_read(
    (select id from pg_temp.step10_messaging_runtime
     where label = 'available_conversation')
  ) = 1,
  'affected-row count checked'
);

insert into pg_temp.step10_messaging_results
select
  'mark-read stores a timestamp and is idempotent',
  message.read_at is not null
    and public.mark_conversation_read(message.conversation_id) = 0,
  'read_at and second affected-row count checked'
from public.messages as message
where message.id = (
  select id from pg_temp.step10_messaging_runtime where label = 'buyer_message'
);

insert into pg_temp.step10_messaging_runtime (label, id)
select
  'seller_message',
  public.send_conversation_message(
    (select id from pg_temp.step10_messaging_runtime
     where label = 'available_conversation'),
    'Yes, it is available.'
  );

insert into pg_temp.step10_messaging_results values (
  'sender cannot mark their own new message through recipient logic',
  public.mark_conversation_read(
    (select id from pg_temp.step10_messaging_runtime
     where label = 'available_conversation')
  ) = 0,
  'sender-side affected-row count checked'
);

insert into pg_temp.step10_messaging_results
select
  'suspended other participant remains a safe summary fallback',
  count(*) = 1
    and bool_and(other_user_id = (
      select id from pg_temp.step10_messaging_subjects
      where label = 'suspended_buyer'
    ))
    and bool_and(other_user_name = 'Former UC Student')
    and bool_and(other_user_avatar_path is null)
    and bool_and(not other_user_is_verified)
    and bool_and(not can_send),
  'neutral identity fallback and send state checked'
from public.get_my_conversation_summaries(
  (select id from pg_temp.step10_messaging_runtime
   where label = 'suspended_buyer_conversation')
);

select pg_temp.step10_messaging_expect_rejected(
  'active participant cannot message a suspended participant',
  format(
    'select public.send_conversation_message(%L::uuid,%L)',
    (select id from pg_temp.step10_messaging_runtime
     where label = 'suspended_buyer_conversation'),
    'This must not be stored.'
  ),
  'P0002'
);

reset role;

-- The buyer reads the seller reply; their original outgoing message is not
-- altered by this recipient-side call.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step10_messaging_subjects where label = 'buyer'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step10_messaging_subjects where label = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step10_messaging_results
select
  'buyer sees the seller reply as newest and unread',
  count(*) = 1
    and bool_and(last_message_body = 'Yes, it is available.')
    and bool_and(unread_count = 1),
  'latest-message and unread aggregate checked'
from public.get_my_conversation_summaries(
  (select id from pg_temp.step10_messaging_runtime
   where label = 'available_conversation')
);

insert into pg_temp.step10_messaging_results values (
  'buyer mark-read updates only the seller reply',
  public.mark_conversation_read(
    (select id from pg_temp.step10_messaging_runtime
     where label = 'available_conversation')
  ) = 1,
  'affected-row count checked'
);

insert into pg_temp.step10_messaging_results
select
  'both received messages have recipient read timestamps',
  count(*) = 2 and count(*) filter (where read_at is not null) = 2,
  'read timestamps: '
    || count(*) filter (where read_at is not null)::text
from public.messages
where conversation_id = (
  select id from pg_temp.step10_messaging_runtime
  where label = 'available_conversation'
);

reset role;

-- An unrelated verified student receives no rows and cannot mutate the thread.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step10_messaging_subjects where label = 'outsider'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step10_messaging_subjects where label = 'outsider'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step10_messaging_results
select
  'unrelated student cannot read conversations messages or summaries',
  (select count(*) = 0 from public.conversations)
    and (select count(*) = 0 from public.messages)
    and (
      select count(*) = 0
      from public.get_my_conversation_summaries(
        (select id from pg_temp.step10_messaging_runtime
         where label = 'available_conversation')
      )
    ),
  'all participant-scoped reads returned zero rows';

select pg_temp.step10_messaging_expect_rejected(
  'unrelated student cannot send into another conversation',
  format(
    'select public.send_conversation_message(%L::uuid,%L)',
    (select id from pg_temp.step10_messaging_runtime
     where label = 'available_conversation'),
    'Unauthorized message'
  ),
  'P0002'
);

select pg_temp.step10_messaging_expect_rejected(
  'unrelated student cannot mark another conversation read',
  format(
    'select public.mark_conversation_read(%L::uuid)',
    (select id from pg_temp.step10_messaging_runtime
     where label = 'available_conversation')
  ),
  'P0002'
);

select pg_temp.step10_messaging_expect_rejected(
  'active buyer cannot start a thread with a suspended seller',
  format(
    'select public.start_listing_conversation(%L::uuid)',
    (select id from pg_temp.step10_messaging_resources
     where label = 'listing_suspended_seller')
  ),
  'P0002'
);

reset role;

-- Pending and suspended callers fail the live-profile gate even when a row for
-- the suspended participant already exists.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step10_messaging_subjects where label = 'pending'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step10_messaging_subjects where label = 'pending'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.step10_messaging_expect_rejected(
  'pending student cannot start a conversation',
  format(
    'select public.start_listing_conversation(%L::uuid)',
    (select id from pg_temp.step10_messaging_resources
     where label = 'listing_available')
  ),
  '42501'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step10_messaging_subjects
   where label = 'suspended_buyer'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step10_messaging_subjects
            where label = 'suspended_buyer'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step10_messaging_results
select
  'suspended participant cannot read messaging rows or summaries',
  (select count(*) = 0 from public.conversations)
    and (select count(*) = 0 from public.messages)
    and (select count(*) = 0 from public.get_my_conversation_summaries()),
  'live-profile read gates returned zero rows';

select pg_temp.step10_messaging_expect_rejected(
  'suspended participant cannot send messages',
  format(
    'select public.send_conversation_message(%L::uuid,%L)',
    (select id from pg_temp.step10_messaging_runtime
     where label = 'suspended_buyer_conversation'),
    'Suspended message'
  ),
  '42501'
);

select pg_temp.step10_messaging_expect_rejected(
  'suspended participant cannot mark messages read',
  format(
    'select public.mark_conversation_read(%L::uuid)',
    (select id from pg_temp.step10_messaging_runtime
     where label = 'suspended_buyer_conversation')
  ),
  '42501'
);

reset role;

delete from public.reservations
where buyer_id in (select id from pg_temp.step10_messaging_subjects)
  or seller_id in (select id from pg_temp.step10_messaging_subjects);
delete from public.listings
where seller_id in (select id from pg_temp.step10_messaging_subjects);
delete from auth.users
where id in (select id from pg_temp.step10_messaging_subjects);
delete from public.categories
where id = (
  select id from pg_temp.step10_messaging_resources where label = 'category'
);

commit;

select
  count(*) as tests_run,
  count(*) filter (where passed) as tests_passed,
  bool_and(passed) as all_passed,
  coalesce(
    jsonb_agg(
      jsonb_build_object('scenario', scenario, 'observed', observed)
      order by scenario
    ) filter (where not passed),
    '[]'::jsonb
  ) as failures
from pg_temp.step10_messaging_results;
