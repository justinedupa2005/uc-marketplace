-- Step 13: private student reports, reviewed report outcomes and auditable
-- moderation. Keep every state change inside the database transaction that
-- records the actor; old unaudited admin RPCs are no longer client-callable.

begin;

create table public.student_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (reason in (
    'scam', 'harassment', 'abusive_behavior', 'impersonation',
    'unsafe_meetup', 'spam', 'other'
  )),
  details text check (details is null or char_length(details) between 1 and 1000),
  status text not null default 'pending' check (
    status in ('pending', 'reviewing', 'resolved', 'dismissed')
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  admin_note text check (
    admin_note is null or char_length(admin_note) between 10 and 500
  ),
  constraint student_reports_no_self_report check (reporter_id <> subject_id),
  constraint student_reports_other_details check (
    reason <> 'other' or char_length(coalesce(btrim(details), '')) >= 10
  ),
  constraint student_reports_review_metadata check (
    (status in ('pending', 'reviewing') and reviewed_by is null
      and reviewed_at is null and admin_note is null)
    or (status in ('resolved', 'dismissed') and reviewed_by is not null
      and reviewed_at is not null and admin_note is not null)
  )
);

create index student_reports_status_created_idx
  on public.student_reports (status, created_at desc, id desc);
create index student_reports_reporter_created_idx
  on public.student_reports (reporter_id, created_at desc, id desc);
create index student_reports_subject_created_idx
  on public.student_reports (subject_id, created_at desc, id desc);
create unique index student_reports_one_active_report_idx
  on public.student_reports (reporter_id, subject_id)
  where status in ('pending', 'reviewing');

create trigger student_reports_90_set_updated_at
before update on public.student_reports
for each row execute function private.set_updated_at();

alter table public.listing_reports
  add column reviewed_by uuid references public.profiles(id) on delete restrict,
  add column reviewed_at timestamptz,
  add column admin_note text check (
    admin_note is null or char_length(admin_note) between 10 and 500
  );

-- Reporters may read their own report but never a private reviewer note. RLS
-- controls rows; column grants enforce the separate confidentiality boundary.
alter table public.student_reports enable row level security;
revoke all on table public.student_reports from public, anon, authenticated;
revoke select on table public.listing_reports from authenticated;
grant select (
  id, reporter_id, subject_id, reason, details, status, created_at,
  updated_at, reviewed_by, reviewed_at
) on table public.student_reports to authenticated;
grant select (
  id, listing_id, reporter_id, seller_id, reason, details, status,
  created_at, updated_at, reviewed_by, reviewed_at
) on table public.listing_reports to authenticated;

create policy "Reporters see their own student reports and admins see all"
on public.student_reports
for select to authenticated
using (
  reporter_id = (select auth.uid())
  or (select private.is_active_admin())
);

