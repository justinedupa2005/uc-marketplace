begin;

-- Identity and verification foundation. This migration intentionally builds on
-- 20260917000000_create_marketplace_core.sql instead of modifying it.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  student_id_number text,
  course text,
  year_level smallint,
  avatar_path text,
  role text not null default 'student',
  verification_status text not null default 'unverified',
  account_status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_check check (
    full_name is null
    or char_length(btrim(full_name)) between 2 and 100
  ),
  constraint profiles_student_id_number_check check (
    student_id_number is null
    or char_length(btrim(student_id_number)) between 1 and 50
  ),
  constraint profiles_course_check check (
    course is null
    or char_length(btrim(course)) between 1 and 120
  ),
  constraint profiles_year_level_check check (
    year_level is null
    or year_level between 1 and 6
  ),
  constraint profiles_avatar_path_check check (
    avatar_path is null
    or avatar_path ~ (
      '^' || id::text || '/avatar\.(jpg|jpeg|png|webp)$'
    )
  ),
  constraint profiles_role_check check (role in ('student', 'admin')),
  constraint profiles_verification_status_check check (
    verification_status in ('unverified', 'pending', 'verified', 'rejected')
  ),
  constraint profiles_account_status_check check (
    account_status in ('active', 'suspended', 'disabled')
  )
);

create unique index if not exists profiles_student_id_number_key
  on public.profiles (lower(student_id_number))
  where student_id_number is not null;

create index if not exists profiles_verification_status_idx
  on public.profiles (verification_status);

create index if not exists profiles_account_status_idx
  on public.profiles (account_status);

-- ---------------------------------------------------------------------------
-- Verification submissions
-- ---------------------------------------------------------------------------

create table if not exists public.verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name_snapshot text not null,
  student_id_number_snapshot text not null,
  course_snapshot text not null,
  year_level_snapshot smallint not null,
  document_path text not null unique,
  status text not null default 'pending',
  rejection_reason text,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint verifications_full_name_snapshot_check check (
    char_length(btrim(full_name_snapshot)) between 2 and 100
  ),
  constraint verifications_student_id_snapshot_check check (
    char_length(btrim(student_id_number_snapshot)) between 1 and 50
  ),
  constraint verifications_course_snapshot_check check (
    char_length(btrim(course_snapshot)) between 1 and 120
  ),
  constraint verifications_year_level_snapshot_check check (
    year_level_snapshot between 1 and 6
  ),
  constraint verifications_document_path_check check (
    document_path ~ (
      '^' || user_id::text || '/' || id::text
      || '/student-id\.(jpg|jpeg|png|webp)$'
    )
  ),
  constraint verifications_status_check check (
    status in ('pending', 'approved', 'rejected')
  ),
  constraint verifications_review_state_check check (
    (
      status = 'pending'
      and rejection_reason is null
      and reviewed_by is null
      and reviewed_at is null
    )
    or (
      status = 'approved'
      and rejection_reason is null
      and reviewed_by is not null
      and reviewed_at is not null
      and reviewed_at >= submitted_at
    )
    or (
      status = 'rejected'
      and rejection_reason is not null
      and char_length(btrim(rejection_reason)) between 1 and 1000
      and reviewed_by is not null
      and reviewed_at is not null
      and reviewed_at >= submitted_at
    )
  )
);

-- A rejected student may submit again, but only one request may be pending at
-- a time. This also closes a race that an application-only check would leave.
create unique index if not exists one_pending_verification_per_user
  on public.verifications (user_id)
  where status = 'pending';

create index if not exists verifications_user_submitted_at_idx
  on public.verifications (user_id, submitted_at desc);

create index if not exists verifications_status_submitted_at_idx
  on public.verifications (status, submitted_at asc);

-- ---------------------------------------------------------------------------
-- Reusable helpers and triggers
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and account_status = 'active'
  );
$$;

create or replace function private.is_active_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and account_status = 'active'
  );
$$;

create or replace function private.is_verified_active_student()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'student'
      and verification_status = 'verified'
      and account_status = 'active'
  );
$$;

create or replace function private.is_marketplace_seller(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = p_user_id
      and role = 'student'
      and verification_status = 'verified'
      and account_status = 'active'
  );
$$;

