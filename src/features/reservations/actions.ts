"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

const reservationIdSchema = z.string().uuid();

export type ReservationActionResult = {
  ok: boolean;
  message: string;
};

function invalidRequest(message = "This request is invalid. Refresh and try again.") {
  return { ok: false, message } satisfies ReservationActionResult;
}

function logActionFailure(action: string, code?: string) {
  console.warn("Reservation action failed", {
    action,
    code: code ?? "unknown",
  });
}

function refreshReservationPaths() {
  revalidatePath("/reservations");
  revalidatePath("/marketplace");
  revalidatePath("/my-listings");
}

export async function respondToReservation(
  reservationId: string,
  decision: "accepted" | "rejected",
): Promise<ReservationActionResult> {
  const parsed = z
    .object({
      reservationId: reservationIdSchema,
      decision: z.enum(["accepted", "rejected"]),
    })
    .safeParse({ reservationId, decision });
  if (!parsed.success) return invalidRequest();

  const { supabase } = await requireVerifiedActiveStudent("/reservations");
  const { error } = await supabase.rpc("respond_to_listing_reservation", {
    p_reservation_id: parsed.data.reservationId,
    p_decision: parsed.data.decision,
  });

  if (error) {
    logActionFailure("reservation-response", error.code);
    return invalidRequest(
      "This reservation request could not be updated. Refresh and try again.",
    );
  }

  refreshReservationPaths();
  return {
    ok: true,
    message:
      parsed.data.decision === "accepted"
        ? "Reservation accepted and listing marked reserved."
        : "Reservation request declined.",
  };
}

export async function cancelReservation(
  reservationId: string,
): Promise<ReservationActionResult> {
  const parsedId = reservationIdSchema.safeParse(reservationId);
  if (!parsedId.success) return invalidRequest();

  const { supabase } = await requireVerifiedActiveStudent("/reservations");
  const { error } = await supabase.rpc("cancel_listing_reservation", {
    p_reservation_id: parsedId.data,
  });

  if (error) {
    logActionFailure("reservation-cancel", error.code);
    return invalidRequest("Unable to cancel this reservation request.");
  }

  refreshReservationPaths();
  return { ok: true, message: "Reservation request cancelled." };
}
