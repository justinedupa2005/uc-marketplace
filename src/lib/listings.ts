import "server-only";

import type { MarketplaceProduct } from "@/components/product-card";
import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

type ListingImageRow = {
  storage_path: string;
  is_cover: boolean;
  sort_order: number;
};

type ListingRow = {
  id: string | number;
  title: string;
  price: number | string;
  condition: string;
  status: string;
  created_at: string;
  listing_images: ListingImageRow[] | null;
};

const conditionLabels: Record<string, string> = {
  new: "New",
  like_new: "Like New",
  good: "Good",
  fair: "Fair",
};

const priceFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

const LISTING_IMAGE_URL_LIFETIME_SECONDS = 5 * 60;

export type MarketplaceListingsResult =
  | {
      products: MarketplaceProduct[];
      error: null;
    }
  | {
      products: [];
      error: "unavailable";
    };

function getCoverImage(images: ListingImageRow[] | null) {
  if (!images?.length) {
    return null;
  }

  return [...images].sort((first, second) => {
    if (first.is_cover !== second.is_cover) {
      return first.is_cover ? -1 : 1;
    }

    return first.sort_order - second.sort_order;
  })[0];
}

export async function getMarketplaceListings(): Promise<MarketplaceListingsResult> {
  const { supabase } = await requireVerifiedActiveStudent("/marketplace");
  const { data, error } = await supabase
    .from("listings")
    .select(
      `
        id,
        title,
        price,
        condition,
        status,
        created_at,
        listing_images (
          storage_path,
          is_cover,
          sort_order
        )
      `,
    )
    .in("status", ["available", "reserved"])
    .order("created_at", { ascending: false });

  if (error) {
    if (error.code !== "PGRST205") {
      console.warn("Unable to load marketplace listings", { code: error.code });
    }

    return { products: [], error: "unavailable" };
  }

  const listings = (data ?? []) as ListingRow[];
  const coverPaths = [
    ...new Set(
      listings
        .map((listing) => getCoverImage(listing.listing_images)?.storage_path)
        .filter(
          (path): path is string =>
            Boolean(path) && !/^https?:\/\//i.test(path ?? ""),
        ),
    ),
  ];
  const signedImageUrls = new Map<string, string>();

  if (coverPaths.length > 0) {
    const { data: signedImages, error: signedImageError } = await supabase.storage
      .from("listing-images")
      .createSignedUrls(coverPaths, LISTING_IMAGE_URL_LIFETIME_SECONDS);

    if (signedImageError) {
      console.warn("Unable to create private listing image URLs");
    } else {
      signedImages.forEach((signedImage) => {
        if (signedImage.path && signedImage.signedUrl && !signedImage.error) {
          signedImageUrls.set(signedImage.path, signedImage.signedUrl);
        }
      });
    }
  }

  const products: MarketplaceProduct[] = listings.map((listing) => {
    const coverPath = getCoverImage(listing.listing_images)?.storage_path;
    const image = coverPath ? (signedImageUrls.get(coverPath) ?? null) : null;

    return {
      id: listing.id,
      title: listing.title,
      price: priceFormatter.format(Number(listing.price)),
      condition: conditionLabels[listing.condition] ?? listing.condition,
      status: listing.status === "available" ? "Available" : "Pending",
      image,
      imageAlt: listing.title,
    };
  });

  return { products, error: null };
}