revoke all on function private.set_updated_at() from public;
revoke all on function private.is_active_admin() from public, anon;
revoke all on function private.is_active_account() from public, anon;
revoke all on function private.is_verified_active_student() from public, anon;
revoke all on function private.is_marketplace_seller(uuid) from public, anon;

grant execute on function private.is_active_admin() to authenticated;
grant execute on function private.is_active_account() to authenticated;
grant execute on function private.is_verified_active_student() to authenticated;
grant execute on function private.is_marketplace_seller(uuid) to authenticated;

create or replace function private.normalize_profile_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.full_name := nullif(btrim(new.full_name), '');
  new.student_id_number := nullif(btrim(new.student_id_number), '');
  new.course := nullif(btrim(new.course), '');
  new.avatar_path := nullif(btrim(new.avatar_path), '');
  return new;
end;
$$;

-- Identity data is frozen while a submission is pending. Once verified,
-- students may still update their display name, but reviewed academic identity
-- fields require a trusted administrator correction.
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
        new.student_id_number is distinct from old.student_id_number
        or new.course is distinct from old.course
        or new.year_level is distinct from old.year_level
      )
    then
      raise exception 'Verified identity fields require administrator review.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_profile_fields() from public;
revoke all on function private.protect_verified_identity() from public;

drop trigger if exists profiles_10_normalize_fields on public.profiles;
create trigger profiles_10_normalize_fields
before insert or update on public.profiles
for each row execute function private.normalize_profile_fields();

drop trigger if exists profiles_20_protect_verified_identity on public.profiles;
create trigger profiles_20_protect_verified_identity
before update on public.profiles
for each row execute function private.protect_verified_identity();

drop trigger if exists profiles_90_set_updated_at on public.profiles;
create trigger profiles_90_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

drop trigger if exists verifications_90_set_updated_at on public.verifications;
create trigger verifications_90_set_updated_at
before update on public.verifications
for each row execute function private.set_updated_at();

