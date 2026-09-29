-- Read-only checks before applying the Step 11 migration. All issue counts
-- must be zero. Review inconsistent legacy records instead of deleting them.
select 'accepted_reservations_without_reserved_listing' as check_name,
  count(*) as issue_count
from public.reservations as reservation
join public.listings as listing on listing.id = reservation.listing_id
where reservation.status = 'accepted' and listing.status <> 'reserved'
union all
select 'reserved_listings_without_accepted_reservation', count(*)
from public.listings as listing
where listing.status = 'reserved' and not exists (
  select 1 from public.reservations as reservation
  where reservation.listing_id = listing.id and reservation.status = 'accepted'
)
union all
select 'pending_reservations_without_available_listing', count(*)
from public.reservations as reservation
join public.listings as listing on listing.id = reservation.listing_id
where reservation.status = 'pending' and listing.status <> 'available'
union all
select 'completed_reservations_without_sold_history', count(*)
from public.reservations as reservation
join public.listings as listing on listing.id = reservation.listing_id
where reservation.status = 'completed' and listing.status not in ('sold', 'removed')
union all
select 'duplicate_accepted_reservations', count(*) from (
  select listing_id from public.reservations
  where status = 'accepted' group by listing_id having count(*) > 1
) as duplicates
union all
select 'duplicate_active_buyer_requests', count(*) from (
  select buyer_id, listing_id from public.reservations
  where status in ('pending', 'accepted')
  group by buyer_id, listing_id having count(*) > 1
) as duplicates
union all
select 'reservation_timestamps_before_creation', count(*)
from public.reservations where updated_at < created_at
order by check_name;
