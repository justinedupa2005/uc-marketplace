-- Self-contained transactional Step 7 RPC/RLS matrix.
-- All fixtures are deleted before commit. The final row must report true.

begin;
select set_config('storage.allow_delete_query', 'true', true);

create temporary table step7_subjects (
  label text primary key,
  id uuid not null unique,
  verification_status text not null,
  account_status text not null
);

insert into step7_subjects values
  ('seller', gen_random_uuid(), 'verified', 'active'),
  ('buyer', gen_random_uuid(), 'verified', 'active'),
  ('buyer_two', gen_random_uuid(), 'verified', 'active'),
  ('admin', gen_random_uuid(), 'verified', 'active'),
  ('pending', gen_random_uuid(), 'pending', 'active'),
  ('suspended', gen_random_uuid(), 'verified', 'suspended');

create temporary table step7_resources (
  label text primary key,
  id uuid not null unique
);

insert into step7_resources values
  ('category', gen_random_uuid()),
  ('listing', gen_random_uuid()),
  ('image', gen_random_uuid());

create temporary table step7_runtime (
  label text primary key,
  id uuid not null
);

create temporary table step7_results (
  scenario text primary key,
  passed boolean not null,
  observed text not null
);

grant select on pg_temp.step7_subjects to authenticated;
grant select on pg_temp.step7_resources to authenticated;
grant select, insert on pg_temp.step7_runtime to authenticated;
grant select, insert on pg_temp.step7_results to authenticated;

