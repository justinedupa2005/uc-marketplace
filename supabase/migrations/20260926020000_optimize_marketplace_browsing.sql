begin;

-- A single generated value lets the Data API bind user input through
-- .ilike('search_text', pattern) instead of interpolating it into PostgREST's
-- raw .or() grammar. Title and description remain the source of truth.
alter table public.listings
  add column if not exists search_text text
  generated always as (title || ' ' || description) stored;

-- Keep the normal marketplace indexes smaller than the full listing history.
-- Owners and administrators can still read additional statuses through RLS,
-- but those rows are intentionally outside the public browsing query shape.
create index if not exists listings_marketplace_newest_idx
  on public.listings (created_at desc, id desc)
  where status in ('available', 'reserved');

create index if not exists listings_marketplace_category_newest_idx
  on public.listings (category_id, created_at desc, id desc)
  where status in ('available', 'reserved');

create index if not exists listings_marketplace_condition_newest_idx
  on public.listings (condition, created_at desc, id desc)
  where status in ('available', 'reserved');

create index if not exists listings_marketplace_price_asc_idx
  on public.listings (price asc, created_at desc, id desc)
  where status in ('available', 'reserved');

commit;
