begin;

-- The primary key already covers ownership and duplicate prevention. This
-- companion index covers the Favorites page's newest-saved-first query.
create index if not exists favorites_user_created_at_idx
  on public.favorites (user_id, created_at desc, listing_id desc);

-- Set an explicit desired state rather than toggling an assumed client state.
-- This makes retries and concurrent duplicate requests idempotent.
create or replace function public.set_listing_favorite(
  p_listing_id uuid,
  p_should_favorite boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing public.listings%rowtype;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  if p_should_favorite is null then
    raise exception 'Favorite state is required.' using errcode = '22004';
  end if;

  if not p_should_favorite then
    delete from public.favorites
    where user_id = v_user_id
      and listing_id = p_listing_id;

    return false;
  end if;

  -- Listing lifecycle RPCs take an update lock before deleting favorites.
  -- Taking this lock first keeps the lock order consistent and prevents a
  -- listing from becoming sold or removed between validation and insertion.
  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = p_listing_id
  for share;

  if not found
    or v_listing.seller_id = v_user_id
    or v_listing.status not in ('available', 'reserved')
    or not (select private.is_marketplace_seller(v_listing.seller_id))
  then
    raise exception 'This listing cannot be favorited.'
      using errcode = 'P0002';
  end if;

  insert into public.favorites (user_id, listing_id)
  values (v_user_id, p_listing_id)
  on conflict (user_id, listing_id) do nothing;

  return true;
end;
$$;

-- Keep the legacy endpoint safe for already-deployed clients. The listing is
-- locked before any favorite row is changed so its order matches sold/removed
-- lifecycle operations and cannot form a listing/favorite lock cycle.
create or replace function public.toggle_listing_favorite(p_listing_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_listing public.listings%rowtype;
begin
  if v_user_id is null or not (select private.is_verified_active_student()) then
    raise exception 'A verified and active student account is required.'
      using errcode = '42501';
  end if;

  select listing.*
  into v_listing
  from public.listings as listing
  where listing.id = p_listing_id
  for share;

  delete from public.favorites
  where user_id = v_user_id
    and listing_id = p_listing_id;

  if found then
    return false;
  end if;

  if v_listing.id is null
    or v_listing.seller_id = v_user_id
    or v_listing.status not in ('available', 'reserved')
    or not (select private.is_marketplace_seller(v_listing.seller_id))
  then
    raise exception 'This listing cannot be favorited.'
      using errcode = 'P0002';
  end if;

  insert into public.favorites (user_id, listing_id)
  values (v_user_id, p_listing_id)
  on conflict (user_id, listing_id) do nothing;

  return true;
end;
$$;

revoke all on function public.set_listing_favorite(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.toggle_listing_favorite(uuid)
  from public, anon, authenticated;

grant execute on function public.set_listing_favorite(uuid, boolean)
  to authenticated;
grant execute on function public.toggle_listing_favorite(uuid)
  to authenticated;

comment on function public.set_listing_favorite(uuid, boolean) is
  'Idempotently sets the authenticated verified student favorite state.';
comment on function public.toggle_listing_favorite(uuid) is
  'Legacy favorite toggle retained for deployed-client compatibility.';

commit;
