begin;

-- Step 14 extends the existing identity record; no duplicate profile table or
-- public copy of private account information is introduced.

-- Names, student identifiers and courses were reviewed against a verification
-- submission. Keep those values fixed after approval, while allowing verified
-- students to advance their year level. Pending snapshots remain fully frozen.
create or replace function private.protect_verified_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) = old.id
    and not (select private.is_active_admin())
  then
    if old.verification_status = 'pending'
      and (
        new.full_name is distinct from old.full_name
        or new.student_id_number is distinct from old.student_id_number
        or new.course is distinct from old.course
        or new.year_level is distinct from old.year_level
      )
    then
      raise exception 'Identity fields cannot change while verification is pending.'
        using errcode = '42501';
    end if;

    if old.verification_status = 'verified'
      and (
        new.full_name is distinct from old.full_name
        or new.student_id_number is distinct from old.student_id_number
        or new.course is distinct from old.course
      )
    then
      raise exception 'Verified identity fields require administrator review.'
        using errcode = '42501';
    end if;

    -- Legacy registrations may have incomplete identity until corrected. An
    -- authenticated edit must not turn existing required identity back into
    -- blanks; unrelated avatar updates can still preserve legacy null values.
    if (new.full_name is distinct from old.full_name and new.full_name is null)
      or (new.course is distinct from old.course and new.course is null)
      or (new.year_level is distinct from old.year_level and new.year_level is null)
    then
      raise exception 'Edited profile identity must not be blank.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.protect_verified_identity() from public, anon, authenticated;

-- Append only this trusted public timestamp to the fixed, gated projection.
-- Email, student ID, account status and verification records stay excluded.
create or replace view public.marketplace_profiles
with (security_barrier = true)
as
select id, full_name, course, year_level, avatar_path, verification_status,
  created_at
from public.profiles
where role = 'student'
  and verification_status = 'verified'
  and account_status = 'active'
  and (
    (select private.is_verified_active_student())
    or (select private.is_active_admin())
  );
revoke all on table public.marketplace_profiles from public, anon, authenticated;
grant select on table public.marketplace_profiles to authenticated;
comment on view public.marketplace_profiles is
  'Fixed safe seller identity and join date; accessible only to verified active students and active administrators.';

-- New uploads use immutable unique object names. Continue reading and safely
-- replacing existing owned avatar.ext objects without rewriting user data.
create or replace function private.is_valid_avatar_path(p_name text, p_user_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name is not null and p_user_id is not null
    and p_name ~ (
      '^' || p_user_id::text || '/(avatar\.(jpg|jpeg|png|webp)|'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp))$'
    );
$$;
revoke all on function private.is_valid_avatar_path(text, uuid) from public, anon;
grant execute on function private.is_valid_avatar_path(text, uuid) to authenticated;

alter table public.profiles drop constraint profiles_avatar_path_check;
alter table public.profiles add constraint profiles_avatar_path_check check (
  avatar_path is null or private.is_valid_avatar_path(avatar_path, id)
);

-- Linking is separate from uploading: validate that a real avatar object
-- belongs to this profile, never a verification document or another user.
-- Unchanged legacy links remain readable even if their old object disappeared.
create or replace function private.validate_profile_avatar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.avatar_path is not distinct from old.avatar_path then
    return new;
  end if;
  if new.avatar_path is null then
    return new;
  end if;
  if not private.is_valid_avatar_path(new.avatar_path, new.id) then
    raise exception 'Profile photo path is invalid.' using errcode = '23514';
  end if;

  perform 1
  from storage.objects as avatar
  where avatar.bucket_id = 'avatars'
    and avatar.name = new.avatar_path
    and avatar.owner_id = new.id::text
  for key share;
  if not found then
    raise exception 'Profile photo must reference an existing owned avatar.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_profile_avatar() from public, anon, authenticated;
create trigger profiles_30_validate_avatar
before insert or update of avatar_path on public.profiles
for each row execute function private.validate_profile_avatar();

-- Reassert the explicit editable-column grant. RLS additionally requires an
-- active owner and the identity trigger protects reviewed values.
revoke update on table public.profiles from public, anon, authenticated;
revoke update (id, role, verification_status, account_status, created_at, updated_at)
  on table public.profiles from public, anon, authenticated;
grant update (full_name, student_id_number, course, year_level, avatar_path)
  on table public.profiles to authenticated;

update storage.buckets
set public = true,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'avatars';

create or replace function private.can_manage_avatar_object(p_name text, p_owner_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (select private.is_active_account())
    and p_owner_id = (select auth.uid()::text)
    and private.is_valid_avatar_path(p_name, (select auth.uid()));
$$;

create or replace function private.can_delete_avatar_object(p_name text, p_owner_id text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if not private.can_manage_avatar_object(p_name, p_owner_id) then
    return false;
  end if;
  -- Serialize unlink/delete with profile updates. The lock is acquired before
  -- the Storage row mutation, matching the profile -> object lock order used
  -- when linking. A concurrent link cannot leave a dangling current avatar.
  select * into v_profile from public.profiles
  where id = (select auth.uid()) for update;
  return found and v_profile.account_status = 'active'
    and v_profile.avatar_path is distinct from p_name;
end;
$$;
revoke all on function private.can_manage_avatar_object(text, text) from public, anon;
revoke all on function private.can_delete_avatar_object(text, text) from public, anon;
grant execute on function private.can_manage_avatar_object(text, text) to authenticated;
grant execute on function private.can_delete_avatar_object(text, text) to authenticated;

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and private.can_manage_avatar_object(name, owner_id));

drop policy if exists "Users can update their own avatar" on storage.objects;
-- Deliberately no avatar UPDATE policy: replacement uploads a fresh object and
-- links it after success, so upsert never destroys the current image.

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and private.can_delete_avatar_object(name, owner_id));

-- Restrictive bucket-specific gates also prevent future permissive policies
-- from accidentally reopening another owner's avatar or mutable upserts.
create policy "Avatar inserts require active ownership"
on storage.objects as restrictive for insert to authenticated
with check (bucket_id <> 'avatars' or private.can_manage_avatar_object(name, owner_id));

create policy "Avatar objects are immutable"
on storage.objects as restrictive for update to authenticated
using (bucket_id <> 'avatars') with check (bucket_id <> 'avatars');

create policy "Avatar deletes protect the linked image"
on storage.objects as restrictive for delete to authenticated
using (bucket_id <> 'avatars' or private.can_delete_avatar_object(name, owner_id));

comment on function private.validate_profile_avatar() is
  'Only new or changed profile photos must reference an existing avatar object owned by the profile ID.';
comment on function private.can_delete_avatar_object(text, text) is
  'Active owners can clean up only their own unlinked avatars; the currently linked photo is protected.';

commit;
