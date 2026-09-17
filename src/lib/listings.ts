import type { MarketplaceProduct } from "@/components/product-card";
import { createClient } from "@/lib/supabase/server";

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

export async function getMarketplaceListings(): Promise<MarketplaceProduct[]> {
  const supabase = await createClient();
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
      console.warn("Unable to load marketplace listings:", error.message);
    }

    return [];
  }

  return ((data ?? []) as ListingRow[]).map((listing) => {
    const coverImage = getCoverImage(listing.listing_images);
    const image = coverImage
      ? /^https?:\/\//i.test(coverImage.storage_path)
        ? coverImage.storage_path
        : supabase.storage.from("listing-images").getPublicUrl(coverImage.storage_path).data
            .publicUrl
      : null;

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
}
