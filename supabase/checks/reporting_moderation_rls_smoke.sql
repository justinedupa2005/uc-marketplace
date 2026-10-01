-- Transactional Step 13 role/RLS and workflow smoke checks. No fixture is
-- persisted: this test rolls back all setup and moderation changes.
begin;

create temporary table step13_subjects (
  label text primary key, id uuid not null unique,
  role text not null, verification_status text not null,
  account_status text not null
);
insert into step13_subjects values
  ('reporter', gen_random_uuid(), 'student', 'verified', 'active'),
  ('seller', gen_random_uuid(), 'student', 'verified', 'active'),
  ('saved_seller', gen_random_uuid(), 'student', 'verified', 'active'),
  ('conversation_buyer', gen_random_uuid(), 'student', 'verified', 'active'),
  ('reservation_buyer', gen_random_uuid(), 'student', 'verified', 'active'),
  ('stranger', gen_random_uuid(), 'student', 'verified', 'active'),
  ('unverified', gen_random_uuid(), 'student', 'unverified', 'active'),
  ('suspended', gen_random_uuid(), 'student', 'verified', 'suspended'),
  ('admin', gen_random_uuid(), 'admin', 'verified', 'active'),
  ('admin_two', gen_random_uuid(), 'admin', 'verified', 'active');
create temporary table step13_resources (label text primary key, id uuid not null unique);
insert into step13_resources
select label, gen_random_uuid() from unnest(array[
  'category', 'seller_listing', 'removal_listing', 'saved_sold_listing',
  'conversation_listing', 'reservation_listing', 'conversation', 'reservation'
]) as label;
create temporary table step13_runtime (label text primary key, id uuid not null unique);
create temporary table step13_results (
  scenario text primary key, passed boolean not null, observed text not null
);
grant select on pg_temp.step13_subjects, pg_temp.step13_resources to authenticated, anon;
grant select, insert, update on pg_temp.step13_runtime, pg_temp.step13_results
  to authenticated, anon;

create function pg_temp.step13_assert(
  p_scenario text, p_passed boolean, p_observed text default 'state checked'
)
returns void language sql security invoker set search_path = '' as $$
  insert into pg_temp.step13_results
  values (p_scenario, coalesce(p_passed, false), p_observed)
$$;
grant execute on function pg_temp.step13_assert(text, boolean, text)
  to authenticated, anon;

create function pg_temp.step13_as(p_actor text, p_statement text)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_actor uuid;
begin
  select id into strict v_actor from pg_temp.step13_subjects where label = p_actor;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
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
revoke all on function pg_temp.step13_as(text, text)
  from public, anon, authenticated;

create function pg_temp.step13_expect_rejected(
  p_scenario text, p_actor text, p_statement text, p_state text
)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  begin
    perform pg_temp.step13_as(p_actor, p_statement);
    perform pg_temp.step13_assert(p_scenario, false, 'operation unexpectedly succeeded');
  exception when others then
    perform pg_temp.step13_assert(p_scenario, sqlstate = p_state,
      'SQLSTATE ' || sqlstate);
  end;