create or replace function pg_temp.step7_expect_rejected(
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
    insert into pg_temp.step7_results values (
      p_scenario, false, 'operation unexpectedly succeeded'
    );
  exception when others then
    insert into pg_temp.step7_results values (
      p_scenario,
      sqlstate = p_expected_state,
      'SQLSTATE ' || sqlstate
    );
  end;
end;
$$;

grant execute on function pg_temp.step7_expect_rejected(text, text, text)
  to authenticated;

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
from pg_temp.step7_subjects;

insert into public.profiles (
  id, full_name, student_id_number, course, year_level,
  role, verification_status, account_status
)
select
  id,
  'Step Seven ' || label,
  'STEP7-' || upper(left(replace(id::text, '-', ''), 12)),
  'BSCS',
  1,
  case when label = 'admin' then 'admin' else 'student' end,
  verification_status,
  account_status
from pg_temp.step7_subjects
on conflict (id) do update set
  full_name = excluded.full_name,
  student_id_number = excluded.student_id_number,
  course = excluded.course,
  year_level = excluded.year_level,
  role = excluded.role,
  verification_status = excluded.verification_status,
  account_status = excluded.account_status;

insert into public.categories (id, name, slug, is_active)
select id, 'Step 7 Security Check', 'step-7-security-' || id::text, true
from pg_temp.step7_resources where label = 'category';

insert into public.listings (
  id, seller_id, category_id, title, description, price, condition, status
)
select
  (select id from pg_temp.step7_resources where label = 'listing'),
  (select id from pg_temp.step7_subjects where label = 'seller'),
  (select id from pg_temp.step7_resources where label = 'category'),
  'Step 7 secured listing',
  'Disposable listing used by the Step 7 interaction security matrix.',
  150,
  'good',
  'available';

insert into public.listing_images (
  id, listing_id, storage_path, is_cover, sort_order
)
select
  (select id from pg_temp.step7_resources where label = 'image'),
  listing.id,
  listing.seller_id::text || '/' || listing.id::text || '/legacy-cover.jpg',
  true,
  0
from public.listings as listing
where listing.id = (
  select id from pg_temp.step7_resources where label = 'listing'
);

insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
select
  'listing-images',
  image.storage_path,
  listing.seller_id,
  listing.seller_id::text,
  '{"mimetype":"image/jpeg","size":128}'::jsonb
from public.listing_images as image
join public.listings as listing on listing.id = image.listing_id
where image.id = (select id from pg_temp.step7_resources where label = 'image');

-- Seller: atomic edit succeeds, direct update and self-interaction fail.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step7_subjects where label = 'seller'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step7_subjects where label = 'seller'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select public.update_owned_listing(
  p_listing_id := (select id from pg_temp.step7_resources where label = 'listing'),
  p_expected_updated_at := (
    select updated_at from public.listings
    where id = (select id from pg_temp.step7_resources where label = 'listing')
  ),
  p_title := 'Updated Step 7 listing',
  p_description := 'Updated safely through the atomic owner listing RPC.',
  p_category_id := (select id from pg_temp.step7_resources where label = 'category'),
  p_price := 0,
  p_condition := 'like_new',
  p_image_paths := array[
    (select storage_path from public.listing_images
     where id = (select id from pg_temp.step7_resources where label = 'image'))
  ]
);

insert into pg_temp.step7_results
select
  'owner atomic edit persists fields and one cover image',
  listing.title = 'Updated Step 7 listing'
    and listing.price = 0
    and listing.condition = 'like_new'
    and (
      select count(*) = 1 and bool_and(is_cover) and min(sort_order) = 0
      from public.listing_images where listing_id = listing.id
    ),
  'listing and image state checked'
from public.listings as listing
where listing.id = (select id from pg_temp.step7_resources where label = 'listing');

select pg_temp.step7_expect_rejected(
  'published listing rejects direct content updates',
  format(
    'update public.listings set title = %L where id = %L::uuid',
    'Direct bypass',
    (select id from pg_temp.step7_resources where label = 'listing')
  ),
  '42501'
);

select pg_temp.step7_expect_rejected(
  'seller cannot favorite own listing',
  format(
    'select public.toggle_listing_favorite(%L::uuid)',
    (select id from pg_temp.step7_resources where label = 'listing')
  ),
  'P0002'
);

select pg_temp.step7_expect_rejected(
  'seller cannot start a conversation with self',
  format(
    'select public.start_listing_conversation(%L::uuid)',
    (select id from pg_temp.step7_resources where label = 'listing')
  ),
  'P0002'
);

reset role;

-- Buyer: favorites, idempotent conversation, message, reservation, report.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step7_subjects where label = 'buyer'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step7_subjects where label = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select public.toggle_listing_favorite(
  (select id from pg_temp.step7_resources where label = 'listing')
);

insert into pg_temp.step7_results
select
  'buyer can favorite an available listing',
  count(*) = 1,
  'favorite state checked'
from public.favorites
where user_id = (select id from pg_temp.step7_subjects where label = 'buyer');

select public.toggle_listing_favorite(
  (select id from pg_temp.step7_resources where label = 'listing')
);

insert into pg_temp.step7_results
select
  'buyer can remove their own favorite',
  count(*) = 0,
  'favorites after removal: ' || count(*)::text
from public.favorites
where user_id = (select id from pg_temp.step7_subjects where label = 'buyer')
  and listing_id = (select id from pg_temp.step7_resources where label = 'listing');

select public.toggle_listing_favorite(
  (select id from pg_temp.step7_resources where label = 'listing')
);

insert into pg_temp.step7_runtime (label, id)
select
  'conversation',
  public.start_listing_conversation(
    (select id from pg_temp.step7_resources where label = 'listing')
  );

insert into pg_temp.step7_results
select
  'conversation creation is idempotent per buyer and listing',
  public.start_listing_conversation(
    (select id from pg_temp.step7_resources where label = 'listing')
  ) = runtime.id
  and (
    select count(*) = 1 from public.conversations
    where listing_id = (select id from pg_temp.step7_resources where label = 'listing')
      and buyer_id = (select id from pg_temp.step7_subjects where label = 'buyer')
  ),
  'conversation identity and count checked'
from pg_temp.step7_runtime as runtime
where runtime.label = 'conversation';

select public.send_conversation_message(
  (select id from pg_temp.step7_runtime where label = 'conversation'),
  'Is this item still available?'
);

insert into pg_temp.step7_results
select
  'buyer can send a message in the listing conversation',
  count(*) = 1,
  'visible messages: ' || count(*)::text
from public.messages
where conversation_id = (
  select id from pg_temp.step7_runtime where label = 'conversation'
);

insert into pg_temp.step7_runtime (label, id)
select
  'buyer_reservation',
  public.request_listing_reservation(
    (select id from pg_temp.step7_resources where label = 'listing')
  );

select pg_temp.step7_expect_rejected(
  'buyer cannot create a duplicate active reservation',
  format(
    'select public.request_listing_reservation(%L::uuid)',
    (select id from pg_temp.step7_resources where label = 'listing')
  ),
  '23505'
);

insert into pg_temp.step7_runtime (label, id)
select
  'buyer_report',
  public.report_listing(
    (select id from pg_temp.step7_resources where label = 'listing'),
    'misleading',
    'The report is private from the seller.'
  );

insert into pg_temp.step7_results
select
  'active duplicate reports reuse one report',
  public.report_listing(
    (select id from pg_temp.step7_resources where label = 'listing'),
    'misleading',
    'A duplicate click should reuse the report.'
  ) = runtime.id
  and (
    select count(*) = 1 from public.listing_reports
    where reporter_id = (select id from pg_temp.step7_subjects where label = 'buyer')
  ),
  'report identity and count checked'
from pg_temp.step7_runtime as runtime
where runtime.label = 'buyer_report';

reset role;

-- Active administrators can review reports without exposing them to sellers.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step7_subjects where label = 'admin'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step7_subjects where label = 'admin'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step7_results
select
  'active admin can review listing reports',
  count(*) = 1,
  'visible reports: ' || count(*)::text
from public.listing_reports
where listing_id = (select id from pg_temp.step7_resources where label = 'listing');

reset role;

-- Second buyer creates a competing pending request while still available.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step7_subjects where label = 'buyer_two'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step7_subjects where label = 'buyer_two'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step7_runtime (label, id)
select
  'buyer_two_reservation',
  public.request_listing_reservation(
    (select id from pg_temp.step7_resources where label = 'listing')
  );

insert into pg_temp.step7_results
select
  'unrelated student cannot read another conversation or messages',
  (select count(*) = 0 from public.conversations)
    and (select count(*) = 0 from public.messages),
  'conversation and message visibility checked';

select pg_temp.step7_expect_rejected(
  'non-owner cannot edit another seller listing through RPC',
  format(
    'select public.update_owned_listing(%L::uuid,now(),%L,%L,%L::uuid,1,%L,array[%L]::text[])',
    (select id from pg_temp.step7_resources where label = 'listing'),
    'Forged edit title',
    'Forged edit description',
    (select id from pg_temp.step7_resources where label = 'category'),
    'good',
    'forged/path.jpg'
  ),
  'P0002'
);

reset role;

-- Seller accepts one request atomically and then completes/removes listing.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step7_subjects where label = 'seller'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step7_subjects where label = 'seller'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select public.respond_to_listing_reservation(
  (select id from pg_temp.step7_runtime where label = 'buyer_reservation'),
  'accepted'
);

insert into pg_temp.step7_results
select
  'acceptance reserves listing and rejects competing pending requests',
  (select status = 'reserved' from public.listings
   where id = (select id from pg_temp.step7_resources where label = 'listing'))
  and (select status = 'accepted' from public.reservations
       where id = (select id from pg_temp.step7_runtime where label = 'buyer_reservation'))
  and (select status = 'rejected' from public.reservations
       where id = (select id from pg_temp.step7_runtime where label = 'buyer_two_reservation')),
  'listing and reservation transitions checked';

insert into pg_temp.step7_results
select
  'seller cannot read private buyer reports',
  count(*) = 0,
  'visible reports: ' || count(*)::text
from public.listing_reports
where listing_id = (select id from pg_temp.step7_resources where label = 'listing');

select public.set_owned_listing_status(
  (select id from pg_temp.step7_resources where label = 'listing'),
  'sold'
);

insert into pg_temp.step7_results
select
  'mark sold completes accepted reservation and preserves listing',
  (select status = 'sold' from public.listings
   where id = (select id from pg_temp.step7_resources where label = 'listing'))
  and (select status = 'completed' from public.reservations
       where id = (select id from pg_temp.step7_runtime where label = 'buyer_reservation')),
  'sold and completed states checked';

reset role;

-- Sold listings leave browsing, but existing participants retain safe context
-- and may continue the established conversation.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step7_subjects where label = 'buyer'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step7_subjects where label = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step7_results
select
  'sold interaction context remains visible only through the safe RPC',
  count(*) = 1
    and bool_and(status = 'sold')
    and bool_and(title = 'Updated Step 7 listing'),
  'context rows: ' || count(*)::text
from public.get_my_listing_interaction_contexts()
where listing_id = (select id from pg_temp.step7_resources where label = 'listing');

select public.send_conversation_message(
  (select id from pg_temp.step7_runtime where label = 'conversation'),
  'Following up after the item was marked sold.'
);

insert into pg_temp.step7_results
select
  'sold listing permits messages only in an existing conversation',
  count(*) = 2,
  'visible messages: ' || count(*)::text
from public.messages
where conversation_id = (
  select id from pg_temp.step7_runtime where label = 'conversation'
);

select pg_temp.step7_expect_rejected(
  'sold listing rejects reservation requests',
  format(
    'select public.request_listing_reservation(%L::uuid)',
    (select id from pg_temp.step7_resources where label = 'listing')
  ),
  'P0002'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step7_subjects where label = 'seller'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step7_subjects where label = 'seller'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select public.set_owned_listing_status(
  (select id from pg_temp.step7_resources where label = 'listing'),
  'removed'
);

insert into pg_temp.step7_results
select
  'soft removal preserves listing row and image metadata',
  listing.status = 'removed'
    and exists (select 1 from public.listing_images where listing_id = listing.id),
  'removed row and image checked'
from public.listings as listing
where listing.id = (select id from pg_temp.step7_resources where label = 'listing');

reset role;

-- Removed listing blocks further buyer interactions and messaging.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step7_subjects where label = 'buyer'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step7_subjects where label = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step7_results
select
  'removed listing disappears from ordinary student reads',
  count(*) = 0,
  'visible listings: ' || count(*)::text
from public.listings
where id = (select id from pg_temp.step7_resources where label = 'listing');

select pg_temp.step7_expect_rejected(
  'removed listing rejects new reservation requests',
  format(
    'select public.request_listing_reservation(%L::uuid)',
    (select id from pg_temp.step7_resources where label = 'listing')
  ),
  'P0002'
);

select pg_temp.step7_expect_rejected(
  'removed listing makes existing conversation read-only',
  format(
    'select public.send_conversation_message(%L::uuid,%L)',
    (select id from pg_temp.step7_runtime where label = 'conversation'),
    'This must be rejected.'
  ),
  'P0002'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step7_subjects where label = 'buyer_two'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step7_subjects where label = 'buyer_two'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.step7_expect_rejected(
  'removed listing rejects a new conversation',
  format(
    'select public.start_listing_conversation(%L::uuid)',
    (select id from pg_temp.step7_resources where label = 'listing')
  ),
  'P0002'
);

reset role;

-- Pending verification is independently enforced by every mutation RPC.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step7_subjects where label = 'pending'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step7_subjects where label = 'pending'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.step7_expect_rejected(
  'pending student cannot mutate marketplace interactions',
  format(
    'select public.toggle_listing_favorite(%L::uuid)',
    (select id from pg_temp.step7_resources where label = 'listing')
  ),
  '42501'
);

reset role;

-- Suspended user cannot invoke marketplace mutation RPCs.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step7_subjects where label = 'suspended'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step7_subjects where label = 'suspended'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.step7_expect_rejected(
  'suspended student cannot mutate marketplace interactions',
  format(
    'select public.toggle_listing_favorite(%L::uuid)',
    (select id from pg_temp.step7_resources where label = 'listing')
  ),
  '42501'
);

reset role;

delete from storage.objects
where bucket_id = 'listing-images'
  and owner_id in (select id::text from pg_temp.step7_subjects);
delete from auth.users where id in (select id from pg_temp.step7_subjects);
delete from public.categories
where id = (select id from pg_temp.step7_resources where label = 'category');

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
from pg_temp.step7_results;