drop trigger if exists listings_90_set_updated_at on public.listings;
create trigger listings_90_set_updated_at
before update on public.listings
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Automatic profile creation and backfill
-- ---------------------------------------------------------------------------

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  metadata_full_name text;
begin
  metadata_full_name := btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  if char_length(metadata_full_name) not between 2 and 100 then
    metadata_full_name := null;
  end if;

  insert into public.profiles (
    id,
    full_name,
    role,
    verification_status,
    account_status
  )
  values (
    new.id,
    metadata_full_name,
    'student',
    'unverified',
    'active'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- Existing Auth users predate the trigger. Backfill them with safe defaults and
-- copy only the non-privileged full_name metadata claim.
insert into public.profiles (
  id,
  full_name,
  role,
  verification_status,
  account_status
)
select
  users.id,
  case
    when char_length(btrim(coalesce(users.raw_user_meta_data ->> 'full_name', '')))
      between 2 and 100
    then btrim(users.raw_user_meta_data ->> 'full_name')
    else null
  end,
  'student',
  'unverified',
  'active'
from auth.users as users
on conflict (id) do nothing;

-- A valid student submission immediately moves the profile to pending in the
-- same transaction. Approval/rejection is handled separately by the admin RPC.
create or replace function private.mark_verification_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set verification_status = 'pending'
  where id = new.user_id
    and role = 'student'
    and verification_status in ('unverified', 'rejected')
    and account_status = 'active';

  if not found then
    raise exception 'This account cannot submit a verification request.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.mark_verification_pending() from public;

drop trigger if exists verifications_20_mark_profile_pending
  on public.verifications;
create trigger verifications_20_mark_profile_pending
after insert on public.verifications
for each row execute function private.mark_verification_pending();

-- ---------------------------------------------------------------------------
-- Atomic administrator review RPC
-- ---------------------------------------------------------------------------

create or replace function public.review_verification(
  p_verification_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  verification_row public.verifications%rowtype;
  normalized_decision text := lower(btrim(p_decision));
  normalized_reason text := nullif(btrim(p_rejection_reason), '');
begin
  if (select auth.uid()) is null
    or not (select private.is_active_admin())
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  if normalized_decision is null
    or normalized_decision not in ('approved', 'rejected')
  then
    raise exception 'Decision must be approved or rejected.'
      using errcode = '22023';
  end if;

  if normalized_decision = 'rejected' and normalized_reason is null then
    raise exception 'A rejection reason is required.'
      using errcode = '22023';
  end if;

  if normalized_reason is not null and char_length(normalized_reason) > 1000 then
    raise exception 'The rejection reason is too long.'
      using errcode = '22023';
  end if;

  select *
  into verification_row
  from public.verifications
  where id = p_verification_id
  for update;

  if not found then
    raise exception 'Verification request was not found.'
      using errcode = 'P0002';
  end if;

  if verification_row.status <> 'pending' then
    raise exception 'Only pending verification requests can be reviewed.'
      using errcode = 'P0001';
  end if;

  if normalized_decision = 'approved' then
    update public.profiles
    set
      full_name = verification_row.full_name_snapshot,
      student_id_number = verification_row.student_id_number_snapshot,
      course = verification_row.course_snapshot,
      year_level = verification_row.year_level_snapshot,
      verification_status = 'verified'
    where id = verification_row.user_id
      and role = 'student'
      and account_status = 'active';

    if not found then
      raise exception 'The student account is not eligible for approval.'
        using errcode = '42501';
    end if;
  else
    update public.profiles
    set verification_status = 'rejected'
    where id = verification_row.user_id
      and role = 'student';

    if not found then
      raise exception 'The student profile was not found.'
        using errcode = 'P0002';
    end if;
  end if;

  update public.verifications
  set
    status = normalized_decision,
    rejection_reason = case
      when normalized_decision = 'rejected' then normalized_reason
      else null
    end,
    reviewed_by = (select auth.uid()),
    reviewed_at = now()
  where id = p_verification_id;
end;
$$;

revoke all on function public.review_verification(uuid, text, text)
  from public, anon;
grant execute on function public.review_verification(uuid, text, text)
  to authenticated;

-- Account moderation is separate from ordinary profile updates. There is no
-- corresponding role-change RPC, so the first admin must still be bootstrapped
-- manually by a trusted database operator.
create or replace function public.admin_set_account_status(
  p_user_id uuid,
  p_account_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_status text := lower(btrim(p_account_status));
begin
  if (select auth.uid()) is null
    or not (select private.is_active_admin())
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  if normalized_status is null
    or normalized_status not in ('active', 'suspended', 'disabled')
  then
    raise exception 'Invalid account status.'
      using errcode = '22023';
  end if;

  if p_user_id = (select auth.uid()) and normalized_status <> 'active' then
    raise exception 'Administrators cannot suspend or disable themselves.'
      using errcode = '22023';
  end if;

  update public.profiles
  set account_status = normalized_status
  where id = p_user_id;

  if not found then
    raise exception 'Profile was not found.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_set_account_status(uuid, text)
  from public, anon;
grant execute on function public.admin_set_account_status(uuid, text)
  to authenticated;

-- Moderation removes a listing from marketplace results without destroying its
-- audit history or allowing an admin to rewrite a seller's price/description.
create or replace function public.admin_remove_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (select private.is_active_admin())
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  update public.listings
  set status = 'removed'
  where id = p_listing_id;

  if not found then
    raise exception 'Listing was not found.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_remove_listing(uuid) from public, anon;
grant execute on function public.admin_remove_listing(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security and least-privilege table grants
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.verifications enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.verifications from public, anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (
  full_name,
  student_id_number,
  course,
  year_level,
  avatar_path
) on table public.profiles to authenticated;

grant select on table public.verifications to authenticated;
grant insert (
  id,
  user_id,
  full_name_snapshot,
  student_id_number_snapshot,
  course_snapshot,
  year_level_snapshot,
  document_path
) on table public.verifications to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
on public.profiles
for select
to authenticated
using ((select private.is_active_admin()));

drop policy if exists "Users can update their editable profile fields"
  on public.profiles;
create policy "Users can update their editable profile fields"
on public.profiles
for update
to authenticated
using (
  (select auth.uid()) = id
  and account_status = 'active'
)
with check (
  (select auth.uid()) = id
  and account_status = 'active'
);

drop policy if exists "Users can read their verification history"
  on public.verifications;
create policy "Users can read their verification history"
on public.verifications
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Admins can read all verification requests"
  on public.verifications;
create policy "Admins can read all verification requests"
on public.verifications
for select
to authenticated
using ((select private.is_active_admin()));

drop policy if exists "Students can submit their own verification"
  on public.verifications;
create policy "Students can submit their own verification"
on public.verifications
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and status = 'pending'
  and rejection_reason is null
  and reviewed_by is null
  and reviewed_at is null
  and exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'student'
      and profile.account_status = 'active'
      and profile.verification_status in ('unverified', 'rejected')
      and profile.full_name = verifications.full_name_snapshot
      and profile.student_id_number = verifications.student_id_number_snapshot
      and profile.course = verifications.course_snapshot
      and profile.year_level = verifications.year_level_snapshot
  )
  and exists (
    select 1
    from storage.objects as verification_object
    where verification_object.bucket_id = 'student-verifications'
      and verification_object.name = verifications.document_path
      and verification_object.owner_id = (select auth.uid()::text)
  )
);

-- No student UPDATE or DELETE grant/policy is created for verification rows.
-- Reviews must use review_verification(), preserving their audit history.

-- This is intentionally an owner-context, security-barrier projection. It
-- bypasses the base table's own-row RLS only to expose this fixed safe column
-- list for verified, active student sellers. Never add private identity or
-- account-status columns to this view.
create or replace view public.marketplace_profiles
with (security_barrier = true)
as
select
  id,
  full_name,
  course,
  year_level,
  avatar_path,
  verification_status
from public.profiles
where role = 'student'
  and verification_status = 'verified'
  and account_status = 'active';

revoke all on table public.marketplace_profiles
  from public, anon, authenticated;
grant select on table public.marketplace_profiles to authenticated;

comment on view public.marketplace_profiles is
  'Safe authenticated seller projection; intentionally excludes private profile and account fields.';

-- ---------------------------------------------------------------------------
-- Categories and timestamps
-- ---------------------------------------------------------------------------

alter table public.categories
  add column if not exists is_active boolean not null default true;

alter table public.categories
  add column if not exists updated_at timestamptz not null default now();

-- Preserve the original Clothing category UUID so existing listing foreign
-- keys continue to reference the renamed MVP category.
update public.categories
set
  name = 'Clothing & Uniforms',
  slug = 'clothing-uniforms'
where slug = 'clothing'
  and not exists (
    select 1
    from public.categories
    where slug = 'clothing-uniforms'
  );

insert into public.categories (name, slug, is_active)
values
  ('Books', 'books', true),
  ('School Supplies', 'school-supplies', true),
  ('Electronics', 'electronics', true),
  ('Clothing & Uniforms', 'clothing-uniforms', true),
  ('Bags & Accessories', 'bags-accessories', true),
  ('Dorm & Boarding House Items', 'dorm-boarding-house', true),
  ('Appliances', 'appliances', true),
  ('Furniture', 'furniture', true),
  ('Sports & PE Items', 'sports-pe', true),
  ('Other', 'other', true)
on conflict (slug) do update
set
  name = excluded.name,
  is_active = excluded.is_active;

-- If a database already contained both the legacy and replacement clothing
-- slugs, retain the legacy row for foreign-key history but hide the duplicate.
update public.categories
set is_active = false
where slug = 'clothing'
  and exists (
    select 1
    from public.categories
    where slug = 'clothing-uniforms'
  );

drop trigger if exists categories_90_set_updated_at on public.categories;
create trigger categories_90_set_updated_at
before update on public.categories
for each row execute function private.set_updated_at();

drop policy if exists "Categories are publicly readable"
  on public.categories;
drop policy if exists "Active categories are publicly readable"
  on public.categories;
create policy "Active categories are publicly readable"
on public.categories
for select
to anon, authenticated
using (is_active);

drop policy if exists "Admins can read inactive categories"
  on public.categories;
create policy "Admins can read inactive categories"
on public.categories
for select
to authenticated
using ((select private.is_active_admin()));

-- ---------------------------------------------------------------------------
-- Storage buckets and policies
-- ---------------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'avatars',
    'avatars',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'student-verifications',
    'student-verifications',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  )
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatar images are publicly readable"
  on storage.objects;
drop policy if exists "Users can read their own avatar object"
  on storage.objects;
create policy "Users can read their own avatar object"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Users can upload their own avatar"
  on storage.objects;
create policy "Users can upload their own avatar"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and array_length(storage.foldername(name), 1) = 1
  and lower(storage.filename(name)) in (
    'avatar.jpg',
    'avatar.jpeg',
    'avatar.png',
    'avatar.webp'
  )
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  and owner_id = (select auth.uid()::text)
);