create or replace function public.report_student(
  p_subject_id uuid,
  p_reason text,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reporter_id uuid := (select auth.uid());
  v_subject public.profiles%rowtype;
  v_reason text := lower(btrim(coalesce(p_reason, '')));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_report_id uuid;
begin
  if v_reporter_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  if v_reason not in (
    'scam', 'harassment', 'abusive_behavior', 'impersonation',
    'unsafe_meetup', 'spam', 'other'
  ) or char_length(coalesce(v_details, '')) > 1000
    or (v_reason = 'other' and char_length(coalesce(v_details, '')) < 10)
  then
    raise exception 'Select a valid report reason and explanation.'
      using errcode = '22023';
  end if;

  select profile.* into v_subject
  from public.profiles as profile
  where profile.id = p_subject_id
  for share;

  if not found or v_subject.role <> 'student'
    or p_subject_id = v_reporter_id
    or not (
      -- Publicly listed sellers can be reported from their listing page.
      (v_subject.account_status = 'active'
        and v_subject.verification_status = 'verified'
        and exists (
          select 1 from public.listings as listing
          where listing.seller_id = p_subject_id
            and listing.status in ('available', 'reserved')
        ))
      -- Saved sold listings retain a legitimate seller context.
      or exists (
        select 1
        from public.favorites as favorite
        join public.listings as listing on listing.id = favorite.listing_id
        where favorite.user_id = v_reporter_id
          and listing.seller_id = p_subject_id
      )
      -- Existing conversations and reservations support historical reports.
      or exists (
        select 1 from public.conversations as conversation
        where (conversation.buyer_id = v_reporter_id
          and conversation.seller_id = p_subject_id)
          or (conversation.seller_id = v_reporter_id
            and conversation.buyer_id = p_subject_id)
      )
      or exists (
        select 1 from public.reservations as reservation
        where (reservation.buyer_id = v_reporter_id
          and reservation.seller_id = p_subject_id)
          or (reservation.seller_id = v_reporter_id
            and reservation.buyer_id = p_subject_id)
      )
    )
  then
    raise exception 'This student cannot be reported.' using errcode = 'P0002';
  end if;

  insert into public.student_reports (
    reporter_id, subject_id, reason, details
  ) values (
    v_reporter_id, p_subject_id, v_reason, v_details
  )
  on conflict (reporter_id, subject_id)
    where status in ('pending', 'reviewing')
  do nothing
  returning id into v_report_id;

  if v_report_id is null then
    select report.id into v_report_id
    from public.student_reports as report
    where report.reporter_id = v_reporter_id
      and report.subject_id = p_subject_id
      and report.status in ('pending', 'reviewing');
  end if;

  return v_report_id;
end;
$$;

create or replace function public.admin_review_report(
  p_kind text,
  p_report_id uuid,
  p_decision text,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_note text := nullif(btrim(coalesce(p_admin_note, '')), '');
  v_status text;
begin
  if v_actor_id is null or not (select private.is_active_admin()) then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if v_kind not in ('listing', 'student')
    or v_decision not in ('resolved', 'dismissed')
    or char_length(coalesce(v_note, '')) not between 10 and 500
  then
    raise exception 'A valid report decision and note are required.'
      using errcode = '22023';
  end if;

  if v_kind = 'listing' then
    select report.status into v_status
    from public.listing_reports as report
    where report.id = p_report_id
    for update;
    if not found then
      raise exception 'Report was not found.' using errcode = 'P0002';
    end if;
    if v_status not in ('pending', 'reviewing') then
      raise exception 'Report has already been reviewed.' using errcode = 'P0001';
    end if;
    update public.listing_reports
    set status = v_decision, reviewed_by = v_actor_id,
      reviewed_at = clock_timestamp(), admin_note = v_note
    where id = p_report_id;
  else
    select report.status into v_status
    from public.student_reports as report
    where report.id = p_report_id
    for update;
    if not found then
      raise exception 'Report was not found.' using errcode = 'P0002';
    end if;
    if v_status not in ('pending', 'reviewing') then
      raise exception 'Report has already been reviewed.' using errcode = 'P0001';
    end if;
    update public.student_reports
    set status = v_decision, reviewed_by = v_actor_id,
      reviewed_at = clock_timestamp(), admin_note = v_note
    where id = p_report_id;
  end if;
end;
$$;

create or replace function public.get_admin_report_note(
  p_kind text,
  p_report_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_note text;
begin
  if (select auth.uid()) is null or not (select private.is_active_admin()) then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if v_kind not in ('listing', 'student') then
    raise exception 'Invalid report type.' using errcode = '22023';
  end if;
  if v_kind = 'listing' then
    select report.admin_note into v_note
    from public.listing_reports as report where report.id = p_report_id;
  else
    select report.admin_note into v_note
    from public.student_reports as report where report.id = p_report_id;
  end if;
  if not found then
    raise exception 'Report was not found.' using errcode = 'P0002';
  end if;
  return v_note;
end;
$$;

-- This table intentionally has no Data API read grant or RLS policy. Trusted
-- database operators can inspect its append-only API history during an audit.
create table private.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid references auth.users(id) on delete restrict,
  listing_id uuid references public.listings(id) on delete restrict,
  action text not null check (
    action in ('user_suspended', 'user_disabled', 'user_reactivated',
      'listing_removed')
  ),
  reason text not null check (char_length(reason) between 10 and 500),
  created_at timestamptz not null default clock_timestamp(),
  constraint moderation_actions_target_check check (
    (action = 'listing_removed' and listing_id is not null
      and target_user_id is null)
    or (action <> 'listing_removed' and listing_id is null
      and target_user_id is not null)
  )
);
create index moderation_actions_actor_created_idx
  on private.moderation_actions (actor_id, created_at desc);
create index moderation_actions_target_user_created_idx
  on private.moderation_actions (target_user_id, created_at desc)
  where target_user_id is not null;
create index moderation_actions_listing_created_idx
  on private.moderation_actions (listing_id, created_at desc)
  where listing_id is not null;
alter table private.moderation_actions enable row level security;
revoke all on table private.moderation_actions
  from public, anon, authenticated;

create or replace function public.admin_moderate_user(
  p_user_id uuid,
  p_account_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_status text := lower(btrim(coalesce(p_account_status, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_target public.profiles%rowtype;
begin
  if v_actor_id is null or not (select private.is_active_admin()) then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if v_status not in ('active', 'suspended', 'disabled')
    or char_length(coalesce(v_reason, '')) not between 10 and 500
  then
    raise exception 'A valid status and reason are required.'
      using errcode = '22023';
  end if;

  select profile.* into v_target
  from public.profiles as profile
  where profile.id = p_user_id
  for update;
  if not found or v_target.role <> 'student' or p_user_id = v_actor_id then
    raise exception 'Student was not found.' using errcode = 'P0002';
  end if;
  if v_target.account_status = v_status then
    raise exception 'Account status has already changed.' using errcode = 'P0001';
  end if;

  perform public.admin_set_account_status(p_user_id, v_status);
  insert into private.moderation_actions (
    actor_id, target_user_id, action, reason
  ) values (
    v_actor_id, p_user_id,
    case v_status when 'active' then 'user_reactivated'
      when 'suspended' then 'user_suspended' else 'user_disabled' end,
    v_reason
  );
end;
$$;

create or replace function public.admin_moderate_listing(
  p_listing_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_listing public.listings%rowtype;
begin
  if v_actor_id is null or not (select private.is_active_admin()) then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if char_length(coalesce(v_reason, '')) not between 10 and 500 then
    raise exception 'A moderation reason is required.' using errcode = '22023';
  end if;

  select listing.* into v_listing
  from public.listings as listing
  where listing.id = p_listing_id
  for update;
  if not found then
    raise exception 'Listing was not found.' using errcode = 'P0002';
  end if;
  if v_listing.status = 'removed' then
    raise exception 'Listing has already been removed.' using errcode = 'P0001';
  end if;

  perform public.admin_remove_listing(p_listing_id);
  insert into private.moderation_actions (
    actor_id, listing_id, action, reason
  ) values (v_actor_id, p_listing_id, 'listing_removed', v_reason);
end;
$$;

revoke all on function public.report_student(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_review_report(text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.get_admin_report_note(text, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_moderate_user(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_moderate_listing(uuid, text)
  from public, anon, authenticated;
grant execute on function public.report_student(uuid, text, text)
  to authenticated;
grant execute on function public.admin_review_report(text, uuid, text, text)
  to authenticated;
grant execute on function public.get_admin_report_note(text, uuid)
  to authenticated;
grant execute on function public.admin_moderate_user(uuid, text, text)
  to authenticated;
grant execute on function public.admin_moderate_listing(uuid, text)
  to authenticated;

revoke execute on function public.admin_set_account_status(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.admin_remove_listing(uuid)
  from public, anon, authenticated;

commit;
