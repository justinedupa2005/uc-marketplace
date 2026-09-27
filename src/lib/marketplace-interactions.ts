import "server-only";

import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";
import { signListingImagePaths } from "@/lib/listings";

type SafeProfileRow = { id: string; full_name: string };
type ListingSummaryRow = {
  id: string;
  title: string;
  status: string;
  listing_images?: Array<{
    storage_path: string;
    is_cover: boolean;
    sort_order: number;
  }> | null;
};

type ListingInteractionContextRow = {
  listing_id: string;
  title: string;
  status: string;
};

export type ReservationSummary = {
  id: string;
  listingId: string;
  listingTitle: string;
  imageUrl: string | null;
  otherStudentName: string;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "completed";
  createdAt: string;
  isIncoming: boolean;
  canViewListing: boolean;
};

async function getProfilesById(
  supabase: Awaited<ReturnType<typeof requireVerifiedActiveStudent>>["supabase"],
  ids: string[],
) {
  if (ids.length === 0) return { profiles: new Map<string, string>(), error: false };
  const { data, error } = await supabase
    .from("marketplace_profiles")
    .select("id, full_name")
    .in("id", [...new Set(ids)]);

  return {
    profiles: new Map(
      ((data ?? []) as SafeProfileRow[]).map((profile) => [profile.id, profile.full_name]),
    ),
    error: Boolean(error),
  };
}

async function getListingsById(
  supabase: Awaited<ReturnType<typeof requireVerifiedActiveStudent>>["supabase"],
  ids: string[],
  withImages = false,
) {
  if (ids.length === 0) return { listings: new Map<string, ListingSummaryRow>(), error: false };
  const selection = withImages
    ? "id, title, status, listing_images(storage_path, is_cover, sort_order)"
    : "id, title, status";
  const { data, error } = await supabase
    .from("listings")
    .select(selection)
    .in("id", [...new Set(ids)]);

  return {
    listings: new Map(
      ((data ?? []) as unknown as ListingSummaryRow[]).map((listing) => [listing.id, listing]),
    ),
    error: Boolean(error),
  };
}

async function getListingInteractionContexts(
  supabase: Awaited<ReturnType<typeof requireVerifiedActiveStudent>>["supabase"],
) {
  const { data, error } = await supabase.rpc(
    "get_my_listing_interaction_contexts",
  );

  return {
    contexts: new Map(
      ((data ?? []) as ListingInteractionContextRow[]).map((context) => [
        context.listing_id,
        context,
      ]),
    ),
    error: Boolean(error),
  };
}

export async function getReservations(): Promise<{
  reservations: ReservationSummary[];
  error: boolean;
}> {
  const { supabase, user } = await requireVerifiedActiveStudent("/reservations");
  const { data, error } = await supabase
    .from("reservations")
    .select("id, listing_id, buyer_id, seller_id, status, created_at")
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Unable to load reservations", { code: error.code });
    return { reservations: [], error: true };
  }

  const rows = (data ?? []) as Array<{
    id: string;
    listing_id: string;
    buyer_id: string;
    seller_id: string;
    status: ReservationSummary["status"];
    created_at: string;
  }>;
  const [profileResult, listingResult, contextResult] = await Promise.all([
    getProfilesById(
      supabase,
      rows.map((row) => row.seller_id === user.id ? row.buyer_id : row.seller_id),
    ),
    getListingsById(supabase, rows.map((row) => row.listing_id), true),
    getListingInteractionContexts(supabase),
  ]);
  if (profileResult.error || listingResult.error || contextResult.error) {
    return { reservations: [], error: true };
  }

  const coverPaths = [...listingResult.listings.values()].flatMap((listing) => {
    const images = [...(listing.listing_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    const cover = images.find((image) => image.is_cover) ?? images[0];
    return cover ? [cover.storage_path] : [];
  });
  const { urls } = await signListingImagePaths(supabase, coverPaths);

  return {
    reservations: rows.map((row) => {
      const listing = listingResult.listings.get(row.listing_id);
      const context = contextResult.contexts.get(row.listing_id);
      const images = [...(listing?.listing_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
      const cover = images.find((image) => image.is_cover) ?? images[0];
      const isIncoming = row.seller_id === user.id;
      const otherId = isIncoming ? row.buyer_id : row.seller_id;
      return {
        id: row.id,
        listingId: row.listing_id,
        listingTitle:
          listing?.title ?? context?.title ?? "Listing no longer active",
        imageUrl: cover ? (urls.get(cover.storage_path) ?? null) : null,
        otherStudentName: profileResult.profiles.get(otherId) ?? "UC Student",
        status: row.status,
        createdAt: row.created_at,
        isIncoming,
        canViewListing: Boolean(listing),
      };
    }),
    error: false,
  };
}
