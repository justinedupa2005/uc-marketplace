import "server-only";

import { formatListingPrice } from "@/features/listings/formatters";
import {
  formatListingCondition,
  getListingStatusLabel,
} from "@/features/listings/rules";
import {
  getCategoryName,
  sortListingImages,
  toListingStatus,
  type ListingCardRow,
  type ListingImageRow,
} from "@/features/listings/server/card-mapper";
import { signListingImagePaths } from "@/features/listings/server/media";
import type {
  ListingDetails,
  OwnedListingForEdit,
} from "@/features/listings/types";
import { getAvatarUrl } from "@/features/profiles/server/avatar-url";
import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

type ListingDetailsRow = ListingCardRow & {
  description: string;
  updated_at: string;
};

type SellerProfileRow = {
  id: string;
  full_name: string;
  course: string | null;
  year_level: number | null;
  avatar_path: string | null;
  verification_status: string;
};

type OwnedListingEditRow = {
  id: string;
  seller_id: string;
  category_id: string;
  title: string;
  description: string;
  price: number | string;
  condition: string;
  status: string;
  created_at: string;
  updated_at: string;
  listing_images: ListingImageRow[] | null;
};

type ActiveReservationRow = {
  id: string;
  buyer_id: string;
  status: "pending" | "accepted";
  created_at: string;
};

export type ListingDetailsResult =
  | { listing: ListingDetails; error: null }
  | { listing: null; error: "not_found" | "unavailable" };

export type OwnedListingForEditResult =
  | { listing: OwnedListingForEdit; error: null }
  | {
      listing: null;
      error: "not_found" | "not_editable" | "unavailable";
    };

