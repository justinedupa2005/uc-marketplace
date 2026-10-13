-- Transactional Storage lifecycle regressions; test privileged SQL only.
-- No real concurrent sessions or Storage HTTP service are emulated here.
begin;
create temporary table qa15_storage_subjects(label text primary key,id uuid not null unique);
insert into qa15_storage_subjects values ('student',gen_random_uuid()),('seller',gen_random_uuid()),('other',gen_random_uuid());
create temporary table qa15_storage_resources(label text primary key,id uuid not null unique);
insert into qa15_storage_resources values ('category',gen_random_uuid()),('listing',gen_random_uuid()),('image',gen_random_uuid()),('unused_image',gen_random_uuid()),('replacement_image',gen_random_uuid()),('reserved_image',gen_random_uuid()),('verification',gen_random_uuid()),('late_failure_verification',gen_random_uuid()),('missing_verification',gen_random_uuid());
create temporary table qa15_storage_results(scenario text primary key,passed boolean not null,observed text not null);
grant select on qa15_storage_subjects,qa15_storage_resources to authenticated;
grant select,insert on qa15_storage_results to authenticated;
create function pg_temp.qa15_storage_assert(p_scenario text,p_passed boolean,p_observed text default 'Storage policy and persisted rows checked') returns void language sql security invoker set search_path='' as $$
  insert into pg_temp.qa15_storage_results values(p_scenario,coalesce(p_passed,false),p_observed);
$$;
create function pg_temp.qa15_storage_login(p_label text) returns void language sql security invoker set search_path='' as $$
  select set_config('request.jwt.claim.sub',(select id::text from pg_temp.qa15_storage_subjects where label=p_label),true);
  select set_config('request.jwt.claims',json_build_object('sub',(select id::text from pg_temp.qa15_storage_subjects where label=p_label),'role','authenticated')::text,true);
$$;
create function pg_temp.qa15_storage_rejected(p_scenario text,p_statement text,p_state text) returns void language plpgsql security invoker set search_path='' as $$
begin
  begin execute p_statement; perform pg_temp.qa15_storage_assert(p_scenario,false,'operation unexpectedly succeeded');
  exception when others then perform pg_temp.qa15_storage_assert(p_scenario,sqlstate=p_state,'SQLSTATE '||sqlstate); end;
end;
$$;
grant execute on function pg_temp.qa15_storage_assert(text,boolean,text),pg_temp.qa15_storage_login(text),pg_temp.qa15_storage_rejected(text,text,text) to authenticated;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data)
select id,'authenticated','authenticated','qa-storage-'||id::text||'@example.invalid',now(),jsonb_build_object('full_name','Storage QA '||label,'student_id_number','QAS-'||replace(id::text,'-',''),'course','BSCS','year_level',1) from pg_temp.qa15_storage_subjects;
update public.profiles set verification_status='verified' where id in(select id from pg_temp.qa15_storage_subjects where label in('seller','other'));
insert into public.categories(id,name,slug,is_active) select id,'Storage QA '||id::text,'storage-qa-'||id::text,true from pg_temp.qa15_storage_resources where label='category';

select pg_temp.qa15_storage_login('student'); set local role authenticated;
select pg_temp.qa15_storage_rejected('missing evidence cannot create verification or pending state',format('select public.submit_verification(%L::uuid,%L)',(select id from pg_temp.qa15_storage_resources where label='missing_verification'),auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='missing_verification')||'/student-id.png'),'P0002');
select pg_temp.qa15_storage_assert('failed missing evidence leaves profile unverified', (select verification_status='unverified' from public.profiles where id=auth.uid()));
insert into storage.objects(bucket_id,name,owner_id)
select 'student-verifications',auth.uid()::text||'/'||id::text||'/student-id.png',auth.uid()::text from pg_temp.qa15_storage_resources where label='late_failure_verification';
reset role;
create function pg_temp.qa15_storage_fail_after_verification() returns trigger language plpgsql set search_path='' as $$
begin
  if new.id=(select id from pg_temp.qa15_storage_resources where label='late_failure_verification') then raise exception 'QA injected late verification failure' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger verifications_zz_qa15_injected_failure after insert on public.verifications for each row execute function pg_temp.qa15_storage_fail_after_verification();