end;
$$;
revoke all on function pg_temp.step13_expect_rejected(text, text, text, text)
  from public, anon, authenticated;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select id, 'authenticated', 'authenticated',
  label || '+' || replace(id::text, '-', '') || '@example.invalid',
  crypt(gen_random_uuid()::text, gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now()
from pg_temp.step13_subjects;
insert into public.profiles (
  id, full_name, student_id_number, course, year_level, role,
  verification_status, account_status
)
select id, 'Step Thirteen ' || replace(label, '_', ' '),
  'STEP13-' || upper(left(replace(id::text, '-', ''), 12)),
  'BSCS', 1, role, verification_status, account_status
from pg_temp.step13_subjects
on conflict (id) do update set
  full_name = excluded.full_name,
  student_id_number = excluded.student_id_number,
  course = excluded.course,
  year_level = excluded.year_level,
  role = excluded.role,
  verification_status = excluded.verification_status,
  account_status = excluded.account_status;
insert into public.categories (id, name, slug, is_active)
select id, 'Step 13 ' || id::text, 'step13-' || id::text, true
from pg_temp.step13_resources where label = 'category';
insert into public.listings (
  id, seller_id, category_id, title, description, price, condition, status
)
select resource.id,
  (select id from pg_temp.step13_subjects where label =
    case when resource.label in ('seller_listing', 'removal_listing')
      then 'seller' when resource.label = 'saved_sold_listing'
      then 'saved_seller' else 'reporter' end),
  (select id from pg_temp.step13_resources where label = 'category'),
  'Step 13 ' || resource.label, 'Disposable reporting test listing.',
  100, 'good',
  case when resource.label = 'saved_sold_listing' then 'sold'
    else 'available' end
from pg_temp.step13_resources as resource
where resource.label like '%_listing';
insert into public.favorites (user_id, listing_id)
values (
  (select id from pg_temp.step13_subjects where label = 'reporter'),
  (select id from pg_temp.step13_resources where label = 'saved_sold_listing')
);
insert into public.conversations (id, listing_id, buyer_id, seller_id)
values (
  (select id from pg_temp.step13_resources where label = 'conversation'),
  (select id from pg_temp.step13_resources where label = 'conversation_listing'),
  (select id from pg_temp.step13_subjects where label = 'conversation_buyer'),
  (select id from pg_temp.step13_subjects where label = 'reporter')
);
insert into public.reservations (id, listing_id, buyer_id, seller_id)
values (
  (select id from pg_temp.step13_resources where label = 'reservation'),
  (select id from pg_temp.step13_resources where label = 'reservation_listing'),
  (select id from pg_temp.step13_subjects where label = 'reservation_buyer'),
  (select id from pg_temp.step13_subjects where label = 'reporter')
);

select pg_temp.step13_as('reporter',
  'insert into pg_temp.step13_runtime select ''student_report'', public.report_student((select id from pg_temp.step13_subjects where label = ''seller''), ''scam'', ''Concern about a seller interaction.'')');
select pg_temp.step13_as('reporter',
  'select pg_temp.step13_assert(''duplicate active student report reuses same ID'', public.report_student((select id from pg_temp.step13_subjects where label = ''seller''), ''spam'', null) = (select id from pg_temp.step13_runtime where label = ''student_report'') and (select count(*) = 1 from public.student_reports where subject_id = (select id from pg_temp.step13_subjects where label = ''seller'')))');
select pg_temp.step13_as('reporter',
  'select pg_temp.step13_assert(''saved sold listing permits reporting its seller'', public.report_student((select id from pg_temp.step13_subjects where label = ''saved_seller''), ''scam'', null) is not null)');
select pg_temp.step13_as('reporter',
  'select pg_temp.step13_assert(''conversation permits reporting contacted student'', public.report_student((select id from pg_temp.step13_subjects where label = ''conversation_buyer''), ''harassment'', null) is not null)');
select pg_temp.step13_as('reporter',
  'select pg_temp.step13_assert(''reservation permits reporting involved student'', public.report_student((select id from pg_temp.step13_subjects where label = ''reservation_buyer''), ''unsafe_meetup'', null) is not null)');
select pg_temp.step13_expect_rejected('unrelated student cannot be reported', 'reporter',
  'select public.report_student((select id from pg_temp.step13_subjects where label = ''stranger''), ''spam'', null)', 'P0002');
select pg_temp.step13_expect_rejected('student cannot report self', 'reporter',
  'select public.report_student((select id from pg_temp.step13_subjects where label = ''reporter''), ''spam'', null)', 'P0002');
select pg_temp.step13_expect_rejected('student cannot report an administrator', 'reporter',
  'select public.report_student((select id from pg_temp.step13_subjects where label = ''admin''), ''spam'', null)', 'P0002');
select pg_temp.step13_expect_rejected('unverified account cannot submit student report', 'unverified',
  'select public.report_student((select id from pg_temp.step13_subjects where label = ''seller''), ''spam'', null)', '42501');
select pg_temp.step13_expect_rejected('suspended account cannot submit student report', 'suspended',
  'select public.report_student((select id from pg_temp.step13_subjects where label = ''seller''), ''spam'', null)', '42501');
select pg_temp.step13_expect_rejected('invalid student report reason is rejected', 'reporter',
  'select public.report_student((select id from pg_temp.step13_subjects where label = ''seller''), ''uncontrolled'', null)', '22023');
select pg_temp.step13_expect_rejected('other reason needs useful detail', 'reporter',
  'select public.report_student((select id from pg_temp.step13_subjects where label = ''seller''), ''other'', ''short'')', '22023');
select pg_temp.step13_expect_rejected('too-long student detail is rejected', 'reporter',
  'select public.report_student((select id from pg_temp.step13_subjects where label = ''seller''), ''other'', repeat(''X'',1001))', '22023');

select pg_temp.step13_as('seller',
  'select pg_temp.step13_assert(''reported subject cannot read confidential student reports'', (select count(*) = 0 from public.student_reports))');
select pg_temp.step13_as('admin',
  'select pg_temp.step13_assert(''active administrator can read all student reports'', (select count(*) = 4 from public.student_reports))');
select pg_temp.step13_as('suspended',
  'select pg_temp.step13_assert(''suspended user cannot read others private reports'', (select count(*) = 0 from public.student_reports))');
select pg_temp.step13_expect_rejected('reporter cannot select admin-only note column', 'reporter',
  'select admin_note from public.student_reports', '42501');
select pg_temp.step13_expect_rejected('reporter cannot insert student report directly', 'reporter',
  'insert into public.student_reports (reporter_id,subject_id,reason) values ((select id from pg_temp.step13_subjects where label = ''reporter''),(select id from pg_temp.step13_subjects where label = ''seller''),''scam'')', '42501');
select pg_temp.step13_expect_rejected('reporter cannot alter student report outcome', 'reporter',
  'update public.student_reports set status = ''resolved''', '42501');
select pg_temp.step13_expect_rejected('authenticated user cannot write private audit', 'reporter',
  'insert into private.moderation_actions (actor_id,target_user_id,action,reason) values ((select id from pg_temp.step13_subjects where label = ''reporter''),(select id from pg_temp.step13_subjects where label = ''seller''),''user_suspended'',''Forged moderation reason'')', '42501');

select pg_temp.step13_as('reporter',
  'insert into pg_temp.step13_runtime select ''listing_report'', public.report_listing((select id from pg_temp.step13_resources where label = ''seller_listing''), ''misleading'', ''Step thirteen listing report.'')');
select pg_temp.step13_expect_rejected('reporter cannot select listing admin note', 'reporter',
  'select admin_note from public.listing_reports', '42501');
select pg_temp.step13_expect_rejected('reporter cannot decide own report', 'reporter',
  'select public.admin_review_report(''student'',(select id from pg_temp.step13_runtime where label = ''student_report''),''resolved'',''The report was reviewed.'')', '42501');
select pg_temp.step13_expect_rejected('report review requires substantial note', 'admin',
  'select public.admin_review_report(''student'',(select id from pg_temp.step13_runtime where label = ''student_report''),''resolved'',''short'')', '22023');
select pg_temp.step13_as('admin',
  'select public.admin_review_report(''student'',(select id from pg_temp.step13_runtime where label = ''student_report''),''resolved'',''Evidence was checked carefully.'')');
select pg_temp.step13_as('admin',
  'select pg_temp.step13_assert(''student decision persists reviewer and private note'', (select status = ''resolved'' and reviewed_by = (select id from pg_temp.step13_subjects where label = ''admin'') and reviewed_at is not null from public.student_reports where id = (select id from pg_temp.step13_runtime where label = ''student_report'')) and public.get_admin_report_note(''student'',(select id from pg_temp.step13_runtime where label = ''student_report'')) = ''Evidence was checked carefully.'')');
select pg_temp.step13_expect_rejected('reporter cannot retrieve admin note RPC', 'reporter',
  'select public.get_admin_report_note(''student'',(select id from pg_temp.step13_runtime where label = ''student_report''))', '42501');
select pg_temp.step13_expect_rejected('stale student report review is rejected', 'admin',
  'select public.admin_review_report(''student'',(select id from pg_temp.step13_runtime where label = ''student_report''),''dismissed'',''Another evidence review occurred.'')', 'P0001');
select pg_temp.step13_as('admin',
  'select public.admin_review_report(''listing'',(select id from pg_temp.step13_runtime where label = ''listing_report''),''dismissed'',''Listing report did not substantiate a violation.'')');
select pg_temp.step13_as('admin',
  'select pg_temp.step13_assert(''listing review records dismissal and confidential note'', (select status = ''dismissed'' and reviewed_by = (select id from pg_temp.step13_subjects where label = ''admin'') and reviewed_at is not null from public.listing_reports where id = (select id from pg_temp.step13_runtime where label = ''listing_report'')) and public.get_admin_report_note(''listing'',(select id from pg_temp.step13_runtime where label = ''listing_report'')) = ''Listing report did not substantiate a violation.'')');
select pg_temp.step13_expect_rejected('reporter cannot retrieve listing admin note', 'reporter',
  'select public.get_admin_report_note(''listing'',(select id from pg_temp.step13_runtime where label = ''listing_report''))', '42501');

select pg_temp.step13_expect_rejected('legacy unaudited user-status RPC is inaccessible', 'admin',
  'select public.admin_set_account_status((select id from pg_temp.step13_subjects where label = ''seller''),''suspended'')', '42501');
select pg_temp.step13_expect_rejected('legacy unaudited listing RPC is inaccessible', 'admin',
  'select public.admin_remove_listing((select id from pg_temp.step13_resources where label = ''removal_listing''))', '42501');
select pg_temp.step13_expect_rejected('ordinary student cannot moderate accounts', 'reporter',
  'select public.admin_moderate_user((select id from pg_temp.step13_subjects where label = ''seller''),''suspended'',''Conduct investigation outcome'')', '42501');
select pg_temp.step13_expect_rejected('admin cannot suspend another admin', 'admin',
  'select public.admin_moderate_user((select id from pg_temp.step13_subjects where label = ''admin_two''),''suspended'',''Conduct investigation outcome'')', 'P0002');
select pg_temp.step13_expect_rejected('account moderation requires a reason', 'admin',
  'select public.admin_moderate_user((select id from pg_temp.step13_subjects where label = ''seller''),''suspended'',null)', '22023');
select pg_temp.step13_as('admin',
  'select public.admin_moderate_user((select id from pg_temp.step13_subjects where label = ''seller''),''suspended'',''Repeated unsafe marketplace conduct.'')');
select pg_temp.step13_assert('suspension and audit commit together',
  (select account_status = 'suspended' from public.profiles
    where id = (select id from pg_temp.step13_subjects where label = 'seller'))
  and (select count(*) = 1 from private.moderation_actions
    where action = 'user_suspended'
      and target_user_id = (select id from pg_temp.step13_subjects where label = 'seller')
      and actor_id = (select id from pg_temp.step13_subjects where label = 'admin'))
  and (select count(*) = 1 from public.notifications
    where type = 'account_suspended'
      and user_id = (select id from pg_temp.step13_subjects where label = 'seller')));
select pg_temp.step13_expect_rejected('repeat suspension returns stale conflict', 'admin',
  'select public.admin_moderate_user((select id from pg_temp.step13_subjects where label = ''seller''),''suspended'',''Repeated unsafe marketplace conduct.'')', 'P0001');
select pg_temp.step13_as('admin',
  'select public.admin_moderate_user((select id from pg_temp.step13_subjects where label = ''seller''),''active'',''Account appeal was reviewed and approved.'')');
select pg_temp.step13_assert('reactivation and audit commit together',
  (select account_status = 'active' from public.profiles
    where id = (select id from pg_temp.step13_subjects where label = 'seller'))
  and (select count(*) = 1 from private.moderation_actions
    where action = 'user_reactivated'
      and target_user_id = (select id from pg_temp.step13_subjects where label = 'seller'))
  and (select count(*) = 1 from public.notifications
    where type = 'account_reactivated'
      and user_id = (select id from pg_temp.step13_subjects where label = 'seller')));
select pg_temp.step13_expect_rejected('ordinary student cannot remove listing', 'reporter',
  'select public.admin_moderate_listing((select id from pg_temp.step13_resources where label = ''removal_listing''),''Prohibited item displayed in listing.'')', '42501');
select pg_temp.step13_expect_rejected('listing removal requires reason', 'admin',
  'select public.admin_moderate_listing((select id from pg_temp.step13_resources where label = ''removal_listing''),''short'')', '22023');
select pg_temp.step13_as('admin',
  'select public.admin_moderate_listing((select id from pg_temp.step13_resources where label = ''removal_listing''),''Prohibited item displayed in listing.'')');
select pg_temp.step13_assert('listing removal, notification and audit commit together',
  (select status = 'removed' from public.listings
    where id = (select id from pg_temp.step13_resources where label = 'removal_listing'))
  and (select count(*) = 1 from private.moderation_actions
    where action = 'listing_removed'
      and listing_id = (select id from pg_temp.step13_resources where label = 'removal_listing')
      and actor_id = (select id from pg_temp.step13_subjects where label = 'admin'))
  and (select count(*) = 1 from public.notifications
    where type = 'listing_removed'
      and listing_id = (select id from pg_temp.step13_resources where label = 'removal_listing')));
select pg_temp.step13_expect_rejected('repeat listing removal returns stale conflict', 'admin',
  'select public.admin_moderate_listing((select id from pg_temp.step13_resources where label = ''removal_listing''),''Prohibited item displayed in listing.'')', 'P0001');
select pg_temp.step13_assert('failed moderation attempts leave no audit trail',
  (select count(*) = 3 from private.moderation_actions));

select scenario, passed, observed from pg_temp.step13_results
union all
select '__all_reporting_moderation_rls_checks_passed__',
  bool_and(passed), count(*)::text || ' scenarios'
from pg_temp.step13_results
order by scenario;

rollback;
