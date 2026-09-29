"use client";

import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import { ActionNotice } from "@/components/action-notice";
import { changeOwnedListingStatus } from "@/features/listings/actions";
import { VerificationBadge } from "@/features/listings/components/seller-card";
import {
  canOwnerEditListing,
  canOwnerRemoveListing,
  type ListingStatus,
} from "@/features/listings/rules";
import type { ListingReservationOverview } from "@/features/listings/types";
import { openReservationConversation } from "@/features/reservations/actions";
import { ReservationStatusBadge } from "@/features/reservations/components/reservation-status-badge";

export function ListingOwnerActions({
  listingId,
  status,
  reservationOverview,
  compact = false,
}: {
  listingId: string;
  status: ListingStatus;
  reservationOverview?: ListingReservationOverview | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"remove" | "message" | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    variant: "success" | "error";
  } | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);

  function removeListing() {
    if (pending) return;
    const confirmed = window.confirm(
      "Remove this listing? Active reservations will be closed, and it will disappear from marketplace browsing but remain in your history.",
    );
    if (!confirmed) return;

    setPendingAction("remove");
    startTransition(async () => {
      try {
        const result = await changeOwnedListingStatus(listingId, "removed");
        setNotice({
          message: result.message,
          variant: result.ok ? "success" : "error",
        });
      } catch (error) {
        unstable_rethrow(error);
        setNotice({
          message: "Unable to confirm whether your listing was removed. Refresh and try again.",
          variant: "error",
        });
      } finally {
        setPendingAction(null);
        // The response may fail after the listing and reservations changed.
        router.refresh();
      }
    });
  }

  function messageAcceptedBuyer() {
    if (pending) return;
    const reservationId = reservationOverview?.acceptedReservation?.id;
    if (!reservationId) return;

    setPendingAction("message");
    startTransition(async () => {
      let conversationOpened = false;
      try {
        const result = await openReservationConversation(reservationId);
        if (result.ok && result.conversationId) {
          conversationOpened = true;
          router.push(`/messages/${result.conversationId}`);
          return;
        }

        setNotice({ message: result.message, variant: "error" });
      } catch (error) {
        unstable_rethrow(error);
        setNotice({
          message: "Unable to open this conversation. Refresh and try again.",
          variant: "error",
        });
      } finally {
        setPendingAction(null);
        if (!conversationOpened) router.refresh();
      }
    });
  }

  const baseClass = compact
    ? "min-h-9 px-3 text-xs"
    : "min-h-11 px-4 text-sm";
  const reservationHref = reservationOverview?.acceptedReservation
    ? `/reservations/${reservationOverview.acceptedReservation.id}`
    : `/reservations?view=selling&listing=${listingId}`;
  const reservationLabel = reservationOverview?.acceptedReservation
    ? `Reservation: ${reservationOverview.acceptedReservation.buyerName}`
    : reservationOverview && reservationOverview.pendingCount > 0
      ? `Requests (${reservationOverview.pendingCount})`
      : "Reservations";

  return (
    <>
      <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-8"}`}>
        {reservationOverview?.acceptedReservation ? (
          <>
            <ReservationStatusBadge status="accepted" />
            {reservationOverview.acceptedReservation.buyerIsVerified && (
              <VerificationBadge />
            )}
          </>
        ) : reservationOverview && reservationOverview.pendingCount > 0 ? (
          <ReservationStatusBadge status="pending" />
        ) : null}
        {canOwnerEditListing(status) && (
          <Link
            href={`/listing/${listingId}/edit`}
            className={`inline-flex items-center justify-center rounded-md bg-[#0038a8] font-semibold text-white hover:bg-[#002576] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8] ${baseClass}`}
          >
            Edit
          </Link>
        )}
        {status !== "draft" && (
          <Link
            href={reservationHref}
            className={`inline-flex items-center justify-center rounded-md border border-[#0038a8] font-semibold text-[#0038a8] hover:bg-[#e9effb] ${baseClass}`}
          >
            {reservationLabel}
          </Link>
        )}
        {reservationOverview?.acceptedReservation && status === "reserved" && (
          <button
            type="button"
            disabled={pending}
            onClick={messageAcceptedBuyer}
            className={`rounded-md border border-[#c4c5d5] bg-white font-semibold text-[#002576] hover:bg-[#e9effb] disabled:cursor-wait disabled:opacity-60 ${baseClass}`}
          >
            {pendingAction === "message" ? "Opening..." : "Message Buyer"}
          </button>
        )}
        {canOwnerRemoveListing(status) && (
          <button
            type="button"
            disabled={pending}
            onClick={removeListing}
            className={`rounded-md border border-red-300 font-semibold text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60 ${baseClass}`}
          >
            {pendingAction === "remove" ? "Removing..." : "Remove"}
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
