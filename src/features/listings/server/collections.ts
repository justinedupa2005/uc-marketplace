import "server-only";

import {
  FAVORITES_MAX_PAGE,
  FAVORITES_PAGE_SIZE,
  orderListingsByFavoriteIds,
} from "@/features/favorites/pagination";
import {
  listingCardSelection,
  mapListingCards,
  type ListingCardRow,
} from "@/features/listings/server/card-mapper";
import type { MarketplaceProduct } from "@/features/listings/types";
import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

export type ListingCardsResult =
  | { products: MarketplaceProduct[]; error: null }
  | { products: []; error: "unavailable" };

export type FavoriteListingsResult =
  | {
      products: MarketplaceProduct[];
      totalCount: number;
      page: number;
      pageSize: number;
      error: null;
    }
  | {
      products: [];
      totalCount: 0;
      page: number;
      pageSize: number;
      error: "unavailable";
    };

export async function getSellerListings(): Promise<ListingCardsResult> {
  const { supabase, user } = await requireVerifiedActiveStudent("/my-listings");
  const { data, error } = await supabase
    .from("listings")
    .select(listingCardSelection)
    .eq("seller_id", user.id)
    .neq("status", "draft")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Unable to load seller listings", { code: error.code });
    return { products: [], error: "unavailable" };
  }

  return {
    products: await mapListingCards(
      supabase,
      (data ?? []) as unknown as ListingCardRow[],
      new Set<string>(),
      user.id,
    ),
    error: null,
  };
}

export async function getFavoriteListings(
  requestedPage = 1,
): Promise<FavoriteListingsResult> {
  const { supabase, user } = await requireVerifiedActiveStudent("/favorites");
  const page =
    Number.isSafeInteger(requestedPage) &&
    requestedPage >= 1 &&
    requestedPage <= FAVORITES_MAX_PAGE
      ? requestedPage
      : 1;
  const offset = (page - 1) * FAVORITES_PAGE_SIZE;
  const {
    data: favorites,
    error: favoriteError,
    count,
  } = await supabase
    .from("favorites")
    // Keep hidden or unavailable listings out before count/range pagination.
    // The inner relation also applies the listings table's RLS policy.
    .select("listing_id, created_at, listings!inner()", { count: "exact" })
    .eq("user_id", user.id)
    .in("listings.status", ["available", "reserved"])
    .order("created_at", { ascending: false })
    .order("listing_id", { ascending: false })
    .range(offset, offset + FAVORITES_PAGE_SIZE - 1);

  if (favoriteError) {
    console.warn("Unable to load favorites", { code: favoriteError.code });
    return {
      products: [],
      totalCount: 0,
      page,
      pageSize: FAVORITES_PAGE_SIZE,
      error: "unavailable",
    };
  }

  const listingIds = (favorites ?? []).flatMap((favorite) =>
    typeof favorite.listing_id === "string" ? [favorite.listing_id] : [],
  );
  if (listingIds.length === 0) {
    return {
      products: [],
      totalCount: count ?? 0,
      page,
      pageSize: FAVORITES_PAGE_SIZE,
      error: null,
    };
  }

  const { data, error } = await supabase
    .from("listings")
    .select(listingCardSelection)
    .in("id", listingIds)
    .in("status", ["available", "reserved"])
    .order("is_cover", {
      referencedTable: "listing_images",
      ascending: false,
    })
    .order("sort_order", {
      referencedTable: "listing_images",
      ascending: true,
    })
    .limit(1, { referencedTable: "listing_images" });

  if (error) {
    console.warn("Unable to load favorite listings", { code: error.code });
    return {
      products: [],
      totalCount: 0,
      page,
      pageSize: FAVORITES_PAGE_SIZE,
      error: "unavailable",
    };
  }

  const orderedListings = orderListingsByFavoriteIds(
    listingIds,
    (data ?? []) as unknown as ListingCardRow[],
  );

  return {
    products: await mapListingCards(
      supabase,
      orderedListings,
      new Set(listingIds),
      user.id,
    ),
    totalCount: count ?? 0,
    page,
    pageSize: FAVORITES_PAGE_SIZE,
    error: null,
  };
}
