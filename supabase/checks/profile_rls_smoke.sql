-- Transactional profile, public-identity and avatar matrix. This script rolls
-- back every fixture and edit; no passwords or profile images leave PostgreSQL.
begin;

create temporary table step14_subjects (
  label text primary key, id uuid not null unique,
  role text not null, verification_status text not null, account_status text not null
);
insert into step14_subjects values
  ('unverified', gen_random_uuid(), 'student', 'unverified', 'active'),
  ('rejected', gen_random_uuid(), 'student', 'rejected', 'active'),
  ('pending', gen_random_uuid(), 'student', 'pending', 'active'),
  ('verified', gen_random_uuid(), 'student', 'verified', 'active'),
  ('other', gen_random_uuid(), 'student', 'verified', 'active'),
  ('suspended', gen_random_uuid(), 'student', 'verified', 'suspended'),
  ('admin', gen_random_uuid(), 'admin', 'verified', 'active');
create temporary table step14_objects (
  label text primary key, name text not null unique, owner_id text not null
);
insert into step14_objects
select label || '_current', id::text || '/avatar.png', id::text from step14_subjects;
insert into step14_objects
select 'replacement', id::text || '/' || gen_random_uuid()::text || '.webp', id::text
from step14_subjects where label = 'verified';
insert into step14_objects
select 'wrong_owner', id::text || '/' || gen_random_uuid()::text || '.jpg',
  (select id::text from step14_subjects where label = 'other')
from step14_subjects where label = 'unverified';
create temporary table step14_results (
  scenario text primary key, passed boolean not null, observed text not null
);
grant select on pg_temp.step14_subjects, pg_temp.step14_objects to authenticated, anon;
grant select, insert on pg_temp.step14_results to authenticated, anon;

create function pg_temp.step14_assert(p_scenario text, p_passed boolean)
returns void language sql security invoker set search_path = '' as $$
  insert into pg_temp.step14_results values
    (p_scenario, coalesce(p_passed, false), 'database state checked')
$$;
grant execute on function pg_temp.step14_assert(text, boolean) to authenticated, anon;

create function pg_temp.step14_as(p_actor text, p_statement text)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_actor uuid;
begin
  select id into strict v_actor from pg_temp.step14_subjects where label = p_actor;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub',v_actor,'role','authenticated')::text, true);
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
revoke all on function pg_temp.step14_as(text,text) from public, anon, authenticated;

create function pg_temp.step14_rejected(
  p_scenario text, p_actor text, p_statement text, p_state text
)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  begin
    perform pg_temp.step14_as(p_actor,p_statement);
    insert into pg_temp.step14_results values (p_scenario,false,'operation unexpectedly succeeded');
  exception when others then
    insert into pg_temp.step14_results values (p_scenario,sqlstate = p_state,'SQLSTATE ' || sqlstate);
  end;
end;
$$;
revoke all on function pg_temp.step14_rejected(text,text,text,text) from public, anon, authenticated;

insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select id,'authenticated','authenticated',
  label || '+' || replace(id::text,'-','') || '@example.invalid',
  crypt(gen_random_uuid()::text,gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
from step14_subjects;
insert into storage.objects (bucket_id,name,owner_id)
select 'avatars',name,owner_id from step14_objects;
update public.profiles as profile
set full_name = 'Step Fourteen ' || subject.label,
  student_id_number = 'STEP14-' || upper(left(replace(subject.id::text,'-',''),12)),
  course = 'BSCS', year_level = 1,
  role = subject.role,verification_status = subject.verification_status,
  account_status = subject.account_status,
  avatar_path = subject.id::text || '/avatar.png'
from step14_subjects as subject where profile.id = subject.id;

select pg_temp.step14_as('unverified',
  'update public.profiles set full_name = ''  Updated Student  '', course = '' bsit '', year_level = 5 where id = auth.uid()');
select pg_temp.step14_as('unverified',
  'select pg_temp.step14_assert(''unverified profile edits persist with canonical values'', (select full_name = ''Updated Student'' and course = ''BSIT'' and year_level = 5 from public.profiles where id = auth.uid()))');
select pg_temp.step14_as('rejected',
  'with edited as (update public.profiles set full_name = ''Corrected Student'' where id = auth.uid() returning id) select pg_temp.step14_assert(''rejected identity can be corrected before resubmission'',(select count(*) = 1 from edited))');
select pg_temp.step14_as('verified',
  'with edited as (update public.profiles set year_level = 2 where id = auth.uid() returning id) select pg_temp.step14_assert(''verified students may advance valid year level'',(select count(*) = 1 from edited))');

select pg_temp.step14_rejected('verified name needs identity review','verified',
  'update public.profiles set full_name = ''Another Name'' where id = auth.uid()','42501');
select pg_temp.step14_rejected('verified course needs identity review','verified',
  'update public.profiles set course = ''BSIT'' where id = auth.uid()','42501');
select pg_temp.step14_rejected('verified student ID needs identity review','verified',
  'update public.profiles set student_id_number = ''NEW-ID-1234'' where id = auth.uid()','42501');
select pg_temp.step14_rejected('pending full name is frozen','pending',
  'update public.profiles set full_name = ''Another Name'' where id = auth.uid()','42501');
select pg_temp.step14_rejected('pending course is frozen','pending',
  'update public.profiles set course = ''BSIT'' where id = auth.uid()','42501');
select pg_temp.step14_rejected('pending year is frozen','pending',
  'update public.profiles set year_level = 2 where id = auth.uid()','42501');
select pg_temp.step14_rejected('pending student ID is frozen','pending',
  'update public.profiles set student_id_number = ''NEW-ID-1234'' where id = auth.uid()','42501');
select pg_temp.step14_rejected('arbitrary course is rejected','unverified',
  'update public.profiles set course = ''MADE-UP-COURSE'' where id = auth.uid()','23514');
select pg_temp.step14_rejected('out of range year is rejected','unverified',
  'update public.profiles set year_level = 6 where id = auth.uid()','23514');
select pg_temp.step14_rejected('whitespace full name is rejected','unverified',
  'update public.profiles set full_name = '' '' where id = auth.uid()','23514');
select pg_temp.step14_rejected('oversized full name is rejected','unverified',
  'update public.profiles set full_name = repeat(''N'',101) where id = auth.uid()','23514');
select pg_temp.step14_rejected('blank course is rejected','unverified',
  'update public.profiles set course = '' '' where id = auth.uid()','23514');
select pg_temp.step14_rejected('clearing year is rejected','verified',
  'update public.profiles set year_level = null where id = auth.uid()','23514');

select pg_temp.step14_rejected('students cannot change role','unverified',
  'update public.profiles set role = ''admin'' where id = auth.uid()','42501');
select pg_temp.step14_rejected('students cannot self verify','unverified',
  'update public.profiles set verification_status = ''verified'' where id = auth.uid()','42501');
select pg_temp.step14_rejected('students cannot reactivate account','suspended',
  'update public.profiles set account_status = ''active'' where id = auth.uid()','42501');
select pg_temp.step14_rejected('students cannot falsify join date','unverified',
  'update public.profiles set created_at = now() - interval ''10 years'' where id = auth.uid()','42501');
select pg_temp.step14_rejected('students cannot alter updated timestamp directly','unverified',
  'update public.profiles set updated_at = now() - interval ''10 years'' where id = auth.uid()','42501');
select pg_temp.step14_rejected('students cannot replace profile owner','unverified',
  'update public.profiles set id = gen_random_uuid() where id = auth.uid()','42501');
select pg_temp.step14_as('unverified',
  'with edited as (update public.profiles set full_name = ''Foreign Edit'' where id = (select id from pg_temp.step14_subjects where label = ''other'') returning id) select pg_temp.step14_assert(''cross user profile edits affect no rows'',(select count(*) = 0 from edited))');
select pg_temp.step14_as('suspended',
  'with edited as (update public.profiles set year_level = 3 where id = auth.uid() returning id) select pg_temp.step14_assert(''suspended owners cannot edit profiles'',(select count(*) = 0 from edited))');
select pg_temp.step14_as('suspended',
  'select pg_temp.step14_assert(''suspended owners retain private account status access'',(select count(*) = 1 and bool_and(account_status = ''suspended'') from public.profiles))');

select pg_temp.step14_as('verified',
  'select pg_temp.step14_assert(''ordinary profile query exposes only own private record'',(select count(*) = 1 and bool_and(id = auth.uid()) from public.profiles))');
select pg_temp.step14_as('verified',
  'select pg_temp.step14_assert(''public projection includes active verified identity and real date only'',(select count(*) = 2 and bool_and(verification_status = ''verified'' and created_at is not null) from public.marketplace_profiles))');
select pg_temp.step14_as('pending',
  'select pg_temp.step14_assert(''pending viewer cannot browse public seller profiles'',(select count(*) = 0 from public.marketplace_profiles))');
select pg_temp.step14_as('suspended',
  'select pg_temp.step14_assert(''suspended viewer cannot browse public seller profiles'',(select count(*) = 0 from public.marketplace_profiles))');
select pg_temp.step14_rejected('public projection has no private student ID','verified',
  'select student_id_number from public.marketplace_profiles','42703');
select pg_temp.step14_rejected('public projection has no private account status','verified',
  'select account_status from public.marketplace_profiles','42703');

-- Upload -> link -> old-object cleanup succeeds in this exact order.
select pg_temp.step14_as('unverified',
  'with uploaded as (insert into storage.objects (bucket_id,name,owner_id) values (''avatars'',auth.uid()::text || ''/'' || gen_random_uuid()::text || ''.jpg'',auth.uid()::text) returning id) select pg_temp.step14_assert(''active unverified owner may upload separate public-safe avatar'',(select count(*) = 1 from uploaded))');
select pg_temp.step14_rejected('cross user avatar upload is denied','unverified',
  'insert into storage.objects (bucket_id,name,owner_id) values (''avatars'',(select id::text from pg_temp.step14_subjects where label = ''other'') || ''/'' || gen_random_uuid()::text || ''.jpg'',auth.uid()::text)','42501');
select pg_temp.step14_rejected('spoofed avatar owner is denied','unverified',
  'insert into storage.objects (bucket_id,name,owner_id) values (''avatars'',auth.uid()::text || ''/'' || gen_random_uuid()::text || ''.jpg'',(select id::text from pg_temp.step14_subjects where label = ''other''))','42501');
select pg_temp.step14_rejected('arbitrary avatar file names are denied','unverified',
  'insert into storage.objects (bucket_id,name,owner_id) values (''avatars'',auth.uid()::text || ''/school-id.png'',auth.uid()::text)','42501');
select pg_temp.step14_rejected('nested avatar file paths are denied','unverified',
  'insert into storage.objects (bucket_id,name,owner_id) values (''avatars'',auth.uid()::text || ''/private/'' || gen_random_uuid()::text || ''.jpg'',auth.uid()::text)','42501');
select pg_temp.step14_rejected('suspended owner cannot upload avatar','suspended',
  'insert into storage.objects (bucket_id,name,owner_id) values (''avatars'',auth.uid()::text || ''/'' || gen_random_uuid()::text || ''.jpg'',auth.uid()::text)','42501');
select pg_temp.step14_as('verified',
  'with edited as (update storage.objects set metadata = ''{"changed":true}'' where bucket_id = ''avatars'' and name = (select name from pg_temp.step14_objects where label = ''verified_current'') returning id) select pg_temp.step14_assert(''linked avatar bytes cannot be overwritten'',(select count(*) = 0 from edited))');
select pg_temp.step14_as('verified',
  'with edited as (update storage.objects set metadata = ''{"changed":true}'' where bucket_id = ''avatars'' and name = (select name from pg_temp.step14_objects where label = ''replacement'') returning id) select pg_temp.step14_assert(''unlinked avatar uploads are also immutable'',(select count(*) = 0 from edited))');
select pg_temp.step14_as('verified',
  'with erased as (delete from storage.objects where bucket_id = ''avatars'' and name = (select name from pg_temp.step14_objects where label = ''verified_current'') returning id) select pg_temp.step14_assert(''current avatar cannot be deleted before replacement'',(select count(*) = 0 from erased))');
select pg_temp.step14_rejected('foreign avatar link is rejected','unverified',
  'update public.profiles set avatar_path = (select name from pg_temp.step14_objects where label = ''other_current'') where id = auth.uid()','23514');
select pg_temp.step14_rejected('existing own path with foreign owner cannot be linked','unverified',
  'update public.profiles set avatar_path = (select name from pg_temp.step14_objects where label = ''wrong_owner'') where id = auth.uid()','23514');
select pg_temp.step14_rejected('nonexistent avatar link is rejected','unverified',
  'update public.profiles set avatar_path = auth.uid()::text || ''/'' || gen_random_uuid()::text || ''.webp'' where id = auth.uid()','23514');
select pg_temp.step14_rejected('verification document path cannot be avatar','unverified',
  'update public.profiles set avatar_path = auth.uid()::text || ''/documents/school-id.png'' where id = auth.uid()','23514');
select pg_temp.step14_as('verified',
  'with linked as (update public.profiles set avatar_path = (select name from pg_temp.step14_objects where label = ''replacement'') where id = auth.uid() and avatar_path = (select name from pg_temp.step14_objects where label = ''verified_current'') returning id) select pg_temp.step14_assert(''new owned avatar links only after upload'',(select count(*) = 1 from linked))');
select pg_temp.step14_as('verified',
  'with stale as (update public.profiles set avatar_path = (select name from pg_temp.step14_objects where label = ''verified_current'') where id = auth.uid() and avatar_path = (select name from pg_temp.step14_objects where label = ''verified_current'') returning id) select pg_temp.step14_assert(''stale avatar compare and swap affects no rows'',(select count(*) = 0 from stale))');
select pg_temp.step14_as('verified',
  'with erased as (delete from storage.objects where bucket_id = ''avatars'' and name = (select name from pg_temp.step14_objects where label = ''verified_current'') returning id) select pg_temp.step14_assert(''previous avatar can be cleaned after confirmed link'',(select count(*) = 1 from erased))');
select pg_temp.step14_as('unverified',
  'with erased as (delete from storage.objects where bucket_id = ''avatars'' and name = (select name from pg_temp.step14_objects where label = ''other_current'') returning id) select pg_temp.step14_assert(''foreign avatar delete affects no rows'',(select count(*) = 0 from erased))');
select pg_temp.step14_as('pending',
  'with cleared as (update public.profiles set avatar_path = null where id = auth.uid() returning id) select pg_temp.step14_assert(''pending account can clear avatar without changing reviewed identity'',(select count(*) = 1 from cleared))');

set local role anon;
do $$
begin
  begin
    perform count(*) from public.marketplace_profiles;
    perform pg_temp.step14_assert('anonymous seller profile queries are denied',false);
  exception when insufficient_privilege then
    perform pg_temp.step14_assert('anonymous seller profile queries are denied',true);
  end;
end;
$$;
reset role;

select scenario,passed,observed from step14_results order by scenario;
select '__all_profile_rls_smoke_checks_passed__' as scenario,
  count(*) as tests_run, bool_and(passed) as all_passed from step14_results;
rollback;
