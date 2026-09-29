"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ActionNotice } from "@/components/action-notice";
import {
  acceptReservation,
  cancelReservation,
  completeSale,
  openReservationConversation,
  rejectReservation,
  type ReservationActionResult,
} from "@/features/reservations/actions";
import { MeetupDialog } from "@/features/reservations/components/meetup-dialog";
import { useReservationNotice } from "@/features/reservations/components/reservation-feedback-provider";
import { mapReservationError } from "@/features/reservations/errors";
import { getReservationCapabilities } from "@/features/reservations/rules";
import type {
  ReservationMeetup,
  ReservationStatus,
  ReservationViewerRole,
} from "@/features/reservations/types";

type PendingAction = "accept" | "reject" | "cancel" | "complete" | "message";

export function ReservationActionPanel({
  reservationId,
  role,
  status,
  listingStatus,
  meetup,
  conversationId,
  listingTitle,
  participantName,
  compact = false,
}: {
  reservationId: string;
  role: ReservationViewerRole;
  status: ReservationStatus;
  listingStatus: string;
  meetup: ReservationMeetup | null;
  conversationId: string | null;
  listingTitle?: string;
  participantName?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const { notice, showNotice, dismissNotice } = useReservationNotice();
  const [pending, startTransition] = useTransition();
  const capabilities = getReservationCapabilities({
    role,
    reservationStatus: status,
    listingStatus,
    meetupStatus: meetup?.status ?? null,
  });

  function execute(
    action: Exclude<PendingAction, "message">,
    confirmation: string,
    callback: () => Promise<ReservationActionResult>,
  ) {
    if (pending) return;
    if (!window.confirm(confirmation)) return;
    setPendingAction(action);
    startTransition(async () => {
      try {
        const result = await callback();
        showNotice(result.message, result.ok ? "success" : "error");
      } catch (error) {
        unstable_rethrow(error);
        showNotice(mapReservationError(action, null), "error");
      } finally {
        setPendingAction(null);
        // A failed request may still have reached the database. Reload its
        // state before allowing the user to try the action again.
        router.refresh();
      }
    });
  }

  function messageParticipant() {
    if (pending) return;
    if (conversationId) {
      router.push(`/messages/${conversationId}`);
      return;
    }

    setPendingAction("message");
    startTransition(async () => {
      try {
        const result = await openReservationConversation(reservationId);
        if (result.ok && result.conversationId) {
          router.push(`/messages/${result.conversationId}`);
          return;
        }
        showNotice(result.message, "error");
      } catch (error) {
        unstable_rethrow(error);
        showNotice("Unable to open this conversation. Refresh and try again.", "error");
      } finally {
        setPendingAction(null);
        router.refresh();
      }
    });
  }

  const buttonSize = compact ? "min-h-9 px-3 text-xs" : "min-h-11 px-4 text-sm";
  const canMessage = capabilities.canMessage && listingStatus !== "removed";

  if (
    !canMessage &&
    !capabilities.canAccept &&
    !capabilities.canReject &&
    !capabilities.canCancel &&
    !capabilities.canManageMeetup &&
    !capabilities.canCompleteSale
  ) {
    return null;
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {capabilities.canAccept && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              execute(
                "accept",
                "Accept this request? The listing will be reserved for this buyer and other pending requests will be declined.",
                () => acceptReservation(reservationId),
              )
            }
            className={`rounded-md bg-[#0038a8] font-semibold text-white hover:bg-[#002576] disabled:cursor-wait disabled:opacity-60 ${buttonSize}`}
          >
            {pendingAction === "accept" ? "Accepting..." : "Accept"}
          </button>
        )}

        {capabilities.canReject && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              execute(
                "reject",
                "Decline this reservation request? This cannot be undone.",
                () => rejectReservation(reservationId),
              )
            }
            className={`rounded-md border border-red-300 font-semibold text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60 ${buttonSize}`}
          >
            {pendingAction === "reject" ? "Declining..." : "Decline"}
          </button>
        )}

        {capabilities.canManageMeetup && (
          <MeetupDialog
            reservationId={reservationId}
            meetup={meetup}
            compact={compact}
            disabled={pending}
          />
        )}

        {canMessage && (
          <button
            type="button"
            disabled={pending}
            onClick={messageParticipant}
            className={`rounded-md border border-[#c4c5d5] bg-white font-semibold text-[#002576] hover:bg-[#e9effb] disabled:cursor-wait disabled:opacity-60 ${buttonSize}`}
          >
            {pendingAction === "message"
              ? "Opening..."
              : role === "seller"
                ? "Message Buyer"
                : "Message Seller"}
          </button>
        )}

        {capabilities.canCompleteSale && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              execute(
                "complete",
                [
                  `Mark${listingTitle ? ` “${listingTitle}”` : " this item"} as sold?`,
                  "Confirm only after the in-person exchange and item transfer are finished.",
                  participantName ? `Buyer: ${participantName}.` : null,
                  `This will mark the listing sold and complete the reservation${meetup ? " and meetup" : ""}.`,
                ]
                  .filter(Boolean)
                  .join("\n\n"),
                () => completeSale(reservationId),
              )
            }
            className={`rounded-md bg-emerald-700 font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60 ${buttonSize}`}
          >
            {pendingAction === "complete" ? "Completing..." : "Mark Sold"}
          </button>
        )}

        {capabilities.canCancel && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              execute(
                "cancel",
                status === "accepted"
                  ? "Cancel this accepted reservation? Its meetup will be cancelled and the listing will become available again."
                  : "Cancel this reservation request?",
                () => cancelReservation(reservationId),
              )
            }
            className={`rounded-md px-3 font-semibold text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60 ${buttonSize}`}
          >
            {pendingAction === "cancel"
              ? "Cancelling..."
              : status === "pending"
                ? "Cancel Request"
                : "Cancel Reservation"}
          </button>
        )}
      </div>

      <ActionNotice
        message={notice?.message ?? null}
        variant={notice?.variant ?? "success"}
        onDismiss={dismissNotice}
      />
    </>
  );
}
