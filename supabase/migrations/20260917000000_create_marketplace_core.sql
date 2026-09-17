begin;

create extension if not exists pgcrypto;

-- Product categories
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- Marketplace listings
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id),
  title text not null,
  description text not null,
  price numeric(12, 2) not null check (price >= 0),
  condition text not null check (
    condition in ('new', 'like_new', 'good', 'fair')
  ),
  status text not null default 'available' check (
    status in ('available', 'reserved', 'sold', 'removed')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Images connected to listings. sort_order 0-4 limits each listing to five
-- positions, while the unique constraint prevents duplicate positions.
create table if not exists public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null
    references public.listings(id) on delete cascade,
  storage_path text not null unique,
  is_cover boolean not null default false,
  sort_order smallint not null default 0
    check (sort_order between 0 and 4),
  created_at timestamptz not null default now(),
  unique (listing_id, sort_order)
);

create unique index if not exists one_cover_per_listing
  on public.listing_images (listing_id)
  where is_cover = true;

create index if not exists listings_status_created_at_idx
  on public.listings (status, created_at desc);

-- Initial categories
insert into public.categories (name, slug)
values
  ('Books', 'books'),
  ('Electronics', 'electronics'),
  ('Clothing', 'clothing'),
  ('School Supplies', 'school-supplies'),
  ('Other', 'other')
on conflict (slug) do update
set name = excluded.name;

-- Enable Row Level Security
alter table public.categories enable row level security;
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;

-- Explicit Data API permissions
grant select on public.categories to anon, authenticated;
grant select on public.listings to anon, authenticated;
grant select on public.listing_images to anon, authenticated;

grant insert, update, delete on public.listings to authenticated;
grant insert, update, delete on public.listing_images to authenticated;

-- Categories
drop policy if exists "Categories are publicly readable"
  on public.categories;

create policy "Categories are publicly readable"
on public.categories
for select
to anon, authenticated
using (true);

-- Listings
drop policy if exists "Marketplace listings are publicly readable"
  on public.listings;

create policy "Marketplace listings are publicly readable"
on public.listings
for select
to anon, authenticated
using (status in ('available', 'reserved'));

drop policy if exists "Sellers can read their listings"
  on public.listings;

create policy "Sellers can read their listings"
on public.listings
for select
to authenticated
using ((select auth.uid()) = seller_id);

drop policy if exists "Sellers can create listings"
  on public.listings;

create policy "Sellers can create listings"
on public.listings
for insert
to authenticated
with check ((select auth.uid()) = seller_id);

drop policy if exists "Sellers can update their listings"
  on public.listings;

create policy "Sellers can update their listings"
on public.listings
for update
to authenticated
using ((select auth.uid()) = seller_id)
with check ((select auth.uid()) = seller_id);

drop policy if exists "Sellers can delete their listings"
  on public.listings;

create policy "Sellers can delete their listings"
on public.listings
for delete
to authenticated
using ((select auth.uid()) = seller_id);

-- Listing images
drop policy if exists "Listing images are publicly readable"
  on public.listing_images;

create policy "Listing images are publicly readable"
on public.listing_images
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.status in ('available', 'reserved')
  )
);

drop policy if exists "Sellers can add listing images"
  on public.listing_images;

create policy "Sellers can add listing images"
on public.listing_images
for insert
to authenticated
with check (
  exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
);

drop policy if exists "Sellers can update listing images"
  on public.listing_images;

create policy "Sellers can update listing images"
on public.listing_images
for update
to authenticated
using (
  exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
);

drop policy if exists "Sellers can delete listing images"
  on public.listing_images;

create policy "Sellers can delete listing images"
on public.listing_images
for delete
to authenticated
using (
  exists (
    select 1
    from public.listings
    where listings.id = listing_images.listing_id
      and listings.seller_id = (select auth.uid())
  )
);

-- Public listing images bucket with a 5 MB image-only upload limit.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'listing-images',
  'listing-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Store files as USER_ID/LISTING_ID/file-name.webp.
drop policy if exists "Users can upload listing images"
  on storage.objects;

create policy "Users can upload listing images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Users can manage their listing images"
  on storage.objects;

create policy "Users can manage their listing images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'listing-images'
  and owner_id = (select auth.uid()::text)
)
with check (
  bucket_id = 'listing-images'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Users can delete their listing images"
  on storage.objects;

create policy "Users can delete their listing images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'listing-images'
  and owner_id = (select auth.uid()::text)
);

commit;
