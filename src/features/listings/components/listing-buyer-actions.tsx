"use client";

import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import { ActionNotice } from "@/components/action-notice";
import { FavoriteButton } from "@/features/favorites/components/favorite-button";
import { startListingConversation } from "@/features/listings/actions";
import { ReportListingDialog } from "@/features/listings/components/report-listing-dialog";
import {
  canFavoriteListing,
  canReportListing,
  canSendExistingConversation,
  canStartListingConversation,
  type ListingStatus,
} from "@/features/listings/rules";
import { cancelReservation } from "@/features/reservations/actions";
import { RequestReservationDialog } from "@/features/reservations/components/request-reservation-dialog";
import { ReservationStatusBadge } from "@/features/reservations/components/reservation-status-badge";

type ActiveReservation = {
  id: string;
  status: "pending" | "accepted";
};

type ReservationSnapshot = {
  serverKey: string;
  reservation: ActiveReservation | null;
};

export function ListingBuyerActions({
  listingId,
  title,
  price,
  sellerName,
  sellerIsVerified,
  imageUrl,
  status,
  initialIsFavorited,
  activeReservation,
  existingConversationId,
}: {
  listingId: string;
  title: string;
  price: string;
  sellerName: string;
  sellerIsVerified: boolean;
  imageUrl: string | null;
  status: ListingStatus;
  initialIsFavorited: boolean;
  activeReservation: ActiveReservation | null;
  existingConversationId: string | null;
}) {
  const router = useRouter();
  const serverReservationKey = activeReservation
    ? `${activeReservation.id}:${activeReservation.status}`
    : "none";
  const [reservationSnapshot, setReservationSnapshot] =
    useState<ReservationSnapshot>({
      serverKey: serverReservationKey,
      reservation: activeReservation,
    });
  if (reservationSnapshot.serverKey !== serverReservationKey) {
    setReservationSnapshot({
      serverKey: serverReservationKey,
      reservation: activeReservation,
    });
  }
  const reservation = reservationSnapshot.reservation;
  const [pendingAction, setPendingAction] = useState<"message" | "cancel" | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    variant: "success" | "error";
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const dismissNotice = useCallback(() => setNotice(null), []);
  const canMessageSeller = existingConversationId
    ? canSendExistingConversation(status)
    : canStartListingConversation(status) &&
      (status !== "reserved" || reservation?.status === "accepted");

  function setLocalReservation(nextReservation: ActiveReservation | null) {
    setReservationSnapshot({
      serverKey: serverReservationKey,
      reservation: nextReservation,
    });
  }

  function openConversation() {
    if (pending) return;
    if (existingConversationId) {
      router.push(`/messages/${existingConversationId}`);
      return;
    }

    setPendingAction("message");
    startTransition(async () => {
      let conversationOpened = false;
      try {
        const result = await startListingConversation(listingId);
        if (result.ok && result.conversationId) {
          conversationOpened = true;
          router.push(`/messages/${result.conversationId}`);
          return;
        }
        setNotice({ message: result.message, variant: "error" });
      } catch (error) {
        unstable_rethrow(error);
        setNotice({
          message: "Unable to open this conversation. Please try again.",
          variant: "error",
        });
      } finally {
        setPendingAction(null);
        if (!conversationOpened) router.refresh();
      }
    });
  }

  function cancelPendingRequest() {
    if (pending) return;
    if (!reservation || reservation.status !== "pending") return;
    if (!window.confirm("Cancel this reservation request?")) return;

    const reservationId = reservation.id;
    setPendingAction("cancel");
    startTransition(async () => {
      try {
        const result = await cancelReservation(reservationId);
        setNotice({
          message: result.message,
          variant: result.ok ? "success" : "error",
        });
        if (result.ok) setLocalReservation(null);
      } catch (error) {
        unstable_rethrow(error);
        setNotice({
          message:
            "Unable to confirm whether your request was cancelled. Refresh and try again.",
          variant: "error",
        });
      } finally {
        setPendingAction(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <section aria-label="Listing actions" className="mt-8 space-y-3">
        {reservation ? (
          <div className="rounded-xl border border-[#d9e3f7] bg-[#f7f9ff] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-[#002576]">
                {reservation.status === "accepted"
                  ? "Reserved for you"
                  : "Reservation request pending"}
              </p>
              <ReservationStatusBadge status={reservation.status} />
            </div>
            <p className="mt-1 text-sm leading-6 text-[#444653]">
              {reservation.status === "accepted"
                ? "Arrange a safe campus meetup with the seller from your reservation page."
                : "The seller can accept or decline your request. No payment has been made."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/reservations/${reservation.id}`}
                className="inline-flex min-h-10 items-center rounded-md bg-[#0038a8] px-4 text-sm font-semibold text-white hover:bg-[#002576]"
              >
                View Reservation
              </Link>
              {reservation.status === "pending" && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={cancelPendingRequest}
                  className="min-h-10 rounded-md px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
                >
                  {pendingAction === "cancel" ? "Cancelling..." : "Cancel Request"}
                </button>
              )}
            </div>
          </div>
        ) : status === "reserved" ? (
          <div className="rounded-xl border border-[#c4c5d5] bg-[#f2f3f8] px-4 py-3 text-sm leading-6 text-[#444653]">
            This item is reserved for another buyer.
          </div>
        ) : status === "sold" || status === "removed" ? (
          <div className="rounded-xl border border-[#c4c5d5] bg-[#f2f3f8] px-4 py-3 text-sm text-[#444653]">
            This item is no longer available for reservation.
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {canMessageSeller && (
            <button
              type="button"
              disabled={pending}
              onClick={openConversation}
              className="min-h-12 rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576] disabled:cursor-wait disabled:opacity-60"
            >
              {pendingAction === "message" ? "Opening..." : "Message Seller"}
            </button>
          )}
          {status === "available" && !reservation && (
            <RequestReservationDialog
              listingId={listingId}
              title={title}
              price={price}
              sellerName={sellerName}
              sellerIsVerified={sellerIsVerified}
              imageUrl={imageUrl}
              onRequested={setLocalReservation}
              onNotice={(message, variant) => setNotice({ message, variant })}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {(initialIsFavorited || canFavoriteListing(status)) && (
            <FavoriteButton
              listingId={listingId}
              title={title}
              initialIsFavorited={initialIsFavorited}
              onFavoriteChange={(_, isFavorited) => {
                if (!isFavorited && status === "sold") {
                  router.push("/favorites");
                }
              }}
            />
          )}
          {canReportListing(status) && <ReportListingDialog listingId={listingId} />}
        </div>
      </section>

      <ActionNotice
        message={notice?.message ?? null}
        variant={notice?.variant ?? "success"}
        onDismiss={dismissNotice}
      />
    </>
  );
}