select pg_temp.qa15_storage_login('student'); set local role authenticated;
select pg_temp.qa15_storage_rejected('late verification failure propagates to caller',format('select public.submit_verification(%L::uuid,%L)',(select id from pg_temp.qa15_storage_resources where label='late_failure_verification'),auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='late_failure_verification')||'/student-id.png'),'23514');
select pg_temp.qa15_storage_assert('late submission failure rolls profile and verification back together',
  (select verification_status='unverified' from public.profiles where id=auth.uid())
  and not exists(select 1 from public.verifications where id=(select id from pg_temp.qa15_storage_resources where label='late_failure_verification')));
with erased as(delete from storage.objects where bucket_id='student-verifications' and name=auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='late_failure_verification')||'/student-id.png' returning id)
select pg_temp.qa15_storage_assert('failed submission upload remains safely cleanable', (select count(*)=1 from erased));
insert into storage.objects(bucket_id,name,owner_id)
select 'student-verifications',auth.uid()::text||'/'||id::text||'/student-id.png',auth.uid()::text from pg_temp.qa15_storage_resources where label='verification';
select public.submit_verification(id,auth.uid()::text||'/'||id::text||'/student-id.png') from pg_temp.qa15_storage_resources where label='verification';
with erased as(delete from storage.objects where bucket_id='student-verifications' and name=auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='verification')||'/student-id.png' returning id)
select pg_temp.qa15_storage_assert('submitted school ID stays protected from owner deletion', (select count(*)=0 from erased));
with changed as(update storage.objects set metadata='{"changed":true}' where bucket_id='student-verifications' and owner_id=auth.uid()::text returning id)
select pg_temp.qa15_storage_assert('submitted school ID stays protected from owner replacement', (select count(*)=0 from changed));
reset role;
select pg_temp.qa15_storage_rejected('privileged fixture cannot link a nonexistent school ID',format('insert into public.verifications(id,user_id,full_name_snapshot,student_id_number_snapshot,course_snapshot,year_level_snapshot,document_path) values(%L::uuid,%L::uuid,%L,%L,%L,1,%L)',(select id from pg_temp.qa15_storage_resources where label='missing_verification'),(select id from pg_temp.qa15_storage_subjects where label='other'),'Storage QA other','QAS-OTHER','BSCS',(select id::text from pg_temp.qa15_storage_subjects where label='other')||'/'||(select id::text from pg_temp.qa15_storage_resources where label='missing_verification')||'/student-id.png'),'23514');

select pg_temp.qa15_storage_login('seller'); set local role authenticated;
insert into public.listings(id,seller_id,category_id,title,description,price,condition)
select listing.id,auth.uid(),category.id,'Storage QA calculator','Listing used to verify safe publication and failed cleanup.',650,'good' from pg_temp.qa15_storage_resources listing cross join pg_temp.qa15_storage_resources category where listing.label='listing' and category.label='category';
insert into storage.objects(bucket_id,name,owner_id)
select 'listing-images',auth.uid()::text||'/'||listing.id::text||'/'||image.id::text||'.png',auth.uid()::text from pg_temp.qa15_storage_resources listing cross join pg_temp.qa15_storage_resources image where listing.label='listing' and image.label='image';
select pg_temp.qa15_storage_assert('owned draft metadata helper accepts an existing upload',
  private.can_insert_listing_image_metadata((select id from pg_temp.qa15_storage_resources where label='listing'),auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='listing')||'/'||(select id::text from pg_temp.qa15_storage_resources where label='image')||'.png'));
select pg_temp.qa15_storage_assert('owned draft metadata helper refuses a nonexistent upload',
  not private.can_insert_listing_image_metadata((select id from pg_temp.qa15_storage_resources where label='listing'),auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='listing')||'/'||(select id::text from pg_temp.qa15_storage_resources where label='unused_image')||'.png'));
select pg_temp.qa15_storage_rejected('missing upload cannot be linked by direct student metadata insertion',
  format('insert into public.listing_images(listing_id,storage_path,is_cover,sort_order) values(%L::uuid,%L,false,2)',(select id from pg_temp.qa15_storage_resources where label='listing'),auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='listing')||'/'||(select id::text from pg_temp.qa15_storage_resources where label='unused_image')||'.png'),'42501');
select pg_temp.qa15_storage_assert('failed direct metadata link leaves the draft image set unchanged',
  not exists(select 1 from public.listing_images where listing_id=(select id from pg_temp.qa15_storage_resources where label='listing')));
