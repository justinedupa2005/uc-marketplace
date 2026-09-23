-- Self-contained transactional RLS matrix for Step 5.
--
-- The script creates disposable Auth users and marketplace records, executes
-- requests as the real `authenticated` database role, removes every fixture,
-- and commits only the cleanup plus temporary results. An unexpected error
-- aborts the transaction, so no fixture can be partially committed.
--
-- Run only after authorization_hardening_security.sql reports all true.

begin;

-- Supabase Storage blocks direct SQL deletes by default. This transaction-
-- local flag is used only so DELETE statements can reach RLS and so fixture
-- objects can be cleaned up. It does not alter the deployed Storage service.
select set_config('storage.allow_delete_query', 'true', true);

create temporary table authz_subjects (
  label text primary key,
  id uuid not null unique,
  account_role text not null,
  verification_status text not null,
  account_status text not null
);

insert into authz_subjects (
  label,
  id,
  account_role,
  verification_status,
  account_status
)
values
  ('unverified', gen_random_uuid(), 'student', 'unverified', 'active'),
  ('pending', gen_random_uuid(), 'student', 'pending', 'active'),
  ('rejected', gen_random_uuid(), 'student', 'rejected', 'active'),
  ('verified_a', gen_random_uuid(), 'student', 'verified', 'active'),
  ('verified_b', gen_random_uuid(), 'student', 'verified', 'active'),
  ('suspended_student', gen_random_uuid(), 'student', 'verified', 'suspended'),
  ('disabled_student', gen_random_uuid(), 'student', 'verified', 'disabled'),
  ('active_admin', gen_random_uuid(), 'admin', 'unverified', 'active'),
  ('suspended_admin', gen_random_uuid(), 'admin', 'unverified', 'suspended');

create temporary table authz_resources (
  label text primary key,
  id uuid not null unique
);

insert into authz_resources (label, id)
values
  ('category', gen_random_uuid()),
  ('a_available', gen_random_uuid()),
  ('a_sold', gen_random_uuid()),
  ('a_removed', gen_random_uuid()),
  ('a_delete', gen_random_uuid()),
  ('a_created', gen_random_uuid()),
  ('a_forged', gen_random_uuid()),
  ('b_available', gen_random_uuid()),
  ('b_sold', gen_random_uuid()),
  ('admin_target', gen_random_uuid()),
  ('suspended_listing', gen_random_uuid()),
  ('disabled_listing', gen_random_uuid()),
  ('unverified_attempt', gen_random_uuid()),
  ('pending_attempt', gen_random_uuid()),
  ('rejected_attempt', gen_random_uuid()),
  ('suspended_attempt', gen_random_uuid()),
  ('admin_attempt', gen_random_uuid()),
  ('pending_verification', gen_random_uuid()),
  ('rejected_verification', gen_random_uuid()),
  ('a_available_image', gen_random_uuid()),
  ('a_removed_image', gen_random_uuid()),
  ('b_sold_image', gen_random_uuid()),
  ('admin_target_image', gen_random_uuid());

create temporary table authz_results (
  scenario text primary key,
  passed boolean not null,
  observed text not null
);

grant select on table pg_temp.authz_subjects to authenticated;
grant select on table pg_temp.authz_resources to authenticated;
grant select, insert on table pg_temp.authz_results to authenticated;

