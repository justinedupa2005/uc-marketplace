begin;

-- Step 4: keep the document private and limit uploads to the size advertised
-- by the verification form. Storage checks MIME metadata; application code
-- must also validate the actual selected file before uploading it.
do $$
begin
  update storage.buckets
  set
    public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp'
    ]::text[]
  where id = 'student-verifications';

  if not found then
    raise exception 'Apply the identity and verification foundation first.';
  end if;
end;
$$;

-- Old submissions remain immutable. New rejections require a useful reason,
-- including when a trusted database operator writes outside the review RPC.
alter table public.verifications
  drop constraint if exists verifications_review_state_check;

alter table public.verifications
  add constraint verifications_review_state_check check (
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
      and char_length(btrim(rejection_reason)) between 5 and 500
      and reviewed_by is not null
      and reviewed_at is not null
      and reviewed_at >= submitted_at
    )
  );

-- RLS predicates are ORed with any other permissive policy. These restrictive
-- policies prevent an unrelated or later Storage policy from exposing this
-- bucket, allowing replacement, or deleting a submitted document.
drop policy if exists "Anonymous users cannot access verification objects"
  on storage.objects;
create policy "Anonymous users cannot access verification objects"
on storage.objects
as restrictive
for all
to anon
using (bucket_id <> 'student-verifications')
with check (bucket_id <> 'student-verifications');

drop policy if exists "Verification objects stay private"
  on storage.objects;
create policy "Verification objects stay private"
on storage.objects
as restrictive
for select
to authenticated
using (
  bucket_id <> 'student-verifications'
  or (
    auth.uid() is not null
    and (
      (
        owner_id = (select auth.uid()::text)
        and (storage.foldername(name))[1] = (select auth.uid()::text)
      )
      or (select private.is_active_admin())
    )
  )
);

drop policy if exists "Verification uploads stay owner scoped"
  on storage.objects;
create policy "Verification uploads stay owner scoped"
on storage.objects
as restrictive
for insert
to authenticated
with check (
  bucket_id <> 'student-verifications'
  or (
    auth.uid() is not null
    and owner_id = (select auth.uid()::text)
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[2]
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and lower(storage.filename(name)) in (
      'student-id.jpg', 'student-id.jpeg',
      'student-id.png', 'student-id.webp'
    )
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = (select auth.uid())
        and profile.role = 'student'
        and profile.account_status = 'active'
        and profile.verification_status in ('unverified', 'rejected')
    )
  )
);

drop policy if exists "Verification objects cannot be replaced"
  on storage.objects;
create policy "Verification objects cannot be replaced"
on storage.objects
as restrictive
for update
to authenticated
using (bucket_id <> 'student-verifications')
with check (bucket_id <> 'student-verifications');

drop policy if exists "Submitted verification objects cannot be deleted"
  on storage.objects;
create policy "Submitted verification objects cannot be deleted"
on storage.objects
as restrictive
for delete
to authenticated
using (
  bucket_id <> 'student-verifications'
  or (
    auth.uid() is not null
    and owner_id = (select auth.uid()::text)
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and not exists (
      select 1
      from public.verifications as verification
      where verification.user_id = (select auth.uid())
        and verification.document_path = storage.objects.name
    )
  )
);

-- Students no longer INSERT snapshot/status rows directly. The client may
-- create a random verification UUID for the upload path, but the authenticated
-- user and all review fields are assigned or verified inside this RPC.
revoke insert on table public.verifications from authenticated;
revoke insert (
  id,
  user_id,
  full_name_snapshot,
  student_id_number_snapshot,
  course_snapshot,
  year_level_snapshot,
  document_path
) on public.verifications from authenticated;

drop policy if exists "Students can submit their own verification"
  on public.verifications;

