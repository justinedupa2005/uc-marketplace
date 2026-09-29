"use server";

import { revalidatePath } from "next/cache";

import {
  mapReservationError,
  type DatabaseErrorLike,
  type ReservationOperation,
} from "@/features/reservations/errors";
import {
  createMeetupDetailsSchema,
  requestReservationSchema,
  reservationIdSchema,
} from "@/features/reservations/validation";
import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

export type ReservationActionResult = {
  ok: boolean;
  message: string;
  reservationId?: string;
  meetupId?: string;
  conversationId?: string;
};

function invalidRequest(message = "This request is invalid. Refresh and try again.") {
  return { ok: false, message } satisfies ReservationActionResult;
}

function logActionFailure(
  action: ReservationOperation | "conversation",
  error: DatabaseErrorLike | null,
) {
  console.warn("Reservation action failed", {
    action,
    code: error?.code ?? "unknown",
  });
}

function refreshReservationPaths(reservationId?: string, listingId?: string) {
  revalidatePath("/reservations");
  if (reservationId) revalidatePath(`/reservations/${reservationId}`);
  if (listingId) revalidatePath(`/listing/${listingId}`);
  revalidatePath("/listing/[id]", "page");
  revalidatePath("/marketplace");
  revalidatePath("/my-listings");
  revalidatePath("/favorites");
  revalidatePath("/messages");
}

export async function requestReservation(
  listingId: string,
  message: string,
): Promise<ReservationActionResult> {
  const parsed = requestReservationSchema.safeParse({ listingId, message });
  if (!parsed.success) {
    return invalidRequest(
      parsed.error.issues[0]?.message ?? "Check your reservation request.",
    );
  }

  const { supabase } = await requireVerifiedActiveStudent(
    `/listing/${parsed.data.listingId}`,
  );
  const { data, error } = await supabase.rpc("request_reservation", {
    p_listing_id: parsed.data.listingId,
    p_message: parsed.data.message,
  });

  if (error || typeof data !== "string") {
    logActionFailure("request", error);
    return invalidRequest(mapReservationError("request", error));
  }

  refreshReservationPaths(data, parsed.data.listingId);
  return {
    ok: true,
    reservationId: data,
    message: "Reservation request sent to the seller.",
  };
}

async function updateReservationStatus(
  reservationId: string,
  operation: "accept" | "reject" | "cancel" | "complete",
): Promise<ReservationActionResult> {
  const parsedId = reservationIdSchema.safeParse(reservationId);
  if (!parsedId.success) return invalidRequest();

  const { supabase } = await requireVerifiedActiveStudent(
    `/reservations/${parsedId.data}`,
  );
  const result =
    operation === "accept"
      ? await supabase.rpc("accept_reservation", {
          p_reservation_id: parsedId.data,
        })
      : operation === "reject"
        ? await supabase.rpc("reject_reservation", {
            p_reservation_id: parsedId.data,
          })
        : operation === "cancel"
          ? await supabase.rpc("cancel_reservation", {
              p_reservation_id: parsedId.data,
            })
          : await supabase.rpc("complete_sale", {
              p_reservation_id: parsedId.data,
            });

  if (result.error) {
    logActionFailure(operation, result.error);
    return invalidRequest(mapReservationError(operation, result.error));
  }

  refreshReservationPaths(parsedId.data);
  const successMessages = {
    accept: "Reservation accepted. The listing is now reserved for this buyer.",
    reject: "Reservation request declined.",
    cancel: "Reservation cancelled and the listing is available again when applicable.",
    complete: "Sale completed and the listing marked sold.",
  } as const;

  return { ok: true, message: successMessages[operation] };
}

export async function acceptReservation(reservationId: string) {
  return updateReservationStatus(reservationId, "accept");
}

export async function rejectReservation(reservationId: string) {
  return updateReservationStatus(reservationId, "reject");
}

export async function cancelReservation(reservationId: string) {
  return updateReservationStatus(reservationId, "cancel");
}

export async function completeSale(reservationId: string) {
  return updateReservationStatus(reservationId, "complete");
}

export async function saveMeetup(
  reservationId: string,
  locationName: string,
  locationDetails: string,
  scheduledAt: string,
  notes: string,
  expectedUpdatedAt: string | null = null,
): Promise<ReservationActionResult> {
  const parsed = createMeetupDetailsSchema().safeParse({
    reservationId,
    locationName,
    locationDetails,
    scheduledAt,
    notes,
    expectedUpdatedAt,
  });
  if (!parsed.success) {
    return invalidRequest(
      parsed.error.issues[0]?.message ?? "Check the meetup details.",
    );
  }

  const { supabase } = await requireVerifiedActiveStudent(
    `/reservations/${parsed.data.reservationId}`,
  );
  const { data, error } = await supabase.rpc("upsert_meetup", {
    p_reservation_id: parsed.data.reservationId,
    p_location_name: parsed.data.locationName,
    p_location_details: parsed.data.locationDetails,
    p_scheduled_at: parsed.data.scheduledAt,
    p_notes: parsed.data.notes,
    p_expected_updated_at: parsed.data.expectedUpdatedAt,
  });

  if (error || typeof data !== "string") {
    logActionFailure("meetup", error);
    return invalidRequest(mapReservationError("meetup", error));
  }

  refreshReservationPaths(parsed.data.reservationId);
  return {
    ok: true,
    meetupId: data,
    message: "Meetup details saved for both participants.",
  };
}

export async function openReservationConversation(
  reservationId: string,
): Promise<ReservationActionResult> {
  const parsedId = reservationIdSchema.safeParse(reservationId);
  if (!parsedId.success) return invalidRequest();

  const { supabase } = await requireVerifiedActiveStudent(
    `/reservations/${parsedId.data}`,
  );
  const { data, error } = await supabase.rpc(
    "start_reservation_conversation",
    { p_reservation_id: parsedId.data },
  );

  if (error || typeof data !== "string") {
    logActionFailure("conversation", error);
    return invalidRequest(
      "Unable to open this conversation. Refresh and try again.",
    );
  }

  revalidatePath("/messages");
  refreshReservationPaths(parsedId.data);
  return {
    ok: true,
    conversationId: data,
    message: "Conversation ready.",
  };
}
