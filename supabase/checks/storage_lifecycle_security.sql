-- Step 15 Storage concurrency hardening catalog checks. Read-only.
with helpers as (
  select function.* from pg_proc function where function.oid in (
    to_regprocedure('private.can_delete_verification_object(text,text)'),
    to_regprocedure('private.can_delete_listing_image_object(text,text)'),
    to_regprocedure('private.can_update_listing_image_object(text,text)'),
    to_regprocedure('private.can_insert_listing_image_metadata(uuid,text)')
  )
), checks(check_name, passed) as (
  values
    ('storage lifecycle authorization helpers are volatile security definer with fixed search paths',
      (select count(*) = 4 and bool_and(provolatile = 'v' and prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']::text[]) from helpers)),
    ('storage lifecycle helpers are authenticated-only without PUBLIC execution',
      (select count(*) = 4 and bool_and(has_function_privilege('authenticated',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE')) from helpers)
      and not exists(select 1 from helpers helper cross join lateral aclexplode(coalesce(helper.proacl,acldefault('f',helper.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE')),
    ('verification cleanup locks profile before checking submitted history',
      pg_get_functiondef(to_regprocedure('private.can_delete_verification_object(text,text)')) ilike '%from public.profiles%for update%not exists%from public.verifications%'),
    ('verification link validates real owned document with parent-first object lock',
      pg_get_functiondef(to_regprocedure('private.lock_verification_document()')) ilike '%from public.profiles%for update%from storage.objects%document.owner_id = new.user_id::text%for key share%'),
    ('verification linking trigger is enabled before insert',
      exists(select 1 from pg_trigger where tgrelid='public.verifications'::regclass and tgname='verifications_30_lock_document' and tgenabled='O' and not tgisinternal and (tgtype & 7) = 7)),
    ('restrictive verification cleanup gate uses serialized helper',
      exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Submitted verification objects cannot be deleted' and permissive='RESTRICTIVE' and cmd='DELETE' and qual ilike '%can_delete_verification_object%')),
    ('listing cleanup and draft replacement lock latest parent state',
      pg_get_functiondef(to_regprocedure('private.can_delete_listing_image_object(text,text)')) ilike '%from public.listings%for update%v_listing.status = ''draft''%not exists%public.listing_images%'
      and pg_get_functiondef(to_regprocedure('private.can_update_listing_image_object(text,text)')) ilike '%from public.listings%for update%v_listing.status = ''draft''%'),
    ('publication pins actual owned Storage objects in deterministic order',
      pg_get_functiondef(to_regprocedure('private.lock_listing_publication_images()')) ilike '%from storage.objects%object.owner_id = new.seller_id::text%order by object.name%for key share of object%'
      and exists(select 1 from pg_trigger where tgrelid='public.listings'::regclass and tgname='listings_30_lock_publication_images' and tgenabled='O' and not tgisinternal)),
    ('direct image metadata insertion rechecks locked owned draft before pinning the upload',
      pg_get_functiondef(to_regprocedure('private.can_insert_listing_image_metadata(uuid,text)')) ilike '%from public.listings%id = p_listing_id and seller_id = v_user_id%for update%v_status <> ''draft''%from storage.objects%object.owner_id = v_user_id::text%for key share%'),
    ('metadata gate preserves invoker identity and is enabled before insert',
      exists(select 1 from pg_proc where oid=to_regprocedure('private.lock_student_listing_image_insert()') and not prosecdef and provolatile='v' and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']::text[])
      and pg_get_functiondef(to_regprocedure('private.lock_student_listing_image_insert()')) ilike '%current_user = ''authenticated''%can_insert_listing_image_metadata%'
      and exists(select 1 from pg_trigger where tgrelid='public.listing_images'::regclass and tgname='listing_images_30_lock_student_insert' and tgenabled='O' and not tgisinternal and (tgtype & 7)=7)),
    ('link and publication trigger functions are not exposed as client RPCs',
      not has_function_privilege('authenticated','private.lock_verification_document()','EXECUTE')
      and not has_function_privilege('authenticated','private.lock_listing_publication_images()','EXECUTE')
      and not has_function_privilege('anon','private.lock_verification_document()','EXECUTE')
      and not has_function_privilege('anon','private.lock_listing_publication_images()','EXECUTE')
      and not has_function_privilege('authenticated','private.lock_student_listing_image_insert()','EXECUTE')
      and not has_function_privilege('anon','private.lock_student_listing_image_insert()','EXECUTE'))
)
select check_name,coalesce(passed,false) as passed from checks
union all select '__all_storage_lifecycle_security_checks_passed__',bool_and(coalesce(passed,false)) from checks
order by check_name;