insert into public.listing_images(listing_id,storage_path,is_cover,sort_order)
select listing.id,auth.uid()::text||'/'||listing.id::text||'/'||image.id::text||'.png',true,0 from pg_temp.qa15_storage_resources listing cross join pg_temp.qa15_storage_resources image where listing.label='listing' and image.label='image';
with changed as(update storage.objects set metadata='{"mimetype":"image/png","size":128}' where bucket_id='listing-images' and owner_id=auth.uid()::text returning id)
select pg_temp.qa15_storage_assert('owned draft image metadata remains replaceable', (select count(*)=1 from changed));
with erased as(delete from storage.objects where bucket_id='listing-images' and owner_id=auth.uid()::text returning id)
select pg_temp.qa15_storage_assert('draft cleanup can remove an upload before publication', (select count(*)=1 from erased));
select pg_temp.qa15_storage_rejected('publication rejects a draft whose upload was removed first',format('select public.publish_listing(%L::uuid)',(select id from pg_temp.qa15_storage_resources where label='listing')),'23514');
select pg_temp.qa15_storage_assert('failed publication leaves draft private and metadata unchanged',
  (select status='draft' from public.listings where id=(select id from pg_temp.qa15_storage_resources where label='listing'))
  and (select count(*)=1 from public.listing_images where listing_id=(select id from pg_temp.qa15_storage_resources where label='listing')));
insert into storage.objects(bucket_id,name,owner_id)
select 'listing-images',auth.uid()::text||'/'||listing.id::text||'/'||image.id::text||'.png',auth.uid()::text from pg_temp.qa15_storage_resources listing cross join pg_temp.qa15_storage_resources image where listing.label='listing' and image.label='image';
select public.publish_listing(id) from pg_temp.qa15_storage_resources where label='listing';
with erased as(delete from storage.objects where bucket_id='listing-images' and owner_id=auth.uid()::text returning id)
select pg_temp.qa15_storage_assert('published referenced image survives owner cleanup', (select count(*)=0 from erased));
with changed as(update storage.objects set metadata='{"changed":true}' where bucket_id='listing-images' and owner_id=auth.uid()::text returning id)
select pg_temp.qa15_storage_assert('published referenced image cannot be overwritten', (select count(*)=0 from changed));
insert into storage.objects(bucket_id,name,owner_id)
select 'listing-images',auth.uid()::text||'/'||listing.id::text||'/'||image.id::text||'.png',auth.uid()::text from pg_temp.qa15_storage_resources listing cross join pg_temp.qa15_storage_resources image where listing.label='listing' and image.label='unused_image';
-- The earlier positive helper result is deliberately not reused: a caller's
-- prior draft observation must not authorize a link after publication. These
-- sequential checks exercise the fresh state gate; a real blocked two-session
-- INSERT/publication race is separately required from the hosted QA runner.
select pg_temp.qa15_storage_assert('previously accepted draft observation is rechecked after publication',
  not private.can_insert_listing_image_metadata((select id from pg_temp.qa15_storage_resources where label='listing'),auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='listing')||'/'||(select id::text from pg_temp.qa15_storage_resources where label='image')||'.png'));
select pg_temp.qa15_storage_rejected('direct metadata insertion cannot append to a published listing',
  format('insert into public.listing_images(listing_id,storage_path,is_cover,sort_order) values(%L::uuid,%L,false,2)',(select id from pg_temp.qa15_storage_resources where label='listing'),auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='listing')||'/'||(select id::text from pg_temp.qa15_storage_resources where label='unused_image')||'.png'),'42501');
select pg_temp.qa15_storage_assert('rejected published append preserves the contiguous cover image set',
  (select count(*)=1 and bool_and(sort_order=0 and is_cover) from public.listing_images where listing_id=(select id from pg_temp.qa15_storage_resources where label='listing')));
with erased as(delete from storage.objects where bucket_id='listing-images' and name=auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='listing')||'/'||(select id::text from pg_temp.qa15_storage_resources where label='unused_image')||'.png' returning id)
select pg_temp.qa15_storage_assert('unlinked replacement upload remains cleanable without harming current image',(select count(*)=1 from erased));
insert into storage.objects(bucket_id,name,owner_id)
select 'listing-images',auth.uid()::text||'/'||listing.id::text||'/'||image.id::text||'.png',auth.uid()::text from pg_temp.qa15_storage_resources listing cross join pg_temp.qa15_storage_resources image where listing.label='listing' and image.label='replacement_image';
select public.update_owned_listing(
  (select id from pg_temp.qa15_storage_resources where label='listing'),
  (select updated_at from public.listings where id=(select id from pg_temp.qa15_storage_resources where label='listing')),
  'Storage QA available calculator','Published listing image replacement stays protected and functional.',
  (select id from pg_temp.qa15_storage_resources where label='category'),650,'good',
  array[auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='listing')||'/'||(select id::text from pg_temp.qa15_storage_resources where label='replacement_image')||'.png']);
