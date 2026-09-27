import "server-only";

import {
  MARKETPLACE_MAX_PAGE,
  MARKETPLACE_PAGE_SIZE,
} from "@/features/listings/search-params";
import {
  getFavoriteListingIds,
  listingCardSelection,
  mapListingCards,
  type ListingCardRow,
} from "@/features/listings/server/card-mapper";
import type {
  MarketplaceBrowseOptions,
  MarketplaceCategory,
  MarketplaceProduct,
} from "@/features/listings/types";
import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

export type MarketplaceListingsResult =
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

export async function getMarketplaceCategories(): Promise<{
  categories: MarketplaceCategory[];
  error: boolean;
}> {
  const { supabase } = await requireVerifiedActiveStudent("/marketplace");
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, slug")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.warn("Unable to load marketplace categories", { code: error.code });
    return { categories: [], error: true };
  }

  return {
    categories: (data ?? []).flatMap((category) =>
      typeof category.id === "string" &&
      typeof category.name === "string" &&
      typeof category.slug === "string"
        ? [{ id: category.id, name: category.name, slug: category.slug }]
        : [],
    ),
    error: false,
  };
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function getMarketplaceListings(
  options: MarketplaceBrowseOptions = {},
): Promise<MarketplaceListingsResult> {
  const { supabase, user } = await requireVerifiedActiveStudent("/marketplace");
  const search = options.search?.trim().slice(0, 80);
  const requestedPage = Number.isSafeInteger(options.page) ? options.page! : 1;
  const page = Math.min(
    MARKETPLACE_MAX_PAGE,
    Math.max(1, requestedPage),
  );
  const offset = (page - 1) * MARKETPLACE_PAGE_SIZE;
  let query = supabase
    .from("listings")
    .select(listingCardSelection, { count: "exact" })
    .in("status", ["available", "reserved"]);

  if (search) {
    query = query.ilike("search_text", `%${escapeLikePattern(search)}%`);
  }
  if (options.categoryId) query = query.eq("category_id", options.categoryId);
  if (options.condition) query = query.eq("condition", options.condition);
  if (options.minPrice !== undefined) {
    query = query.gte("price", options.minPrice);
  }
  if (options.maxPrice !== undefined) {
    query = query.lte("price", options.maxPrice);
  }

  if (options.sort === "price-asc") {
    query = query
      .order("price", { ascending: true })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
  } else if (options.sort === "price-desc") {
    query = query
      .order("price", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
  } else {
    query = query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
  }

  const { data, error, count } = await query.range(
    offset,
    offset + MARKETPLACE_PAGE_SIZE - 1,
  );

  if (error) {
    console.warn("Unable to load marketplace listings", { code: error.code });
    return {
      products: [],
      totalCount: 0,
      page,
      pageSize: MARKETPLACE_PAGE_SIZE,
      error: "unavailable",
    };
  }

  const listings = (data ?? []) as unknown as ListingCardRow[];
  const favorites = await getFavoriteListingIds(
    supabase,
    user.id,
    listings.map((listing) => listing.id),
  );

  if (favorites.hasError) {
    console.warn("Unable to load marketplace favorites");
    return {
      products: [],
      totalCount: 0,
      page,
      pageSize: MARKETPLACE_PAGE_SIZE,
      error: "unavailable",
    };
  }

  return {
    products: await mapListingCards(supabase, listings, favorites.ids, user.id),
    totalCount: count ?? 0,
    page,
    pageSize: MARKETPLACE_PAGE_SIZE,
    error: null,
  };
}
