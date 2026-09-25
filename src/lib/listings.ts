import "server-only";

import type { MarketplaceProduct } from "@/components/product-card";
import {
  requireVerifiedActiveStudent,
  type AuthorizedAccessContext,
} from "@/lib/auth/authorization";

type ListingImageRow = {
  storage_path: string;
  is_cover: boolean;
  sort_order: number;
};

type ListingCardRow = {
  id: string;
  title: string;
  price: number | string;
  condition: string;
  status: string;
  created_at: string;
  listing_images: ListingImageRow[] | null;
};

type ListingCategoryRow = {
  name: string;
};

type ListingDetailsRow = ListingCardRow & {
  seller_id: string;
  description: string;
  category: ListingCategoryRow | ListingCategoryRow[] | null;
};

type ListingImageSigningResult = {
  urls: Map<string, string>;
  hasError: boolean;
};

const conditionLabels: Record<string, string> = {
  new: "New",
  like_new: "Like New",
  good: "Good",
  fair: "Fair",
};

const statusLabels: Record<string, MarketplaceProduct["status"]> = {
  available: "Available",
  reserved: "Reserved",
  sold: "Sold",
  removed: "Removed",
  draft: "Draft",
};

const priceFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

const LISTING_IMAGE_URL_LIFETIME_SECONDS = 5 * 60;

export type ListingCardsResult =
  | {
      products: MarketplaceProduct[];
      error: null;
    }
  | {
      products: [];
      error: "unavailable";
    };

export type ListingDetailsImage = {
  src: string;
  alt: string;
  isCover: boolean;
  sortOrder: number;
};

export type ListingDetails = {
  id: string;
  title: string;
  description: string;
  price: string;
  condition: string;
  status: MarketplaceProduct["status"];
  categoryName: string;
  createdAt: string;
  isOwner: boolean;
  images: ListingDetailsImage[];
};

export type ListingDetailsResult =
  | {
      listing: ListingDetails;
      error: null;
    }
  | {
      listing: null;
      error: "not_found" | "unavailable";
    };

function sortListingImages(images: ListingImageRow[] | null) {
  return [...(images ?? [])].sort(
    (first, second) => first.sort_order - second.sort_order,
  );
}

function getCoverImage(images: ListingImageRow[] | null) {
  const orderedImages = sortListingImages(images);

  return (
    orderedImages.find((image) => image.is_cover) ?? orderedImages[0] ?? null
  );
}

function getCategoryName(
  category: ListingCategoryRow | ListingCategoryRow[] | null,
) {
  if (Array.isArray(category)) {
    return category[0]?.name ?? "Uncategorized";
  }

  return category?.name ?? "Uncategorized";
}

export function formatListingPrice(value: number | string) {
  return priceFormatter.format(Number(value));
}

export function formatListingCondition(value: string) {
  return conditionLabels[value] ?? value;
}

export function formatListingStatus(
  value: string,
): MarketplaceProduct["status"] {
  return statusLabels[value] ?? "Draft";
}

export async function signListingImagePaths(
  supabase: AuthorizedAccessContext["supabase"],
  paths: string[],
): Promise<ListingImageSigningResult> {
  const storagePaths = [...new Set(paths.filter(Boolean))];
  const urls = new Map<string, string>();

  if (storagePaths.length === 0) {
    return { urls, hasError: false };
  }

  const { data, error } = await supabase.storage
    .from("listing-images")
    .createSignedUrls(storagePaths, LISTING_IMAGE_URL_LIFETIME_SECONDS);

  if (error) {
    console.warn("Unable to create private listing image URLs");
    return { urls, hasError: true };
  }

  data.forEach((signedImage) => {
    if (signedImage.path && signedImage.signedUrl && !signedImage.error) {
      urls.set(signedImage.path, signedImage.signedUrl);
    }
  });

  return {
    urls,
    hasError: storagePaths.some((path) => !urls.has(path)),
  };
}

function toMarketplaceProduct(
  listing: ListingCardRow,
  signedImageUrls: Map<string, string>,
): MarketplaceProduct {
  const coverPath = getCoverImage(listing.listing_images)?.storage_path;

  return {
    id: listing.id,
    title: listing.title,
    price: formatListingPrice(listing.price),
    condition: formatListingCondition(listing.condition),
    status: formatListingStatus(listing.status),
    image: coverPath ? (signedImageUrls.get(coverPath) ?? null) : null,
    imageAlt: listing.title,
  };
}

async function mapListingCards(
  supabase: AuthorizedAccessContext["supabase"],
  listings: ListingCardRow[],
) {
  const coverPaths = listings
    .map((listing) => getCoverImage(listing.listing_images)?.storage_path)
    .filter((path): path is string => Boolean(path));
  const { urls } = await signListingImagePaths(supabase, coverPaths);

  return listings.map((listing) => toMarketplaceProduct(listing, urls));
}

export async function getMarketplaceListings(): Promise<ListingCardsResult> {
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

  const products = await mapListingCards(
    supabase,
    (data ?? []) as ListingCardRow[],
  );

  return { products, error: null };
}

export async function getSellerListings(): Promise<ListingCardsResult> {
  const { supabase, user } =
    await requireVerifiedActiveStudent("/my-listings");
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
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Unable to load seller listings", { code: error.code });
    return { products: [], error: "unavailable" };
  }

  const products = await mapListingCards(
    supabase,
    (data ?? []) as ListingCardRow[],
  );

  return { products, error: null };
}

export async function getListingDetails(
  listingId: string,
): Promise<ListingDetailsResult> {
  const { supabase, user } = await requireVerifiedActiveStudent(
    `/listings/${listingId}`,
  );
  const { data, error } = await supabase
    .from("listings")
    .select(
      `
        id,
        seller_id,
        title,
        description,
        price,
        condition,
        status,
        created_at,
        category:categories (name),
        listing_images (
          storage_path,
          is_cover,
          sort_order
        )
      `,
    )
    .eq("id", listingId)
    .maybeSingle();

  if (error) {
    console.warn("Unable to load listing details", { code: error.code });
    return { listing: null, error: "unavailable" };
  }

  if (!data) {
    return { listing: null, error: "not_found" };
  }

  const listing = data as ListingDetailsRow;
  const orderedImages = sortListingImages(listing.listing_images);
  const { urls, hasError } = await signListingImagePaths(
    supabase,
    orderedImages.map((image) => image.storage_path),
  );

  if (hasError) {
    return { listing: null, error: "unavailable" };
  }

  return {
    listing: {
      id: listing.id,
      title: listing.title,
      description: listing.description,
      price: formatListingPrice(listing.price),
      condition: formatListingCondition(listing.condition),
      status: formatListingStatus(listing.status),
      categoryName: getCategoryName(listing.category),
      createdAt: listing.created_at,
      isOwner: listing.seller_id === user.id,
      images: orderedImages.flatMap((image, index) => {
        const src = urls.get(image.storage_path);

        return src
          ? [
              {
                src,
                alt: `${listing.title} photo ${index + 1}`,
                isCover: image.is_cover,
                sortOrder: image.sort_order,
              },
            ]
          : [];
      }),
    },
    error: null,
  };
}