drop policy if exists "Users can update their own avatar"
  on storage.objects;
create policy "Users can update their own avatar"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'avatars'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and array_length(storage.foldername(name), 1) = 1
  and lower(storage.filename(name)) in (
    'avatar.jpg',
    'avatar.jpeg',
    'avatar.png',
    'avatar.webp'
  )
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
);

drop policy if exists "Users can delete their own avatar"
  on storage.objects;
create policy "Users can delete their own avatar"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Students can upload their verification document"
  on storage.objects;
create policy "Students can upload their verification document"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'student-verifications'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[2]
    ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and lower(storage.filename(name)) in (
    'student-id.jpg',
    'student-id.jpeg',
    'student-id.png',
    'student-id.webp'
  )
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  and owner_id = (select auth.uid()::text)
  and exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'student'
      and verification_status in ('unverified', 'rejected')
      and account_status = 'active'
  )
);

drop policy if exists "Students can read their verification documents"
  on storage.objects;
create policy "Students can read their verification documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'student-verifications'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Admins can read verification documents"
  on storage.objects;
create policy "Admins can read verification documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'student-verifications'
  and (select private.is_active_admin())
);

drop policy if exists "Students can delete unsubmitted verification documents"
  on storage.objects;
create policy "Students can delete unsubmitted verification documents"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'student-verifications'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and not exists (
    select 1
    from public.verifications
    where verifications.user_id = (select auth.uid())
      and verifications.document_path = storage.objects.name
  )
);

