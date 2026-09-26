-- Self-contained transactional Step 9 favorite RPC/RLS matrix.
-- Fixtures are removed before commit. The final row must report all_passed.

begin;

create temporary table step9_favorite_subjects (
  label text primary key,
  id uuid not null unique,
  verification_status text not null,
  account_status text not null
);

insert into step9_favorite_subjects values
  ('seller', gen_random_uuid(), 'verified', 'active'),
  ('buyer', gen_random_uuid(), 'verified', 'active'),
  ('buyer_two', gen_random_uuid(), 'verified', 'active'),
  ('pending', gen_random_uuid(), 'pending', 'active'),
  ('suspended', gen_random_uuid(), 'verified', 'suspended'),
  ('inactive_seller', gen_random_uuid(), 'verified', 'suspended');

create temporary table step9_favorite_resources (
  label text primary key,
  id uuid not null unique
);

insert into step9_favorite_resources values
  ('category', gen_random_uuid()),
  ('listing_available', gen_random_uuid()),
  ('listing_reserved', gen_random_uuid()),
  ('listing_sold', gen_random_uuid()),
  ('listing_removed', gen_random_uuid()),
  ('listing_inactive_seller', gen_random_uuid()),
  ('listing_lifecycle', gen_random_uuid());

create temporary table step9_favorite_runtime (
  label text primary key,
  state boolean not null
);

create temporary table step9_favorite_results (
  scenario text primary key,
  passed boolean not null,
  observed text not null
);

grant select on pg_temp.step9_favorite_subjects to anon, authenticated;
grant select on pg_temp.step9_favorite_resources to anon, authenticated;
grant select, insert on pg_temp.step9_favorite_runtime to authenticated;
grant select, insert on pg_temp.step9_favorite_results to anon, authenticated;