create or replace function public.submit_verification(
  p_verification_id uuid,
  p_document_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  profile_row public.profiles%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  if p_verification_id is null
    or p_document_path is null
    or p_document_path !~ (
      '^' || caller_id::text || '/' || p_verification_id::text
      || '/student-id\.(jpg|jpeg|png|webp)$'
    )
  then
    raise exception 'Invalid verification document path.'
      using errcode = '22023';
  end if;

  -- The row lock serializes a concurrent identity edit or second submission.
  -- It is held until the INSERT trigger has marked the profile pending.
  select *
  into profile_row
  from public.profiles
  where id = caller_id
  for update;

  if not found then
    raise exception 'Student profile was not found.'
      using errcode = 'P0002';
  end if;

  if profile_row.role <> 'student'
    or profile_row.account_status <> 'active'
  then
    raise exception 'This account cannot submit verification.'
      using errcode = '42501';
  end if;

  if profile_row.verification_status = 'pending' then
    raise exception 'A verification request is already pending.'
      using errcode = 'P0001';
  end if;

  if profile_row.verification_status not in ('unverified', 'rejected') then
    raise exception 'This account cannot submit verification.'
      using errcode = '42501';
  end if;

  if profile_row.full_name is null
    or profile_row.student_id_number is null
    or profile_row.course is null
    or profile_row.year_level is null
  then
    raise exception 'Complete student information before submitting.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from storage.objects as document
    where document.bucket_id = 'student-verifications'
      and document.name = p_document_path
      and document.owner_id = caller_id::text
  ) then
    raise exception 'School ID upload was not found.'
      using errcode = 'P0002';
  end if;

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
  values (
    p_verification_id,
    caller_id,
    profile_row.full_name,
    profile_row.student_id_number,
    profile_row.course,
    profile_row.year_level,
    p_document_path,
    'pending'
  );

  -- The existing AFTER INSERT trigger changes the profile to pending in this
  -- transaction; any trigger error rolls back the verification row as well.
  return p_verification_id;
end;
$$;

revoke all on function public.submit_verification(uuid, text)
  from public, anon;
grant execute on function public.submit_verification(uuid, text)
  to authenticated;

comment on function public.submit_verification(uuid, text) is
  'Creates a pending verification from the caller profile and owned private upload; snapshots and profile transition are atomic.';

-- This replaces the Step 2 implementation without changing its API. Review
-- remains a single database transaction and refuses stale/double decisions.
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

  if normalized_decision = 'rejected'
    and (
      normalized_reason is null
      or char_length(normalized_reason) not between 5 and 500
    )
  then
    raise exception 'A rejection reason of 5 to 500 characters is required.'
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
    raise exception 'This verification has already been reviewed.'
      using errcode = 'P0001';
  end if;

  if normalized_decision = 'approved' then
    if not exists (
      select 1
      from storage.objects as document
      where document.bucket_id = 'student-verifications'
        and document.name = verification_row.document_path
        and document.owner_id = verification_row.user_id::text
    ) then
      raise exception 'School ID document is no longer available.'
        using errcode = 'P0002';
    end if;

    update public.profiles
    set
      full_name = verification_row.full_name_snapshot,
      student_id_number = verification_row.student_id_number_snapshot,
      course = verification_row.course_snapshot,
      year_level = verification_row.year_level_snapshot,
      verification_status = 'verified'
    where id = verification_row.user_id
      and role = 'student'
      and account_status = 'active'
      and verification_status = 'pending';

    if not found then
      raise exception 'The student account is not eligible for approval.'
        using errcode = '42501';
    end if;
  else
    update public.profiles
    set verification_status = 'rejected'
    where id = verification_row.user_id
      and role = 'student'
      and verification_status = 'pending';

    if not found then
      raise exception 'The student profile is not pending verification.'
        using errcode = 'P0001';
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

-- A reviewed name is part of the verified identity too. Step 2 froze the
-- academic fields but still allowed the owner to change full_name afterward.
-- Permit corrections only through a trusted administrator once verified.
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
    if old.verification_status in ('pending', 'verified')
      and (
        new.full_name is distinct from old.full_name
        or new.student_id_number is distinct from old.student_id_number
        or new.course is distinct from old.course
        or new.year_level is distinct from old.year_level
      )
    then
      raise exception 'Reviewed identity fields require administrator correction.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.protect_verified_identity() from public;

commit;
