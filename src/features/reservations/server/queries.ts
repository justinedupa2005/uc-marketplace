import "server-only";

import { formatListingPrice } from "@/features/listings/formatters";
import {
  isListingStatus,
  type ListingStatus,
} from "@/features/listings/rules";
import { signListingImagePaths } from "@/features/listings/server/media";
import { getAvatarUrl } from "@/features/profiles/server/avatar-url";
import {
  isMeetupStatus,
  isReservationStatus,
} from "@/features/reservations/rules";
import {
  type ReservationDetails,
  type ReservationMeetup,
  type ReservationStudent,
  type ReservationSummary,
  type ReservationViewerRole,
} from "@/features/reservations/types";
import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

type ReservationSupabase = Awaited<
  ReturnType<typeof requireVerifiedActiveStudent>
>["supabase"];

/**
 * Flattened row returned by get_my_reservation_summaries(). The optional RPC
 * argument limits the result to one participant-visible reservation for the
 * details route; omitting it returns all reservations for the current user.
 */
type ReservationSummaryRow = {
  reservation_id: string;
  listing_id: string;
  listing_title: string;
  listing_status: string;
  listing_price: number | string;
  listing_image_path: string | null;
  buyer_id: string;
  seller_id: string;
  viewer_role: string;
  other_user_id: string;
  other_user_name: string | null;
  other_user_avatar_path: string | null;
  other_user_is_verified: boolean;
  reservation_status: string;
  reservation_message: string | null;
  reservation_created_at: string;
  reservation_updated_at: string;
  responded_at: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  conversation_id: string | null;
  pending_request_count: number | string;
  can_view_listing: boolean;
  meetup_id: string | null;
  meetup_status: string | null;
  meetup_location_name: string | null;
  meetup_location_details: string | null;
  meetup_scheduled_at: string | null;
  meetup_notes: string | null;
  meetup_created_at: string | null;
  meetup_updated_at: string | null;
  meetup_cancelled_at: string | null;
  meetup_completed_at: string | null;
};

type CurrentProfileRow = {
  id: string;
  full_name: string | null;
  avatar_path: string | null;
  verification_status: string | null;
};

function getViewerRole(
  row: ReservationSummaryRow,
  currentUserId: string,
): ReservationViewerRole | null {
  if (row.viewer_role === "buyer" || row.viewer_role === "seller") {
    return row.viewer_role;
  }

  if (row.buyer_id === currentUserId) return "buyer";
  if (row.seller_id === currentUserId) return "seller";
  return null;
}

function getListingStatus(value: string): ListingStatus {
  return isListingStatus(value) ? value : "removed";
}

function getPendingRequestCount(value: number | string) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function getMeetup(row: ReservationSummaryRow): ReservationMeetup | null {
  if (
    !row.meetup_id ||
    !row.meetup_status ||
    !isMeetupStatus(row.meetup_status) ||
    !row.meetup_location_name ||
    !row.meetup_scheduled_at ||
    !row.meetup_created_at ||
    !row.meetup_updated_at
  ) {
    return null;
  }

  return {
    id: row.meetup_id,
    status: row.meetup_status,
    locationName: row.meetup_location_name,
    locationDetails: row.meetup_location_details,
    scheduledAt: row.meetup_scheduled_at,
    notes: row.meetup_notes,
    createdAt: row.meetup_created_at,
    updatedAt: row.meetup_updated_at,
    cancelledAt: row.meetup_cancelled_at,
    completedAt: row.meetup_completed_at,
  };
}