create or replace function pg_temp.step9_favorite_expect_rejected(
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
    insert into pg_temp.step9_favorite_results values (
      p_scenario,
      false,
      'operation unexpectedly succeeded'
    );
  exception when others then
    insert into pg_temp.step9_favorite_results values (
      p_scenario,
      sqlstate = p_expected_state,
      'SQLSTATE ' || sqlstate
    );
  end;
end;
$$;

grant execute on function pg_temp.step9_favorite_expect_rejected(
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
from pg_temp.step9_favorite_subjects;

insert into public.profiles (
  id, full_name, student_id_number, course, year_level,
  role, verification_status, account_status
)
select
  id,
  'Step Nine ' || label,
  'STEP9-' || upper(left(replace(id::text, '-', ''), 12)),
  'BSCS',
  1,
  'student',
  verification_status,
  account_status
from pg_temp.step9_favorite_subjects
on conflict (id) do update set
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
  'Step 9 Favorites ' || left(replace(id::text, '-', ''), 12),
  'step-9-favorites-' || id::text,
  true
from pg_temp.step9_favorite_resources
where label = 'category';

insert into public.listings (
  id, seller_id, category_id, title, description,
  price, condition, status
)
select
  resource.id,
  case
    when resource.label = 'listing_inactive_seller' then (
      select id from pg_temp.step9_favorite_subjects
      where label = 'inactive_seller'
    )
    else (
      select id from pg_temp.step9_favorite_subjects
      where label = 'seller'
    )
  end,
  (select id from pg_temp.step9_favorite_resources where label = 'category'),
  'Step 9 ' || replace(resource.label, '_', ' '),
  'Disposable listing used by the Step 9 favorites security matrix.',
  150,
  'good',
  case resource.label
    when 'listing_reserved' then 'reserved'
    when 'listing_sold' then 'sold'
    when 'listing_removed' then 'removed'
    else 'available'
  end
from pg_temp.step9_favorite_resources as resource
where resource.label like 'listing_%';

-- Anonymous callers cannot read private favorites or invoke either RPC.
set local role anon;

select pg_temp.step9_favorite_expect_rejected(
  'anonymous user cannot read favorites',
  'select count(*) from public.favorites',
  '42501'
);

select pg_temp.step9_favorite_expect_rejected(
  'anonymous user cannot set favorite state',
  format(
    'select public.set_listing_favorite(%L::uuid,true)',
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_available')
  ),
  '42501'
);

reset role;

-- A second buyer creates a private favorite used by cross-user tests.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step9_favorite_subjects
   where label = 'buyer_two'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step9_favorite_subjects
            where label = 'buyer_two'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step9_favorite_runtime (label, state)
select
  'buyer_two_add',
  public.set_listing_favorite(
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_reserved'),
    true
  );

reset role;

-- A verified active buyer can add idempotently and sees only their own rows.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step9_favorite_subjects where label = 'buyer'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step9_favorite_subjects
            where label = 'buyer'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into pg_temp.step9_favorite_runtime (label, state)
select
  'buyer_add_first',
  public.set_listing_favorite(
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_available'),
    true
  );

insert into pg_temp.step9_favorite_runtime (label, state)
select
  'buyer_add_retry',
  public.set_listing_favorite(
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_available'),
    true
  );

insert into pg_temp.step9_favorite_results
select
  'explicit add is idempotent',
  (select state from pg_temp.step9_favorite_runtime
   where label = 'buyer_add_first')
    and (select state from pg_temp.step9_favorite_runtime
         where label = 'buyer_add_retry')
    and count(*) = 1,
  'visible matching rows: ' || count(*)::text
from public.favorites
where listing_id = (
  select id from pg_temp.step9_favorite_resources
  where label = 'listing_available'
);

insert into pg_temp.step9_favorite_results
select
  'student cannot read another student favorite',
  count(*) = 0,
  'cross-user rows visible: ' || count(*)::text
from public.favorites
where user_id = (
  select id from pg_temp.step9_favorite_subjects where label = 'buyer_two'
);

select pg_temp.step9_favorite_expect_rejected(
  'student cannot forge another user favorite',
  format(
    'insert into public.favorites (user_id,listing_id) values (%L::uuid,%L::uuid)',
    (select id from pg_temp.step9_favorite_subjects where label = 'buyer_two'),
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_lifecycle')
  ),
  '42501'
);

select pg_temp.step9_favorite_expect_rejected(
  'student cannot directly delete another user favorite',
  format(
    'delete from public.favorites where user_id = %L::uuid and listing_id = %L::uuid',
    (select id from pg_temp.step9_favorite_subjects where label = 'buyer_two'),
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_reserved')
  ),
  '42501'
);

select pg_temp.step9_favorite_expect_rejected(
  'sold listing cannot be newly favorited',
  format(
    'select public.set_listing_favorite(%L::uuid,true)',
    (select id from pg_temp.step9_favorite_resources where label = 'listing_sold')
  ),
  'P0002'
);

select pg_temp.step9_favorite_expect_rejected(
  'removed listing cannot be newly favorited',
  format(
    'select public.set_listing_favorite(%L::uuid,true)',
    (select id from pg_temp.step9_favorite_resources where label = 'listing_removed')
  ),
  'P0002'
);

select pg_temp.step9_favorite_expect_rejected(
  'listing from an ineligible seller cannot be favorited',
  format(
    'select public.set_listing_favorite(%L::uuid,true)',
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_inactive_seller')
  ),
  'P0002'
);

select pg_temp.step9_favorite_expect_rejected(
  'favorite desired state cannot be null',
  format(
    'select public.set_listing_favorite(%L::uuid,null)',
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_available')
  ),
  '22004'
);

insert into pg_temp.step9_favorite_runtime (label, state)
select
  'buyer_remove_first',
  public.set_listing_favorite(
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_available'),
    false
  );

insert into pg_temp.step9_favorite_runtime (label, state)
select
  'buyer_remove_retry',
  public.set_listing_favorite(
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_available'),
    false
  );

insert into pg_temp.step9_favorite_results
select
  'explicit removal is owner-scoped and idempotent',
  not (select state from pg_temp.step9_favorite_runtime
       where label = 'buyer_remove_first')
    and not (select state from pg_temp.step9_favorite_runtime
             where label = 'buyer_remove_retry')
    and count(*) = 0,
  'own matching rows after removal: ' || count(*)::text
from public.favorites
where listing_id = (
  select id from pg_temp.step9_favorite_resources
  where label = 'listing_available'
);

insert into pg_temp.step9_favorite_runtime (label, state)
select
  'legacy_add',
  public.toggle_listing_favorite(
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_available')
  );

insert into pg_temp.step9_favorite_runtime (label, state)
select
  'legacy_remove',
  public.toggle_listing_favorite(
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_available')
  );

insert into pg_temp.step9_favorite_results
select
  'legacy toggle remains compatible',
  (select state from pg_temp.step9_favorite_runtime where label = 'legacy_add')
    and not (select state from pg_temp.step9_favorite_runtime
             where label = 'legacy_remove')
    and count(*) = 0,
  'matching rows after two toggles: ' || count(*)::text
from public.favorites
where listing_id = (
  select id from pg_temp.step9_favorite_resources
  where label = 'listing_available'
);

-- Add a favorite that a later sold transition must remove.
insert into pg_temp.step9_favorite_runtime (label, state)
select
  'lifecycle_add',
  public.set_listing_favorite(
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_lifecycle'),
    true
  );

reset role;

-- A seller cannot favorite their own listing.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step9_favorite_subjects where label = 'seller'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step9_favorite_subjects
            where label = 'seller'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.step9_favorite_expect_rejected(
  'seller cannot favorite own listing',
  format(
    'select public.set_listing_favorite(%L::uuid,true)',
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_available')
  ),
  'P0002'
);

select public.set_owned_listing_status(
  (select id from pg_temp.step9_favorite_resources
   where label = 'listing_lifecycle'),
  'sold'
);

reset role;

insert into pg_temp.step9_favorite_results
select
  'sold transition removes existing favorites',
  (select status = 'sold' from public.listings where id = (
    select id from pg_temp.step9_favorite_resources
    where label = 'listing_lifecycle'
  ))
    and count(*) = 0,
  'favorites remaining after sold: ' || count(*)::text
from public.favorites
where listing_id = (
  select id from pg_temp.step9_favorite_resources
  where label = 'listing_lifecycle'
);

-- Pending and suspended students cannot create marketplace interactions.
select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step9_favorite_subjects where label = 'pending'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step9_favorite_subjects
            where label = 'pending'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.step9_favorite_expect_rejected(
  'pending student cannot set favorite state',
  format(
    'select public.set_listing_favorite(%L::uuid,true)',
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_available')
  ),
  '42501'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from pg_temp.step9_favorite_subjects
   where label = 'suspended'),
  true
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select id::text from pg_temp.step9_favorite_subjects
            where label = 'suspended'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select pg_temp.step9_favorite_expect_rejected(
  'suspended student cannot set favorite state',
  format(
    'select public.set_listing_favorite(%L::uuid,true)',
    (select id from pg_temp.step9_favorite_resources
     where label = 'listing_available')
  ),
  '42501'
);

reset role;

insert into pg_temp.step9_favorite_results
select
  'other student favorite survived owner-scoped operations',
  count(*) = 1,
  'buyer two matching rows: ' || count(*)::text
from public.favorites
where user_id = (
  select id from pg_temp.step9_favorite_subjects where label = 'buyer_two'
)
  and listing_id = (
    select id from pg_temp.step9_favorite_resources
    where label = 'listing_reserved'
  );

delete from auth.users
where id in (select id from pg_temp.step9_favorite_subjects);
delete from public.categories
where id = (
  select id from pg_temp.step9_favorite_resources where label = 'category'
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
from pg_temp.step9_favorite_results;