-- Submitted verification objects are immutable. The delete policy above is
-- only for cleaning up an upload when the database submission never completed.

-- ---------------------------------------------------------------------------
-- Require a verified, active student for all listing mutations
-- ---------------------------------------------------------------------------

revoke select on table public.listings from anon;
revoke select on table public.listing_images from anon;

drop policy if exists "Marketplace listings are publicly readable"
  on public.listings;
drop policy if exists "Active users can read marketplace listings"
  on public.listings;
create policy "Active users can read marketplace listings"
on public.listings
for select
to authenticated
using (
  status in ('available', 'reserved')
  and (select private.is_active_account())
  and private.is_marketplace_seller(seller_id)
);

drop policy if exists "Admins can read all listings" on public.listings;
create policy "Admins can read all listings"
on public.listings
for select
to authenticated
using ((select private.is_active_admin()));

drop policy if exists "Sellers can create listings" on public.listings;
drop policy if exists "Verified students can create their listings"
  on public.listings;
create policy "Verified students can create their listings"
on public.listings
for insert
to authenticated
with check (
  seller_id = (select auth.uid())
  and status = 'available'
  and (select private.is_verified_active_student())
  and exists (
    select 1
    from public.categories
    where categories.id = listings.category_id
      and categories.is_active
  )
);

drop policy if exists "Sellers can update their listings" on public.listings;
drop policy if exists "Verified students can update their listings"
  on public.listings;
create policy "Verified students can update their listings"
on public.listings
for update
to authenticated
using (
  seller_id = (select auth.uid())
  and (select private.is_verified_active_student())
)
with check (
  seller_id = (select auth.uid())
  and (select private.is_verified_active_student())
  and exists (
    select 1
    from public.categories
    where categories.id = listings.category_id
      and categories.is_active
  )
);

drop policy if exists "Sellers can delete their listings" on public.listings;
drop policy if exists "Verified students can delete their listings"
  on public.listings;
create policy "Verified students can delete their listings"
on public.listings
for delete
to authenticated
using (
  seller_id = (select auth.uid())
  and (select private.is_verified_active_student())
);

drop policy if exists "Listing images are publicly readable"
  on public.listing_images;
drop policy if exists "Active users can read marketplace listing images"
  on public.listing_images;
create policy "Active users can read marketplace listing images"
on public.listing_images
for select
to authenticated
using (
  (select private.is_active_account())
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.status in ('available', 'reserved')
  )
);

drop policy if exists "Sellers can read their listing images"
  on public.listing_images;
create policy "Sellers can read their listing images"
on public.listing_images
for select
to authenticated
using (
  exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
);

drop policy if exists "Admins can read all listing images"
  on public.listing_images;