create or replace function pg_temp.expect_denied(
  p_scenario text,
  p_statement text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  begin
    execute p_statement;
    insert into pg_temp.authz_results (scenario, passed, observed)
    values (p_scenario, false, 'operation unexpectedly succeeded');
  exception
    when others then
      insert into pg_temp.authz_results (scenario, passed, observed)
      values (
        p_scenario,
        sqlstate = '42501',
        'SQLSTATE ' || sqlstate
      );
  end;
end;
$$;

grant execute on function pg_temp.expect_denied(text, text) to authenticated;

-- Auth rows trigger the production profile-creation workflow. The later
-- upsert makes the fixtures deterministic without weakening that trigger.
insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
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
from pg_temp.authz_subjects;

insert into public.profiles (
  id,
  full_name,
  student_id_number,
  course,
  year_level,
  role,
  verification_status,
  account_status
)
select
  id,
  'Authorization Test ' || label,
  'AUTH-' || upper(left(replace(id::text, '-', ''), 12)),
  'BSCS',
  1,
  account_role,
  verification_status,
  account_status
from pg_temp.authz_subjects
on conflict (id) do update
set
  full_name = excluded.full_name,
  student_id_number = excluded.student_id_number,
  course = excluded.course,
  year_level = excluded.year_level,
  role = excluded.role,
  verification_status = excluded.verification_status,
  account_status = excluded.account_status;

insert into public.categories (id, name, slug, is_active)
select
  id,
  'Authorization Test ' || left(id::text, 8),
  'authorization-test-' || id::text,
  true
from pg_temp.authz_resources
where label = 'category';

-- Verification history fixtures. Insert while the students are eligible for
-- the real pending trigger, then establish the intended final status.
update public.profiles
set verification_status = 'unverified'
where id in (
  select id
  from pg_temp.authz_subjects
  where label in ('pending', 'rejected')
);

insert into public.verifications (
  id,
  user_id,
  full_name_snapshot,
  student_id_number_snapshot,
  course_snapshot,
  year_level_snapshot,
  document_path,
  status
)
select
  resource.id,
  subject.id,
  'Authorization Test ' || subject.label,
  'AUTH-' || upper(left(replace(subject.id::text, '-', ''), 12)),
  'BSCS',
  1,
  subject.id::text || '/' || resource.id::text || '/student-id.png',
  'pending'
from pg_temp.authz_subjects as subject
join pg_temp.authz_resources as resource
  on resource.label = subject.label || '_verification'
where subject.label in ('pending', 'rejected');

update public.verifications
set
  status = 'rejected',
  rejection_reason = 'Authorization test rejection',
  reviewed_by = (
    select id from pg_temp.authz_subjects where label = 'active_admin'
  ),
  reviewed_at = now()
where id = (
  select id
  from pg_temp.authz_resources
  where label = 'rejected_verification'
);

update public.profiles as profile
set verification_status = subject.verification_status
from pg_temp.authz_subjects as subject
where profile.id = subject.id;

-- Seed listings as the database owner so later requests test only RLS.
insert into public.listings (
  id,
  seller_id,
  category_id,
  title,
  description,
  price,
  condition,
  status
)
select
  resource.id,
  subject.id,
  (select id from pg_temp.authz_resources where label = 'category'),
  'Authorization fixture ' || resource.label,
  'Disposable row used by the Step 5 RLS matrix.',
  1,
  'good',
  case resource.label
    when 'a_sold' then 'sold'
    when 'a_removed' then 'removed'
    when 'b_sold' then 'sold'
    else 'available'
  end
from pg_temp.authz_resources as resource
join pg_temp.authz_subjects as subject
  on subject.label = case
    when resource.label like 'a_%' then 'verified_a'
    when resource.label like 'b_%' then 'verified_b'
    when resource.label = 'admin_target' then 'verified_b'
    when resource.label = 'suspended_listing' then 'suspended_student'
    when resource.label = 'disabled_listing' then 'disabled_student'
  end
where resource.label in (
  'a_available',
  'a_sold',
  'a_removed',
  'a_delete',
  'b_available',
  'b_sold',
  'admin_target',
  'suspended_listing',
  'disabled_listing'
);

insert into public.listing_images (
  id,
  listing_id,
  storage_path,
  is_cover,
  sort_order
)
select
  image.id,
  listing.id,
  subject.id::text || '/' || listing.id::text || '/cover.jpg',
  true,
  0
from (
  values
    ('a_available_image', 'a_available', 'verified_a'),
    ('a_removed_image', 'a_removed', 'verified_a'),
    ('b_sold_image', 'b_sold', 'verified_b'),
    ('admin_target_image', 'admin_target', 'verified_b')
) as fixture(image_label, listing_label, subject_label)
join pg_temp.authz_resources as image on image.label = fixture.image_label
join pg_temp.authz_resources as listing on listing.label = fixture.listing_label
join pg_temp.authz_subjects as subject on subject.label = fixture.subject_label;

insert into storage.objects (
  bucket_id,
  name,
  owner,
  owner_id,
  metadata
)
select
  'listing-images',
  image.storage_path,
  listing.seller_id,
  listing.seller_id::text,
  '{"mimetype":"image/jpeg","size":128}'::jsonb
from public.listing_images as image
join public.listings as listing on listing.id = image.listing_id
where image.id in (
  select id
  from pg_temp.authz_resources
  where label in (
    'a_available_image',
    'a_removed_image',
    'b_sold_image',
    'admin_target_image'
  )
);

-- -------------------------------------------------------------------------
-- Unverified student
-- -------------------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.authz_subjects where label = 'unverified'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.authz_subjects where label = 'unverified'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.authz_results
select
  'unverified student can read only own profile',
  count(*) = 1,
  'visible profiles: ' || count(*)::text
from public.profiles;

insert into pg_temp.authz_results
select
  'unverified student cannot browse categories',
  count(*) = 0,
  'visible categories: ' || count(*)::text
from public.categories;

insert into pg_temp.authz_results
select
  'unverified student cannot browse listings',
  count(*) = 0,
  'visible listings: ' || count(*)::text
from public.listings;

insert into pg_temp.authz_results
select
  'unverified student cannot read listing image objects',
  count(*) = 0,
  'visible objects: ' || count(*)::text
from storage.objects
where bucket_id = 'listing-images'
  and owner_id in (select id::text from pg_temp.authz_subjects);

select pg_temp.expect_denied(
  'unverified student cannot create listing',
  format(
    'insert into public.listings (id,seller_id,category_id,title,description,price,condition,status) values (%L::uuid,%L::uuid,%L::uuid,%L,%L,1,%L,%L)',
    (select id from pg_temp.authz_resources where label = 'unverified_attempt'),
    (select id from pg_temp.authz_subjects where label = 'unverified'),
    (select id from pg_temp.authz_resources where label = 'category'),
    'Denied listing',
    'RLS test',
    'good',
    'available'
  )
);

select pg_temp.expect_denied(
  'student cannot update protected profile fields',
  format(
    'update public.profiles set role = %L where id = %L::uuid',
    'admin',
    (select id from pg_temp.authz_subjects where label = 'unverified')
  )
);

reset role;

-- -------------------------------------------------------------------------
-- Pending and rejected students
-- -------------------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.authz_subjects where label = 'pending'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.authz_subjects where label = 'pending'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.authz_results
select
  'pending student can read own verification',
  count(*) = 1,
  'visible verification rows: ' || count(*)::text
from public.verifications;

insert into pg_temp.authz_results
select
  'pending student cannot browse marketplace',
  count(*) = 0,
  'visible listings: ' || count(*)::text
from public.listings;

select pg_temp.expect_denied(
  'pending student cannot create listing',
  format(
    'insert into public.listings (id,seller_id,category_id,title,description,price,condition,status) values (%L::uuid,%L::uuid,%L::uuid,%L,%L,1,%L,%L)',
    (select id from pg_temp.authz_resources where label = 'pending_attempt'),
    (select id from pg_temp.authz_subjects where label = 'pending'),
    (select id from pg_temp.authz_resources where label = 'category'),
    'Denied listing',
    'RLS test',
    'good',
    'available'
  )
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.authz_subjects where label = 'rejected'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.authz_subjects where label = 'rejected'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.authz_results
select
  'rejected student can read rejection history',
  count(*) = 1 and bool_and(status = 'rejected'),
  'visible rejected rows: ' || count(*)::text
from public.verifications;

insert into pg_temp.authz_results
select
  'rejected student cannot browse marketplace',
  count(*) = 0,
  'visible listings: ' || count(*)::text
from public.listings;

select pg_temp.expect_denied(
  'rejected student cannot create listing',
  format(
    'insert into public.listings (id,seller_id,category_id,title,description,price,condition,status) values (%L::uuid,%L::uuid,%L::uuid,%L,%L,1,%L,%L)',
    (select id from pg_temp.authz_resources where label = 'rejected_attempt'),
    (select id from pg_temp.authz_subjects where label = 'rejected'),
    (select id from pg_temp.authz_resources where label = 'category'),
    'Denied listing',
    'RLS test',
    'good',
    'available'
  )
);

reset role;

-- -------------------------------------------------------------------------
-- Verified students and ownership
-- -------------------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.authz_subjects where label = 'verified_a'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.authz_subjects where label = 'verified_a'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.authz_results
select
  'verified student can browse active categories',
  exists (
    select 1
    from public.categories
    where id = (select id from pg_temp.authz_resources where label = 'category')
  ),
  'fixture category visibility checked';

insert into pg_temp.authz_results
select
  'verified student sees public listing and own history only',
  exists (
    select 1 from public.listings
    where id = (select id from pg_temp.authz_resources where label = 'b_available')
  )
  and exists (
    select 1 from public.listings
    where id = (select id from pg_temp.authz_resources where label = 'a_sold')
  )
  and exists (
    select 1 from public.listings
    where id = (select id from pg_temp.authz_resources where label = 'a_removed')
  )
  and not exists (
    select 1 from public.listings
    where id = (select id from pg_temp.authz_resources where label = 'b_sold')
  ),
  'targeted listing visibility checked';

with created as (
  insert into public.listings (
    id,
    seller_id,
    category_id,
    title,
    description,
    price,
    condition,
    status
  )
  values (
    (select id from pg_temp.authz_resources where label = 'a_created'),
    (select id from pg_temp.authz_subjects where label = 'verified_a'),
    (select id from pg_temp.authz_resources where label = 'category'),
    'Allowed listing',
    'Created by a verified active student.',
    1,
    'good',
    'available'
  )
  returning 1
)
insert into pg_temp.authz_results
select
  'verified student can create own listing',
  count(*) = 1,
  'created rows: ' || count(*)::text
from created;

select pg_temp.expect_denied(
  'verified student cannot create listing for another seller',
  format(
    'insert into public.listings (id,seller_id,category_id,title,description,price,condition,status) values (%L::uuid,%L::uuid,%L::uuid,%L,%L,1,%L,%L)',
    (select id from pg_temp.authz_resources where label = 'a_forged'),
    (select id from pg_temp.authz_subjects where label = 'verified_b'),
    (select id from pg_temp.authz_resources where label = 'category'),
    'Forged listing',
    'RLS test',
    'good',
    'available'
  )
);

with changed as (
  update public.listings
  set title = 'Allowed owner update'
  where id = (select id from pg_temp.authz_resources where label = 'a_available')
  returning 1
)
insert into pg_temp.authz_results
select
  'verified student can update own listing',
  count(*) = 1,
  'updated rows: ' || count(*)::text
from changed;

with changed as (
  update public.listings
  set title = 'Forbidden cross-owner update'
  where id = (select id from pg_temp.authz_resources where label = 'b_available')
  returning 1
)
insert into pg_temp.authz_results
select
  'verified student cannot update another seller listing',
  count(*) = 0,
  'updated rows: ' || count(*)::text
from changed;

with removed as (
  delete from public.listings
  where id = (select id from pg_temp.authz_resources where label = 'b_available')
  returning 1
)
insert into pg_temp.authz_results
select
  'verified student cannot delete another seller listing',
  count(*) = 0,
  'deleted rows: ' || count(*)::text
from removed;

with removed as (
  delete from public.listings
  where id = (select id from pg_temp.authz_resources where label = 'a_delete')
  returning 1
)
insert into pg_temp.authz_results
select
  'verified student can delete own non-removed listing',
  count(*) = 1,
  'deleted rows: ' || count(*)::text
from removed;

select pg_temp.expect_denied(
  'verified student cannot transfer listing ownership',
  format(
    'update public.listings set seller_id = %L::uuid where id = %L::uuid',
    (select id from pg_temp.authz_subjects where label = 'verified_b'),
    (select id from pg_temp.authz_resources where label = 'a_available')
  )
);

insert into pg_temp.authz_results
select
  'verified student can read authorized image metadata',
  exists (
    select 1 from public.listing_images
    where id = (
      select id from pg_temp.authz_resources where label = 'a_available_image'
    )
  )
  and not exists (
    select 1 from public.listing_images
    where id = (
      select id from pg_temp.authz_resources where label = 'b_sold_image'
    )
  ),
  'targeted image visibility checked';

with changed as (
  update public.listing_images
  set is_cover = false
  where id = (
    select id from pg_temp.authz_resources where label = 'a_available_image'
  )
  returning 1
)
insert into pg_temp.authz_results
select
  'verified owner can update own image metadata',
  count(*) = 1,
  'updated rows: ' || count(*)::text
from changed;

with removed as (
  delete from public.listing_images
  where id = (
    select id from pg_temp.authz_resources where label = 'a_removed_image'
  )
  returning 1
)
insert into pg_temp.authz_results
select
  'seller cannot delete image metadata after admin removal',
  count(*) = 0,
  'deleted rows: ' || count(*)::text
from removed;

with changed as (
  update storage.objects
  set metadata = coalesce(metadata, '{}'::jsonb) || '{"tested":true}'::jsonb
  where bucket_id = 'listing-images'
    and name = (
      select storage_path
      from public.listing_images
      where id = (
        select id from pg_temp.authz_resources where label = 'a_available_image'
      )
    )
  returning 1
)
insert into pg_temp.authz_results
select
  'verified owner can update own listing image object',
  count(*) = 1,
  'updated objects: ' || count(*)::text
from changed;

with removed as (
  delete from storage.objects
  where bucket_id = 'listing-images'
    and name = (
      select storage_path
      from public.listing_images
      where id = (
        select id from pg_temp.authz_resources where label = 'a_removed_image'
      )
    )
  returning 1
)
insert into pg_temp.authz_results
select
  'seller cannot delete image object after admin removal',
  count(*) = 0,
  'deleted objects: ' || count(*)::text
from removed;

select pg_temp.expect_denied(
  'ordinary student cannot call admin removal RPC',
  format(
    'select public.admin_remove_listing(%L::uuid)',
    (select id from pg_temp.authz_resources where label = 'admin_target')
  )
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.authz_subjects where label = 'verified_b'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.authz_subjects where label = 'verified_b'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

with changed as (
  update public.listings
  set title = 'Forbidden cross-owner update'
  where id = (select id from pg_temp.authz_resources where label = 'a_available')
  returning 1
)
insert into pg_temp.authz_results
select
  'second verified student cannot update first seller listing',
  count(*) = 0,
  'updated rows: ' || count(*)::text
from changed;

with removed as (
  delete from storage.objects
  where bucket_id = 'listing-images'
    and name = (
      select storage_path
      from public.listing_images
      where id = (
        select id from pg_temp.authz_resources where label = 'a_available_image'
      )
    )
  returning 1
)
insert into pg_temp.authz_results
select
  'second verified student cannot delete first seller image object',
  count(*) = 0,
  'deleted objects: ' || count(*)::text
from removed;

reset role;

-- -------------------------------------------------------------------------
-- Suspended and disabled students
-- -------------------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.authz_subjects where label = 'suspended_student'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.authz_subjects where label = 'suspended_student'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.authz_results
select
  'suspended student cannot read own marketplace listing',
  count(*) = 0,
  'visible rows: ' || count(*)::text
from public.listings
where id = (
  select id from pg_temp.authz_resources where label = 'suspended_listing'
);

with changed as (
  update public.listings
  set title = 'Suspended update'
  where id = (
    select id from pg_temp.authz_resources where label = 'suspended_listing'
  )
  returning 1
)
insert into pg_temp.authz_results
select
  'suspended student cannot update own listing',
  count(*) = 0,
  'updated rows: ' || count(*)::text
from changed;

with removed as (
  delete from public.listings
  where id = (
    select id from pg_temp.authz_resources where label = 'suspended_listing'
  )
  returning 1
)
insert into pg_temp.authz_results
select
  'suspended student cannot delete own listing',
  count(*) = 0,
  'deleted rows: ' || count(*)::text
from removed;

select pg_temp.expect_denied(
  'suspended student cannot create listing',
  format(
    'insert into public.listings (id,seller_id,category_id,title,description,price,condition,status) values (%L::uuid,%L::uuid,%L::uuid,%L,%L,1,%L,%L)',
    (select id from pg_temp.authz_resources where label = 'suspended_attempt'),
    (select id from pg_temp.authz_subjects where label = 'suspended_student'),
    (select id from pg_temp.authz_resources where label = 'category'),
    'Denied listing',
    'RLS test',
    'good',
    'available'
  )
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.authz_subjects where label = 'disabled_student'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.authz_subjects where label = 'disabled_student'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.authz_results
select
  'disabled student cannot read own marketplace listing',
  count(*) = 0,
  'visible rows: ' || count(*)::text
from public.listings
where id = (
  select id from pg_temp.authz_resources where label = 'disabled_listing'
);

reset role;

-- -------------------------------------------------------------------------
-- Active and suspended administrators
-- -------------------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.authz_subjects where label = 'active_admin'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.authz_subjects where label = 'active_admin'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.authz_results
select
  'active admin can read all fixture profiles',
  count(*) = (select count(*) from pg_temp.authz_subjects),
  'visible fixture profiles: ' || count(*)::text
from public.profiles
where id in (select id from pg_temp.authz_subjects);

insert into pg_temp.authz_results
select
  'active admin can read verification requests',
  count(*) = 2,
  'visible fixture verifications: ' || count(*)::text
from public.verifications
where id in (
  select id
  from pg_temp.authz_resources
  where label in ('pending_verification', 'rejected_verification')
);

insert into pg_temp.authz_results
select
  'active admin can read removed listings',
  exists (
    select 1 from public.listings
    where id = (select id from pg_temp.authz_resources where label = 'a_removed')
  ),
  'removed listing visibility checked';

select pg_temp.expect_denied(
  'active admin is not automatically a student seller',
  format(
    'insert into public.listings (id,seller_id,category_id,title,description,price,condition,status) values (%L::uuid,%L::uuid,%L::uuid,%L,%L,1,%L,%L)',
    (select id from pg_temp.authz_resources where label = 'admin_attempt'),
    (select id from pg_temp.authz_subjects where label = 'active_admin'),
    (select id from pg_temp.authz_resources where label = 'category'),
    'Admin listing',
    'RLS test',
    'good',
    'available'
  )
);

select public.admin_remove_listing(
  (select id from pg_temp.authz_resources where label = 'admin_target')
);

insert into pg_temp.authz_results
select
  'active admin can remove listing through moderation RPC',
  status = 'removed',
  'status: ' || status
from public.listings
where id = (
  select id from pg_temp.authz_resources where label = 'admin_target'
);

reset role;

-- The seller must not be able to reverse or erase that moderation decision.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.authz_subjects where label = 'verified_b'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.authz_subjects where label = 'verified_b'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

with changed as (
  update public.listings
  set status = 'available'
  where id = (select id from pg_temp.authz_resources where label = 'admin_target')
  returning 1
)
insert into pg_temp.authz_results
select
  'seller cannot restore admin-removed listing',
  count(*) = 0,
  'updated rows: ' || count(*)::text
from changed;

with removed as (
  delete from public.listings
  where id = (select id from pg_temp.authz_resources where label = 'admin_target')
  returning 1
)
insert into pg_temp.authz_results
select
  'seller cannot erase admin-removed listing',
  count(*) = 0,
  'deleted rows: ' || count(*)::text
from removed;

reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.authz_subjects where label = 'suspended_admin'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.authz_subjects where label = 'suspended_admin'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.authz_results
select
  'suspended admin cannot read marketplace listings',
  count(*) = 0,
  'visible listings: ' || count(*)::text
from public.listings;

insert into pg_temp.authz_results
select
  'suspended admin cannot read other profiles',
  count(*) = 1,
  'visible profiles: ' || count(*)::text
from public.profiles
where id in (select id from pg_temp.authz_subjects);

select pg_temp.expect_denied(
  'suspended admin cannot call moderation RPC',
  format(
    'select public.admin_remove_listing(%L::uuid)',
    (select id from pg_temp.authz_resources where label = 'b_available')
  )
);

reset role;

-- Remove every persistent fixture before committing. Storage rows are not
-- foreign-keyed to Auth users, so remove them explicitly first.
delete from storage.objects
where bucket_id = 'listing-images'
  and owner_id in (select id::text from pg_temp.authz_subjects);

delete from auth.users
where id in (select id from pg_temp.authz_subjects);

delete from public.categories
where id = (select id from pg_temp.authz_resources where label = 'category');

commit;

select scenario, passed, observed
from pg_temp.authz_results
order by scenario;

-- Compact final result for CLI clients that return only the final statement.
select
  count(*) as tests_run,
  count(*) filter (where passed) as tests_passed,
  bool_and(passed) as all_passed,
  coalesce(
    jsonb_agg(scenario order by scenario) filter (where not passed),
    '[]'::jsonb
  ) as failures
from pg_temp.authz_results;