export async function getListingDetails(
  listingId: string,
): Promise<ListingDetailsResult> {
  const { supabase, user } = await requireVerifiedActiveStudent(
    `/listing/${listingId}`,
  );
  const { data, error } = await supabase
    .from("listings")
    .select(`
      id, seller_id, title, description, price, condition, status,
      created_at, updated_at,
      category:categories (id, name),
      listing_images (storage_path, is_cover, sort_order)
    `)
    .eq("id", listingId)
    .maybeSingle();

  if (error) {
    console.warn("Unable to load listing details", { code: error.code });
    return { listing: null, error: "unavailable" };
  }
  if (!data) return { listing: null, error: "not_found" };

  const listing = data as unknown as ListingDetailsRow;
  const isOwner = listing.seller_id === user.id;
  const reservationQuery = supabase
    .from("reservations")
    .select("id, buyer_id, status, created_at")
    .eq("listing_id", listingId)
    .in("status", ["pending", "accepted"])
    .order("created_at", { ascending: false });
  const [sellerResult, favoriteResult, reservationResult, conversationResult] =
    await Promise.all([
      supabase
        .from("marketplace_profiles")
        .select("id, full_name, course, year_level, avatar_path, verification_status")
        .eq("id", listing.seller_id)
        .maybeSingle(),
      isOwner
        ? Promise.resolve({ data: null, error: null })
        : supabase
            .from("favorites")
            .select("listing_id")
            .eq("user_id", user.id)
            .eq("listing_id", listingId)
            .maybeSingle(),
      isOwner ? reservationQuery : reservationQuery.eq("buyer_id", user.id),
      isOwner
        ? Promise.resolve({ data: null, error: null })
        : supabase
            .from("conversations")
            .select("id")
            .eq("listing_id", listingId)
            .eq("buyer_id", user.id)
            .maybeSingle(),
    ]);

  if (
    sellerResult.error ||
    (!sellerResult.data && listing.status !== "sold") ||
    favoriteResult.error ||
    reservationResult.error ||
    conversationResult.error
  ) {
    console.warn("Unable to load related listing details");
    return { listing: null, error: "unavailable" };
  }

  // A saved sold listing is durable history even if its seller is later
  // suspended. Marketplace profile views intentionally hide ineligible
  // accounts, so render a privacy-safe historical identity in that case.
  const seller: SellerProfileRow = sellerResult.data
    ? (sellerResult.data as SellerProfileRow)
    : {
        id: listing.seller_id,
        full_name: "Former UC Student",
        course: null,
        year_level: null,
        avatar_path: null,
        verification_status: "unavailable",
      };
  const reservationRows = (reservationResult.data ?? []) as ActiveReservationRow[];
  const acceptedReservation = isOwner
    ? reservationRows.find((reservation) => reservation.status === "accepted") ?? null
    : null;
  const acceptedBuyerResult = acceptedReservation
    ? await supabase
        .from("marketplace_profiles")
        .select("id, full_name, verification_status")
        .eq("id", acceptedReservation.buyer_id)
        .maybeSingle()
    : { data: null, error: null };
  if (acceptedBuyerResult.error) {
    console.warn("Unable to load accepted reservation buyer", {
      code: acceptedBuyerResult.error.code,
    });
    return { listing: null, error: "unavailable" };
  }
  const orderedImages = sortListingImages(listing.listing_images);
  const { urls, hasError } = await signListingImagePaths(
    supabase,
    orderedImages.map((image) => image.storage_path),
  );
  if (hasError) return { listing: null, error: "unavailable" };

  const statusValue = toListingStatus(listing.status);

  return {
    listing: {
      id: listing.id,
      sellerId: listing.seller_id,
      title: listing.title,
      description: listing.description,
      price: formatListingPrice(listing.price),
      condition: formatListingCondition(listing.condition),
      status: getListingStatusLabel(statusValue),
      statusValue,
      categoryName: getCategoryName(listing.category),
      createdAt: listing.created_at,
      updatedAt: listing.updated_at,
      isOwner,
      isFavorited: Boolean(favoriteResult.data),
      activeReservation: !isOwner && reservationRows[0]
        ? {
            id: reservationRows[0].id,
            status: reservationRows[0].status,
          }
        : null,
      reservationOverview: isOwner
        ? {
            pendingCount: reservationRows.filter(
              (reservation) => reservation.status === "pending",
            ).length,
            acceptedReservation: acceptedReservation
              ? {
                  id: acceptedReservation.id,
                  buyerName:
                    acceptedBuyerResult.data?.full_name?.trim() || "UC Student",
                  buyerIsVerified:
                    acceptedBuyerResult.data?.verification_status === "verified",
                }
              : null,
          }
        : null,
      existingConversationId:
        typeof conversationResult.data?.id === "string"
          ? conversationResult.data.id
          : null,
      seller: {
        id: seller.id,
        fullName: seller.full_name,
        course: seller.course,
        yearLevel: seller.year_level,
        avatarUrl: getAvatarUrl(supabase, seller.id, seller.avatar_path),
        isVerified: seller.verification_status === "verified",
      },
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

export async function getOwnedListingForEdit(
  listingId: string,
): Promise<OwnedListingForEditResult> {
  const { supabase, user } = await requireVerifiedActiveStudent(
    `/listing/${listingId}/edit`,
  );
  const { data, error } = await supabase
    .from("listings")
    .select(`
      id, seller_id, category_id, title, description, price, condition,
      status, created_at, updated_at,
      listing_images (id, storage_path, is_cover, sort_order)
    `)
    .eq("id", listingId)
    .eq("seller_id", user.id)
    .maybeSingle();

  if (error) {
    console.warn("Unable to load listing for edit", { code: error.code });
    return { listing: null, error: "unavailable" };
  }
  if (!data) return { listing: null, error: "not_found" };

  const listing = data as unknown as OwnedListingEditRow;
  const status = toListingStatus(listing.status);
  if (status !== "available" && status !== "reserved") {
    return { listing: null, error: "not_editable" };
  }

  const orderedImages = sortListingImages(listing.listing_images);
  const { urls, hasError } = await signListingImagePaths(
    supabase,
    orderedImages.map((image) => image.storage_path),
  );
  if (hasError) return { listing: null, error: "unavailable" };

  return {
    listing: {
      id: listing.id,
      title: listing.title,
      description: listing.description,
      categoryId: listing.category_id,
      price: Number(listing.price).toFixed(2),
      condition: listing.condition,
      status,
      createdAt: listing.created_at,
      updatedAt: listing.updated_at,
      images: orderedImages.flatMap((image, index) => {
        const src = urls.get(image.storage_path);
        return src && image.id
          ? [
              {
                id: image.id,
                storagePath: image.storage_path,
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