async function mapReservationRows(
  supabase: ReservationSupabase,
  currentUserId: string,
  rows: ReservationSummaryRow[],
) {
  const { urls } = await signListingImagePaths(
    supabase,
    rows.flatMap((row) =>
      row.listing_image_path ? [row.listing_image_path] : [],
    ),
  );

  return rows.flatMap((row): ReservationSummary[] => {
    const viewerRole = getViewerRole(row, currentUserId);
    if (!viewerRole || !isReservationStatus(row.reservation_status)) {
      console.warn("Ignoring an invalid reservation summary row", {
        reservationId: row.reservation_id,
      });
      return [];
    }

    const listingPrice = formatListingPrice(row.listing_price);
    const imageUrl = row.listing_image_path
      ? (urls.get(row.listing_image_path) ?? null)
      : null;
    const otherStudent: ReservationStudent = {
      id: row.other_user_id,
      name: row.other_user_name?.trim() || "UC Student",
      avatarUrl: getAvatarUrl(
        supabase,
        row.other_user_id,
        row.other_user_avatar_path,
      ),
      isVerified: Boolean(row.other_user_is_verified),
    };
    const listing = {
      id: row.listing_id,
      title: row.listing_title.trim() || "Listing no longer active",
      price: listingPrice,
      status: getListingStatus(row.listing_status),
      imageUrl,
      canView: Boolean(row.can_view_listing),
    };

    return [{
      id: row.reservation_id,
      buyerId: row.buyer_id,
      sellerId: row.seller_id,
      viewerRole,
      status: row.reservation_status,
      message: row.reservation_message,
      createdAt: row.reservation_created_at,
      updatedAt: row.reservation_updated_at,
      respondedAt: row.responded_at,
      cancelledAt: row.cancelled_at,
      completedAt: row.completed_at,
      conversationId: row.conversation_id,
      pendingRequestCount: getPendingRequestCount(row.pending_request_count),
      listing,
      otherStudent,
      meetup: getMeetup(row),
      listingId: listing.id,
      listingTitle: listing.title,
      listingPrice,
      imageUrl,
      otherStudentName: otherStudent.name,
      otherStudentAvatarUrl: otherStudent.avatarUrl,
      otherStudentIsVerified: otherStudent.isVerified,
      isIncoming: viewerRole === "seller",
      canViewListing: listing.canView,
    }];
  });
}

function mapCurrentStudent(
  supabase: ReservationSupabase,
  profile: CurrentProfileRow,
): ReservationStudent {
  return {
    id: profile.id,
    name: profile.full_name?.trim() || "You",
    avatarUrl: getAvatarUrl(supabase, profile.id, profile.avatar_path),
    isVerified: profile.verification_status === "verified",
  };
}

export async function getReservations(): Promise<{
  reservations: ReservationSummary[];
  error: boolean;
}> {
  const { supabase, user } = await requireVerifiedActiveStudent("/reservations");
  const { data, error } = await supabase.rpc(
    "get_my_reservation_summaries",
    {},
  );

  if (error) {
    console.warn("Unable to load reservation summaries", { code: error.code });
    return { reservations: [], error: true };
  }

  const reservations = await mapReservationRows(
    supabase,
    user.id,
    (data ?? []) as ReservationSummaryRow[],
  );
  reservations.sort(
    (first, second) =>
      new Date(second.createdAt).getTime() -
        new Date(first.createdAt).getTime() ||
      second.id.localeCompare(first.id),
  );

  return { reservations, error: false };
}

export type ReservationDetailsResult =
  | { reservation: ReservationDetails; error: null }
  | { reservation: null; error: "not_found" | "unavailable" };

export async function getReservationDetails(
  reservationId: string,
): Promise<ReservationDetailsResult> {
  const { supabase, user } = await requireVerifiedActiveStudent(
    `/reservations/${reservationId}`,
  );
  const [reservationResult, profileResult] = await Promise.all([
    supabase
      .rpc("get_my_reservation_summaries", {
        p_reservation_id: reservationId,
      })
      .maybeSingle(),
    supabase
      .from("marketplace_profiles")
      .select("id, full_name, avatar_path, verification_status")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  if (reservationResult.error || profileResult.error || !profileResult.data) {
    console.warn("Unable to load reservation details", {
      reservationCode: reservationResult.error?.code,
      profileCode: profileResult.error?.code,
    });
    return { reservation: null, error: "unavailable" };
  }
  if (!reservationResult.data) {
    return { reservation: null, error: "not_found" };
  }

  const [summary] = await mapReservationRows(
    supabase,
    user.id,
    [reservationResult.data as ReservationSummaryRow],
  );
  if (!summary) {
    return { reservation: null, error: "unavailable" };
  }

  const currentStudent = mapCurrentStudent(
    supabase,
    profileResult.data as CurrentProfileRow,
  );

  return {
    reservation: {
      ...summary,
      currentUserId: user.id,
      buyer:
        summary.viewerRole === "buyer"
          ? currentStudent
          : summary.otherStudent,
      seller:
        summary.viewerRole === "seller"
          ? currentStudent
          : summary.otherStudent,
    },
    error: null,
  };
}