select pg_temp.qa15_storage_assert('trusted listing edit replaces available image metadata without a direct insert bypass',
  (select status='available' from public.listings where id=(select id from pg_temp.qa15_storage_resources where label='listing'))
  and (select count(*)=1 and bool_and(is_cover and sort_order=0 and storage_path=auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='listing')||'/'||(select id::text from pg_temp.qa15_storage_resources where label='replacement_image')||'.png') from public.listing_images where listing_id=(select id from pg_temp.qa15_storage_resources where label='listing')));
with erased as(delete from storage.objects where bucket_id='listing-images' and name=auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='listing')||'/'||(select id::text from pg_temp.qa15_storage_resources where label='image')||'.png' returning id)
select pg_temp.qa15_storage_assert('old unlinked image is safely cleanable after a trusted published edit',(select count(*)=1 from erased));
reset role;
select pg_temp.qa15_storage_login('other'); set local role authenticated;
select set_config('qa15_storage.reservation_id',public.request_reservation((select id from pg_temp.qa15_storage_resources where label='listing'),'Storage QA reserved image replacement.')::text,true);
reset role;
select pg_temp.qa15_storage_login('seller'); set local role authenticated;
select public.accept_reservation(current_setting('qa15_storage.reservation_id')::uuid);
insert into storage.objects(bucket_id,name,owner_id)
select 'listing-images',auth.uid()::text||'/'||listing.id::text||'/'||image.id::text||'.png',auth.uid()::text from pg_temp.qa15_storage_resources listing cross join pg_temp.qa15_storage_resources image where listing.label='listing' and image.label='reserved_image';
select public.update_owned_listing(
  (select id from pg_temp.qa15_storage_resources where label='listing'),
  (select updated_at from public.listings where id=(select id from pg_temp.qa15_storage_resources where label='listing')),
  'Storage QA reserved calculator','Reserved listing image replacement keeps the accepted reservation.',
  (select id from pg_temp.qa15_storage_resources where label='category'),650,'good',
  array[auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='listing')||'/'||(select id::text from pg_temp.qa15_storage_resources where label='reserved_image')||'.png']);
select pg_temp.qa15_storage_assert('trusted listing edit replaces reserved images without changing the accepted lifecycle',
  (select status='reserved' from public.listings where id=(select id from pg_temp.qa15_storage_resources where label='listing'))
  and (select status='accepted' from public.reservations where id=current_setting('qa15_storage.reservation_id')::uuid)
  and (select count(*)=1 and bool_and(is_cover and sort_order=0 and storage_path=auth.uid()::text||'/'||(select id::text from pg_temp.qa15_storage_resources where label='listing')||'/'||(select id::text from pg_temp.qa15_storage_resources where label='reserved_image')||'.png') from public.listing_images where listing_id=(select id from pg_temp.qa15_storage_resources where label='listing')));
reset role;
select pg_temp.qa15_storage_login('other'); set local role authenticated;
select pg_temp.qa15_storage_assert('metadata locking helper cannot authorize another sellers resource',
  not private.can_insert_listing_image_metadata((select id from pg_temp.qa15_storage_resources where label='listing'),(select id::text from pg_temp.qa15_storage_subjects where label='seller')||'/'||(select id::text from pg_temp.qa15_storage_resources where label='listing')||'/'||(select id::text from pg_temp.qa15_storage_resources where label='reserved_image')||'.png'));
with erased as(delete from storage.objects where bucket_id='listing-images' and owner_id=(select id::text from pg_temp.qa15_storage_subjects where label='seller') returning id)
select pg_temp.qa15_storage_assert('other student cannot delete a known seller image', (select count(*)=0 from erased));
reset role;
select scenario,passed,observed from pg_temp.qa15_storage_results order by scenario;
select '__all_storage_lifecycle_rls_checks_passed__' as scenario,count(*) as tests_run,bool_and(passed) and count(*)=27 as all_passed from pg_temp.qa15_storage_results;
rollback;