create policy "Admins can read all listing images"
on public.listing_images
for select
to authenticated
using ((select private.is_active_admin()));

drop policy if exists "Sellers can add listing images"
  on public.listing_images;
drop policy if exists "Verified students can add their listing images"
  on public.listing_images;
create policy "Verified students can add their listing images"
on public.listing_images
for insert
to authenticated
with check (
  (select private.is_verified_active_student())
  and (storage.foldername(listing_images.storage_path))[1]
    = (select auth.uid()::text)
  and (storage.foldername(listing_images.storage_path))[2]
    = listing_images.listing_id::text
  and array_length(storage.foldername(listing_images.storage_path), 1) = 2
  and lower(storage.extension(listing_images.storage_path))
    in ('jpg', 'jpeg', 'png', 'webp')
  and exists (
    select 1
    from storage.objects as listing_object
    where listing_object.bucket_id = 'listing-images'
      and listing_object.name = listing_images.storage_path
      and listing_object.owner_id = (select auth.uid()::text)
  )
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
);

drop policy if exists "Sellers can update listing images"
  on public.listing_images;
drop policy if exists "Verified students can update their listing images"
  on public.listing_images;
create policy "Verified students can update their listing images"
on public.listing_images
for update
to authenticated
using (
  (select private.is_verified_active_student())
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
)
with check (
  (select private.is_verified_active_student())
  and (storage.foldername(listing_images.storage_path))[1]
    = (select auth.uid()::text)
  and (storage.foldername(listing_images.storage_path))[2]
    = listing_images.listing_id::text
  and array_length(storage.foldername(listing_images.storage_path), 1) = 2
  and lower(storage.extension(listing_images.storage_path))
    in ('jpg', 'jpeg', 'png', 'webp')
  and exists (
    select 1
    from storage.objects as listing_object
    where listing_object.bucket_id = 'listing-images'
      and listing_object.name = listing_images.storage_path
      and listing_object.owner_id = (select auth.uid()::text)
  )
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
);

drop policy if exists "Sellers can delete listing images"
  on public.listing_images;
drop policy if exists "Verified students can delete their listing images"
  on public.listing_images;
create policy "Verified students can delete their listing images"
on public.listing_images
for delete
to authenticated
using (
  (select private.is_verified_active_student())
  and exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
);

-- Tighten the existing listing-images bucket as well as its metadata table.
drop policy if exists "Users can upload listing images" on storage.objects;
drop policy if exists "Verified students can upload listing images"
  on storage.objects;
create policy "Verified students can upload listing images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'listing-images'
  and owner_id = (select auth.uid()::text)
  and (select private.is_verified_active_student())
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and array_length(storage.foldername(name), 1) = 2
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  and exists (
    select 1
    from public.listings
    where listings.id::text = (storage.foldername(name))[2]
      and listings.seller_id = (select auth.uid())
  )
);

drop policy if exists "Verified students can read their listing image objects"
  on storage.objects;
create policy "Verified students can read their listing image objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'listing-images'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and array_length(storage.foldername(name), 1) = 2
  and exists (
    select 1
    from public.listings
    where listings.id::text = (storage.foldername(name))[2]
      and listings.seller_id = (select auth.uid())
  )
);

drop policy if exists "Users can manage their listing images"
  on storage.objects;
drop policy if exists "Verified students can update listing image objects"
  on storage.objects;
create policy "Verified students can update listing image objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'listing-images'
  and owner_id = (select auth.uid()::text)
  and (select private.is_verified_active_student())
)
with check (
  bucket_id = 'listing-images'
  and owner_id = (select auth.uid()::text)
  and (select private.is_verified_active_student())
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and array_length(storage.foldername(name), 1) = 2
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  and exists (
    select 1
    from public.listings
    where listings.id::text = (storage.foldername(name))[2]
      and listings.seller_id = (select auth.uid())
  )
);

drop policy if exists "Users can delete their listing images"
  on storage.objects;
drop policy if exists "Verified students can delete listing image objects"
  on storage.objects;
create policy "Verified students can delete listing image objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'listing-images'
  and owner_id = (select auth.uid()::text)
  and (select private.is_verified_active_student())
  and exists (
    select 1
    from public.listings
    where listings.id::text = (storage.foldername(name))[2]
      and listings.seller_id = (select auth.uid())
  )
);

commit;
