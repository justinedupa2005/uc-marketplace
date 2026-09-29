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
import type {
  ListingReservationOverview,
  MarketplaceProduct,
} from "@/features/listings/types";
import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

const FAVORITE_HISTORY_STATUSES = ["available", "reserved", "sold"] as const;

export type ListingCardsResult =
  | { products: SellerListingProduct[]; error: null }
  | { products: []; error: "unavailable" };

export type SellerListingProduct = MarketplaceProduct & {
  reservationOverview: ListingReservationOverview;
};

type ActiveSellerReservationRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  status: "pending" | "accepted";
  created_at: string;
};

type ReservationBuyerRow = {
  id: string;
  full_name: string | null;
  verification_status: string | null;
};

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
  const [listingResult, reservationResult] = await Promise.all([
    supabase
      .from("listings")
      .select(listingCardSelection)
      .eq("seller_id", user.id)
      .neq("status", "draft")
      .order("created_at", { ascending: false }),
    supabase
      .from("reservations")
      .select("id, listing_id, buyer_id, status, created_at")
      .eq("seller_id", user.id)
      .in("status", ["pending", "accepted"])
      .order("created_at", { ascending: false }),
  ]);

  if (listingResult.error || reservationResult.error) {
    console.warn("Unable to load seller listings", {
      listingCode: listingResult.error?.code,
      reservationCode: reservationResult.error?.code,
    });
    return { products: [], error: "unavailable" };
  }

  const reservationRows = (reservationResult.data ?? []) as ActiveSellerReservationRow[];
  const acceptedBuyerIds = [
    ...new Set(
      reservationRows.flatMap((reservation) =>
        reservation.status === "accepted" ? [reservation.buyer_id] : [],
      ),
    ),
  ];
  const buyerResult = acceptedBuyerIds.length > 0
    ? await supabase
        .from("marketplace_profiles")
        .select("id, full_name, verification_status")
        .in("id", acceptedBuyerIds)
    : { data: [], error: null };

  if (buyerResult.error) {
    console.warn("Unable to load accepted reservation buyers", {
      code: buyerResult.error.code,
    });
    return { products: [], error: "unavailable" };
  }

  const buyerNames = new Map(
    ((buyerResult.data ?? []) as ReservationBuyerRow[]).map((buyer) => [
      buyer.id,
      buyer.full_name?.trim() || "UC Student",
    ]),
  );
  const verifiedBuyerIds = new Set(
    ((buyerResult.data ?? []) as ReservationBuyerRow[]).flatMap((buyer) =>
      buyer.verification_status === "verified" ? [buyer.id] : [],
    ),
  );
  const reservationsByListing = new Map<string, ActiveSellerReservationRow[]>();
  for (const reservation of reservationRows) {
    const listingReservations = reservationsByListing.get(reservation.listing_id);
    if (listingReservations) {
      listingReservations.push(reservation);
    } else {
      reservationsByListing.set(reservation.listing_id, [reservation]);
    }
  }
  const products = await mapListingCards(
    supabase,
    (listingResult.data ?? []) as unknown as ListingCardRow[],
    new Set<string>(),
    user.id,
  );

  return {
    products: products.map((product) => {
      const listingReservations = reservationsByListing.get(product.id) ?? [];
      const acceptedReservation = listingReservations.find(
        (reservation) => reservation.status === "accepted",
      );

      return {
        ...product,
        reservationOverview: {
          pendingCount: listingReservations.filter(
            (reservation) => reservation.status === "pending",
          ).length,
          acceptedReservation: acceptedReservation
            ? {
                id: acceptedReservation.id,
                buyerName:
                  buyerNames.get(acceptedReservation.buyer_id) ?? "UC Student",
                buyerIsVerified: verifiedBuyerIds.has(
                  acceptedReservation.buyer_id,
                ),
              }
            : null,
        },
      };
    }),
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
    .in("listings.status", FAVORITE_HISTORY_STATUSES)
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
    .in("status", FAVORITE_HISTORY_STATUSES)
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
