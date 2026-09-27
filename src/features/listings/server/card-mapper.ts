import "server-only";

import { formatListingPrice } from "@/features/listings/formatters";
import {
  formatListingCondition,
  getListingStatusLabel,
  isListingStatus,
  type ListingStatus,
} from "@/features/listings/rules";
import { signListingImagePaths } from "@/features/listings/server/media";
import type { MarketplaceProduct } from "@/features/listings/types";
import type { AppSupabaseClient } from "@/lib/supabase/types";

export type ListingImageRow = {
  id?: string;
  storage_path: string;
  is_cover: boolean;
  sort_order: number;
};

export type ListingCategoryRow = {
  id?: string;
  name: string;
  slug?: string;
};

export type ListingCardRow = {
  id: string;
  seller_id: string;
  title: string;
  price: number | string;
  condition: string;
  status: string;
  created_at: string;
  category: ListingCategoryRow | ListingCategoryRow[] | null;
  listing_images: ListingImageRow[] | null;
};

export function sortListingImages(images: ListingImageRow[] | null) {
  return [...(images ?? [])].sort(
    (first, second) => first.sort_order - second.sort_order,
  );
}

function getCoverImage(images: ListingImageRow[] | null) {
  const orderedImages = sortListingImages(images);
  return orderedImages.find((image) => image.is_cover) ?? orderedImages[0] ?? null;
}

export function getCategoryName(
  category: ListingCategoryRow | ListingCategoryRow[] | null,
) {
  return Array.isArray(category)
    ? (category[0]?.name ?? "Uncategorized")
    : (category?.name ?? "Uncategorized");
}

export function toListingStatus(value: string): ListingStatus {
  return isListingStatus(value) ? value : "draft";
}

export async function getFavoriteListingIds(
  supabase: AppSupabaseClient,
  userId: string,
  listingIds: string[],
) {
  if (listingIds.length === 0) {
    return { ids: new Set<string>(), hasError: false };
  }

  const { data, error } = await supabase
    .from("favorites")
    .select("listing_id")
    .eq("user_id", userId)
    .in("listing_id", listingIds);

  return {
    ids: new Set(
      error
        ? []
        : (data ?? []).flatMap((favorite) =>
            typeof favorite.listing_id === "string"
              ? [favorite.listing_id]
              : [],
          ),
    ),
    hasError: Boolean(error),
  };
}

function toMarketplaceProduct(
  listing: ListingCardRow,
  signedImageUrls: Map<string, string>,
  favoriteIds: Set<string>,
  currentUserId?: string,
): MarketplaceProduct {
  const coverPath = getCoverImage(listing.listing_images)?.storage_path;
  const statusValue = toListingStatus(listing.status);

  return {
    id: listing.id,
    title: listing.title,
    price: formatListingPrice(listing.price),
    condition: formatListingCondition(listing.condition),
    status: getListingStatusLabel(statusValue),
    statusValue,
    categoryName: getCategoryName(listing.category),
    createdAt: listing.created_at,
    image: coverPath ? (signedImageUrls.get(coverPath) ?? null) : null,
    imageAlt: listing.title,
    isFavorited: favoriteIds.has(listing.id),
    isOwner: listing.seller_id === currentUserId,
  };
}

export async function mapListingCards(
  supabase: AppSupabaseClient,
  listings: ListingCardRow[],
  favoriteIds = new Set<string>(),
  currentUserId?: string,
) {
  const coverPaths = listings
    .map((listing) => getCoverImage(listing.listing_images)?.storage_path)
    .filter((path): path is string => Boolean(path));
  const { urls } = await signListingImagePaths(supabase, coverPaths);

  return listings.map((listing) =>
    toMarketplaceProduct(listing, urls, favoriteIds, currentUserId),
  );
}

export const listingCardSelection = `
  id,
  seller_id,
  title,
  price,
  condition,
  status,
  created_at,
  category:categories (id, name),
  listing_images (storage_path, is_cover, sort_order)
`;
