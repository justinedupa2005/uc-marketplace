begin;

-- Replace the original history index with one that also gives deterministic
-- ordering when multiple messages share a transaction timestamp. PostgreSQL
-- can scan this index in either direction for oldest-first history or the
-- newest message.
create index if not exists messages_conversation_latest_idx
  on public.messages (conversation_id, created_at desc, id desc);

drop index if exists public.messages_conversation_created_idx;

-- Both unread counts and mark-read updates start with a conversation and only
-- visit rows that have not yet been read.
create index if not exists messages_conversation_unread_idx
  on public.messages (conversation_id, sender_id)
  where read_at is null;

-- The original btrim(body) check removes ordinary spaces but not every newline
-- or tab. Keep the existing constraint for compatibility and add the complete
-- invariant for all future writes and existing data.
alter table public.messages
  add constraint messages_body_content_check check (
    char_length(body) between 1 and 2000
    and body ~ '[^[:space:]]'
  ) not valid;

-- NOT VALID keeps a legacy newline/tab-only row from making this forward
-- migration unavailable. The constraint still applies to every new write. A
-- clean database is validated immediately; the post-migration security check
-- deliberately fails until any legacy invalid rows are reviewed and the
-- constraint is validated.
do $$
begin
  if not exists (
    select 1
    from public.messages as message
    where char_length(message.body) not between 1 and 2000
      or message.body !~ '[^[:space:]]'
  ) then
    execute 'alter table public.messages validate constraint messages_body_content_check';
  end if;
end;
$$;

-- Reassert the existing send contract with all common leading/trailing
-- whitespace removed before length validation and storage.
create or replace function public.send_conversation_message(
  p_conversation_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_message_id uuid;
  v_body text := regexp_replace(
    coalesce(p_body, ''),
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  if char_length(v_body) not between 1 and 2000 then
    raise exception 'Messages must contain between 1 and 2000 characters.'
      using errcode = '22023';
  end if;

  perform 1
  from public.conversations as conversation
  join public.listings as listing on listing.id = conversation.listing_id
  where conversation.id = p_conversation_id
    and (
      conversation.buyer_id = v_user_id
      or conversation.seller_id = v_user_id
    )
    and listing.status <> 'removed'
    and (select private.is_marketplace_seller(conversation.buyer_id))
    and (select private.is_marketplace_seller(conversation.seller_id))
  for share of listing;

  if not found then
    raise exception 'This conversation is not available.'
      using errcode = 'P0002';
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, v_user_id, v_body)
  returning id into v_message_id;

  return v_message_id;
end;
$$;

revoke all on function public.send_conversation_message(uuid, text)
  from public, anon, authenticated;
grant execute on function public.send_conversation_message(uuid, text)
  to authenticated;

-- Read state is the only message mutation exposed after creation. The caller
-- cannot choose a sender, recipient, or timestamp, and no table UPDATE grant is
-- needed by authenticated clients.
create or replace function public.mark_conversation_read(
  p_conversation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_updated integer;
begin
  if v_user_id is null
    or not (select private.is_verified_active_student())
  then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  perform 1
  from public.conversations as conversation
  where conversation.id = p_conversation_id
    and (
      conversation.buyer_id = v_user_id
      or conversation.seller_id = v_user_id
    )
  for share;

  if not found then
    raise exception 'Conversation was not found.' using errcode = 'P0002';
  end if;

  update public.messages as message
  set read_at = now()
  where message.conversation_id = p_conversation_id
    and message.sender_id <> v_user_id
    and message.read_at is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.mark_conversation_read(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_conversation_read(uuid)
  to authenticated;

comment on function public.mark_conversation_read(uuid) is
  'Marks only unread messages received by the verified active conversation participant and returns the affected row count.';

-- One participant-scoped query supplies the conversation list and individual
-- conversation header without loading full message histories. This fixed safe
-- projection deliberately omits private identity, account-status, moderation,
-- and verification-document fields.
create or replace function public.get_my_conversation_summaries(
  p_conversation_id uuid default null
)
returns table (
  conversation_id uuid,
  listing_id uuid,
  other_user_id uuid,
  other_user_name text,
  other_user_avatar_path text,
  other_user_is_verified boolean,
  listing_title text,
  listing_status text,
  listing_price numeric(12, 2),
  listing_image_path text,
  last_message_body text,
  last_message_at timestamptz,
  unread_count bigint,
  created_at timestamptz,
  updated_at timestamptz,
  can_send boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with caller as (
    select (select auth.uid()) as user_id
  ), participant_conversations as (
    select
      conversation.*,
      case
        when conversation.buyer_id = caller.user_id
          then conversation.seller_id
        else conversation.buyer_id
      end as other_id,
      caller.user_id
    from public.conversations as conversation
    cross join caller
    where caller.user_id is not null
      and (select private.is_verified_active_student())
      and (
        conversation.buyer_id = caller.user_id
        or conversation.seller_id = caller.user_id
      )
      and (
        p_conversation_id is null
        or conversation.id = p_conversation_id
      )
  )
  select
    conversation.id as conversation_id,
    conversation.listing_id,
    conversation.other_id as other_user_id,
    case
      when other_profile.id is null then 'Former UC Student'
      else coalesce(nullif(btrim(other_profile.full_name), ''), 'UC Student')
    end as other_user_name,
    other_profile.avatar_path as other_user_avatar_path,
    coalesce(other_profile.verification_status = 'verified', false)
      as other_user_is_verified,
    listing.title as listing_title,
    listing.status as listing_status,
    listing.price as listing_price,
    case
      -- Private listing-image delivery currently permits all verified students
      -- only for available/reserved listings. Owners retain access to their own
      -- sold/removed image. Do not expose an unusable path to other participants.
      when listing.seller_id = conversation.user_id
        or listing.status in ('available', 'reserved')
      then cover_image.storage_path
      else null
    end as listing_image_path,
    latest_message.body as last_message_body,
    latest_message.created_at as last_message_at,
    coalesce(unread.unread_count, 0::bigint) as unread_count,
    conversation.created_at,
    conversation.updated_at,
    listing.status in ('available', 'reserved', 'sold')
      and other_profile.id is not null as can_send
  from participant_conversations as conversation
  join public.listings as listing
    on listing.id = conversation.listing_id
  left join public.profiles as other_profile
    on other_profile.id = conversation.other_id
    and other_profile.role = 'student'
    and other_profile.verification_status = 'verified'
    and other_profile.account_status = 'active'
  left join lateral (
    select message.body, message.created_at
    from public.messages as message
    where message.conversation_id = conversation.id
    order by message.created_at desc, message.id desc
    limit 1
  ) as latest_message on true
  left join lateral (
    select count(*)::bigint as unread_count
    from public.messages as message
    where message.conversation_id = conversation.id
      and message.sender_id <> conversation.user_id
      and message.read_at is null
  ) as unread on true
  left join lateral (
    select listing_image.storage_path
    from public.listing_images as listing_image
    where listing_image.listing_id = conversation.listing_id
    order by
      listing_image.is_cover desc,
      listing_image.sort_order,
      listing_image.created_at,
      listing_image.id
    limit 1
  ) as cover_image on true
  order by conversation.updated_at desc, conversation.id;
$$;

revoke all on function public.get_my_conversation_summaries(uuid)
  from public, anon, authenticated;
grant execute on function public.get_my_conversation_summaries(uuid)
  to authenticated;

comment on function public.get_my_conversation_summaries(uuid) is
  'Returns a participant-scoped, UI-safe conversation projection with latest-message and unread aggregates; pass NULL for all conversations.';

commit;
