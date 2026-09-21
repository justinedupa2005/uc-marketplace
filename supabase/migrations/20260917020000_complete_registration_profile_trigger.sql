begin;

-- Registration metadata is untrusted input. Copy only the approved identity
-- fields, validate each value without unsafe casts, and continue assigning all
-- authorization-related defaults inside the database.

-- Keep this allowlist synchronized with src/lib/auth/options.ts. Centralizing
-- it in one SQL function prevents the profile constraint, backfill, and Auth
-- trigger from drifting apart.
create or replace function private.is_accepted_course(candidate text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select upper(btrim(candidate)) = any (array[
    'AB-EL', 'AB-LIT', 'BPA', 'AB-POLS', 'AB-PSYCH',
    'BSA', 'BSBA-FM', 'BSBA-HRM', 'BSBA-MM', 'BSBA-OM',
    'BSMA', 'BSOA', 'BSREM', 'BSCRIM', 'BSCA',
    'BEED', 'BPED', 'BSED-ENGLISH', 'BSED-FILIPINO',
    'BSED-MATH', 'BSED-SCIENCE', 'BSED-SOCSTUD', 'BSNED',
    'BSCE', 'BSCPE', 'BSECE', 'BSEE', 'BSIE', 'BSME',
    'BSHM', 'ACT', 'BSCS', 'BSCSAI', 'BSIT', 'BSN', 'BSSW',
    'OTHER'
  ]::text[]);
$$;

revoke all on function private.is_accepted_course(text) from public, anon;
grant execute on function private.is_accepted_course(text) to authenticated;

create or replace function private.normalize_profile_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.full_name := nullif(btrim(new.full_name), '');
  new.student_id_number := upper(nullif(btrim(new.student_id_number), ''));
  new.course := upper(nullif(btrim(new.course), ''));
  new.avatar_path := nullif(btrim(new.avatar_path), '');
  return new;
end;
$$;

revoke all on function private.normalize_profile_fields() from public;

-- The Step 2 trigger trimmed these values but did not uppercase them. Bring
-- existing valid rows into the canonical form before validating the new rules.
update public.profiles
set
  student_id_number = upper(btrim(student_id_number)),
  course = upper(btrim(course))
where student_id_number is distinct from upper(btrim(student_id_number))
  or course is distinct from upper(btrim(course));

alter table public.profiles
  drop constraint if exists profiles_student_id_format_check;
alter table public.profiles
  add constraint profiles_student_id_format_check check (
    student_id_number is null
    or (
      char_length(student_id_number) between 4 and 50
      and student_id_number ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
    )
  ) not valid;

alter table public.profiles
  drop constraint if exists profiles_course_value_check;
alter table public.profiles
  add constraint profiles_course_value_check check (
    course is null
    or private.is_accepted_course(course)
  ) not valid;

-- Align the database with the registration and verification UI. Adding these
-- as NOT VALID first gives PostgreSQL a clear validation step for existing
-- installations while still enforcing the rule for concurrent new writes.
alter table public.profiles
  drop constraint if exists profiles_year_level_check;
alter table public.profiles
  add constraint profiles_year_level_check check (
    year_level is null
    or year_level between 1 and 5
  ) not valid;

alter table public.verifications
  drop constraint if exists verifications_year_level_snapshot_check;
alter table public.verifications
  add constraint verifications_year_level_snapshot_check check (
    year_level_snapshot between 1 and 5
  ) not valid;

-- Existing Auth users can predate this version of the trigger. Backfill only
-- valid missing values; existing profile data is never overwritten.
update public.profiles as profile
set
  full_name = coalesce(
    profile.full_name,
    case
      when char_length(btrim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', '')))
        between 2 and 100
      then btrim(auth_user.raw_user_meta_data ->> 'full_name')
      else null
    end
  ),
  course = coalesce(
    profile.course,
    case
      when private.is_accepted_course(
        coalesce(auth_user.raw_user_meta_data ->> 'course', '')
      )
      then upper(btrim(auth_user.raw_user_meta_data ->> 'course'))
      else null
    end
  ),
  year_level = coalesce(
    profile.year_level,
    case
      when btrim(coalesce(auth_user.raw_user_meta_data ->> 'year_level', ''))
        ~ '^[1-5]$'
      then (btrim(auth_user.raw_user_meta_data ->> 'year_level'))::smallint
      else null
    end
  )
from auth.users as auth_user
where profile.id = auth_user.id
  and (
    profile.full_name is null
    or profile.course is null
    or profile.year_level is null
  );

-- Student IDs require an additional conflict check. Only a valid candidate
-- that is unique across both Auth metadata and existing profiles is copied.
with student_id_candidates as (
  select
    auth_user.id,
    upper(btrim(auth_user.raw_user_meta_data ->> 'student_id_number')) as value,
    count(*) over (
      partition by upper(btrim(auth_user.raw_user_meta_data ->> 'student_id_number'))
    ) as candidate_count
  from auth.users as auth_user
  join public.profiles as profile on profile.id = auth_user.id
  where profile.student_id_number is null
    and char_length(upper(btrim(coalesce(
      auth_user.raw_user_meta_data ->> 'student_id_number',
      ''
    )))) between 4 and 50
    and upper(btrim(auth_user.raw_user_meta_data ->> 'student_id_number'))
      ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
)
update public.profiles as profile
set student_id_number = candidate.value
from student_id_candidates as candidate
where profile.id = candidate.id
  and candidate.candidate_count = 1
  and not exists (
    select 1
    from public.profiles as existing_profile
    where existing_profile.id <> profile.id
      and lower(existing_profile.student_id_number) = lower(candidate.value)
  );

-- Fail the migration transaction instead of silently accepting incompatible
-- legacy rows. Resolve any reported rows explicitly, then run it again.
alter table public.profiles
  validate constraint profiles_student_id_format_check;
alter table public.profiles
  validate constraint profiles_course_value_check;
alter table public.profiles
  validate constraint profiles_year_level_check;
alter table public.verifications
  validate constraint verifications_year_level_snapshot_check;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  metadata_full_name text;
  metadata_student_id_number text;
  metadata_course text;
  metadata_year_level_text text;
  metadata_year_level smallint;
begin
  metadata_full_name := btrim(
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  metadata_student_id_number := upper(btrim(
    coalesce(new.raw_user_meta_data ->> 'student_id_number', '')
  ));
  metadata_course := upper(btrim(
    coalesce(new.raw_user_meta_data ->> 'course', '')
  ));
  metadata_year_level_text := btrim(
    coalesce(new.raw_user_meta_data ->> 'year_level', '')
  );

  if char_length(metadata_full_name) not between 2 and 100 then
    metadata_full_name := null;
  end if;

  if char_length(metadata_student_id_number) not between 4 and 50
    or metadata_student_id_number !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
  then
    metadata_student_id_number := null;
  end if;

  if not coalesce(private.is_accepted_course(metadata_course), false) then
    metadata_course := null;
  end if;

  if metadata_year_level_text ~ '^[1-5]$' then
    metadata_year_level := metadata_year_level_text::smallint;
  else
    metadata_year_level := null;
  end if;

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
  values (
    new.id,
    metadata_full_name,
    metadata_student_id_number,
    metadata_course,
    metadata_year_level,
    'student',
    'unverified',
    'active'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

comment on function private.handle_new_user() is
  'Creates one student profile from allowlisted signup metadata; protected defaults are database-owned.';

commit;
