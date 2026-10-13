begin;

-- Step 15: serialize Storage cleanup with the parent resource that may link
-- an upload. RLS visibility checks alone are not locks: a delete authorized
-- before publication/submission could otherwise remove a newly linked file.
-- Lock order is always profile/listing -> Storage object. No applied migration
-- is rewritten, no existing identity data or Storage objects are changed.

create or replace function private.can_delete_verification_object(p_name text, p_owner_id text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null
    or p_owner_id is distinct from v_user_id::text
    or (storage.foldername(p_name))[1] is distinct from v_user_id::text
  then
    return false;
  end if;
  -- Match submit_verification()'s existing first lock. The following volatile
  -- SELECT takes a fresh snapshot after a competing submission commits.
  perform 1 from public.profiles where id = v_user_id for update;
  if not found then return false; end if;
  return not exists (
    select 1 from public.verifications
    where user_id = v_user_id and document_path = p_name
  );
end;
$$;
revoke all on function private.can_delete_verification_object(text, text) from public, anon;
grant execute on function private.can_delete_verification_object(text, text) to authenticated;

alter policy "Students can delete unsubmitted verification documents"
on storage.objects using (
  bucket_id = 'student-verifications'
  and private.can_delete_verification_object(name, owner_id)
);
alter policy "Submitted verification objects cannot be deleted"
on storage.objects using (
  bucket_id <> 'student-verifications'
  or private.can_delete_verification_object(name, owner_id)
);

create or replace function private.lock_verification_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- submit_verification() already owns this lock. Reassert it for trusted SQL
  -- insertions as well, without expanding any ordinary client insert grants.
  perform 1 from public.profiles where id = new.user_id for update;
  if not found then
    raise exception 'Verification profile was not found.' using errcode = '23514';
  end if;
  perform 1 from storage.objects as document
  where document.bucket_id = 'student-verifications'
    and document.name = new.document_path
    and document.owner_id = new.user_id::text
  for key share;
  if not found then
    raise exception 'Verification must reference an existing owned school ID.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.lock_verification_document() from public, anon, authenticated;
create trigger verifications_30_lock_document
before insert on public.verifications
for each row execute function private.lock_verification_document();

create or replace function private.can_delete_listing_image_object(p_name text, p_owner_id text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing public.listings%rowtype;
begin
  if v_user_id is null or not (select private.is_verified_active_student())
    or p_owner_id is distinct from v_user_id::text
    or cardinality(storage.foldername(p_name)) is distinct from 2
    or (storage.foldername(p_name))[1] is distinct from v_user_id::text
    or lower(storage.extension(p_name)) not in ('jpg', 'jpeg', 'png', 'webp')
  then return false; end if;
  -- Parent-first order agrees with publish/edit/remove RPCs. A draft cleanup
  -- that wins first makes publication fail; publication that wins first makes
  -- this fresh read refuse deletion of its referenced image.
  select * into v_listing from public.listings
  where id::text = (storage.foldername(p_name))[2] and seller_id = v_user_id
  for update;
  return found and (
    v_listing.status = 'draft'
    or not exists (select 1 from public.listing_images where storage_path = p_name)
  );
end;
$$;

create or replace function private.can_update_listing_image_object(p_name text, p_owner_id text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_listing public.listings%rowtype;
begin
  if not private.can_upload_listing_image_object(p_name, p_owner_id) then
    return false;
  end if;
  -- Draft overwrites also serialize with publication. An UPDATE cannot use a
  -- previously observed draft state to replace an already published image.
  select * into v_listing from public.listings
  where id::text = (storage.foldername(p_name))[2]
    and seller_id = (select auth.uid())
  for update;
  return found and v_listing.status = 'draft';
end;
$$;
revoke all on function private.can_delete_listing_image_object(text, text) from public, anon;
revoke all on function private.can_update_listing_image_object(text, text) from public, anon;
grant execute on function private.can_delete_listing_image_object(text, text) to authenticated;
grant execute on function private.can_update_listing_image_object(text, text) to authenticated;

create or replace function private.can_insert_listing_image_metadata(
  p_listing_id uuid,
  p_storage_path text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_status text;
begin
  if v_user_id is null or p_listing_id is null
    or not (select private.is_verified_active_student())
    or cardinality(storage.foldername(p_storage_path)) is distinct from 2
    or (storage.foldername(p_storage_path))[1] is distinct from v_user_id::text
    or (storage.foldername(p_storage_path))[2] is distinct from p_listing_id::text
    or lower(storage.extension(p_storage_path)) not in ('jpg', 'jpeg', 'png', 'webp')
  then return false; end if;
  -- RLS's draft check uses the INSERT statement snapshot. Its later FK lock
  -- can wait behind publication without refreshing that check. Lock first and
  -- inspect the current parent before any ordinary student metadata INSERT.
  select status into v_status from public.listings
  where id = p_listing_id and seller_id = v_user_id
  for update;
  if not found or v_status <> 'draft' then return false; end if;
  -- Match cleanup/publication's parent -> object order and hold the actual
  -- owned upload until the metadata INSERT commits.
  perform 1 from storage.objects as object
  where object.bucket_id = 'listing-images'
    and object.name = p_storage_path and object.owner_id = v_user_id::text
  for key share;
  return found;
end;
$$;
revoke all on function private.can_insert_listing_image_metadata(uuid, text) from public, anon;
grant execute on function private.can_insert_listing_image_metadata(uuid, text) to authenticated;

create or replace function private.lock_student_listing_image_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Preserve the invoker here: SECURITY DEFINER would erase the distinction
  -- between a direct authenticated INSERT and update_owned_listing()'s trusted
  -- replacement of available/reserved metadata. That RPC already locks the
  -- parent and each owned upload and validates the complete replacement set.
  if current_user = 'authenticated' then
    if not private.can_insert_listing_image_metadata(new.listing_id, new.storage_path) then
      raise exception 'Listing images can only be added to an owned draft with an existing upload.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.lock_student_listing_image_insert() from public, anon, authenticated;
create trigger listing_images_30_lock_student_insert
before insert on public.listing_images
for each row execute function private.lock_student_listing_image_insert();

create or replace function private.lock_listing_publication_images()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'draft' or new.status <> 'available' then return new; end if;
  -- The enclosing listing UPDATE already holds the first lock. Keep every
  -- actual object alive until publication commits, as update_owned_listing()
  -- already does for an edited image set. Deterministic object order prevents
  -- multi-image lock-order inversion.
  perform 1 from storage.objects as object
  join public.listing_images as image
    on object.bucket_id = 'listing-images' and object.name = image.storage_path
  where image.listing_id = new.id and object.owner_id = new.seller_id::text
  order by object.name
  for key share of object;
  if not exists (select 1 from public.listing_images where listing_id = new.id)
    or exists (
      select 1 from public.listing_images as image
      where image.listing_id = new.id and not exists (
        select 1 from storage.objects as object
        where object.bucket_id = 'listing-images'
          and object.name = image.storage_path
          and object.owner_id = new.seller_id::text
      )
    )
  then
    raise exception 'Published listing images must reference existing owned uploads.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.lock_listing_publication_images() from public, anon, authenticated;
create trigger listings_30_lock_publication_images
before update of status on public.listings
for each row execute function private.lock_listing_publication_images();

comment on function private.can_delete_verification_object(text, text) is
  'Owner cleanup locks the profile before checking immutable verification history; submitted documents remain protected under concurrency.';
comment on function private.can_delete_listing_image_object(text, text) is
  'Owner cleanup locks the listing before checking its latest status and image references; unlinked sold/removed uploads remain cleanable.';
comment on function private.lock_listing_publication_images() is
  'Publication holds owned image objects through commit using parent-first locking, without rewriting legacy published listing rows.';
comment on function private.can_insert_listing_image_metadata(uuid, text) is
  'Ordinary student image links lock and recheck their owned draft, then pin its actual owned upload; stale draft snapshots cannot append to published listings.';
comment on function private.lock_student_listing_image_insert() is
  'Invoker trigger serializes direct student image links without blocking the separately validated trusted listing-edit RPC.';

commit;
