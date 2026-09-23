-- Run before 20260921000000_strengthen_marketplace_authorization.sql.
-- This query is read-only. Nonzero image-integrity counts mean legacy objects
-- will become inaccessible after the bucket is made private until their paths
-- or ownership metadata are corrected deliberately.

select
  id,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'listing-images';

select
  count(*) filter (
    where cardinality(storage.foldername(image.storage_path)) <> 2
      or (storage.foldername(image.storage_path))[1] <> listing.seller_id::text
      or (storage.foldername(image.storage_path))[2] <> listing.id::text
      or not coalesce(
        lower(storage.extension(image.storage_path))
          in ('jpg', 'jpeg', 'png', 'webp'),
        false
      )
  ) as invalid_listing_image_paths,
  count(*) filter (where object.id is null) as missing_storage_objects,
  count(*) filter (
    where object.id is not null
      and object.owner_id is distinct from listing.seller_id::text
  ) as mismatched_storage_object_owners
from public.listing_images as image
join public.listings as listing
  on listing.id = image.listing_id
left join storage.objects as object
  on object.bucket_id = 'listing-images'
 and object.name = image.storage_path;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
from pg_policies
where (
    schemaname = 'public'
    and tablename in (
      'profiles',
      'verifications',
      'categories',
      'listings',
      'listing_images'
    )
  )
   or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;
