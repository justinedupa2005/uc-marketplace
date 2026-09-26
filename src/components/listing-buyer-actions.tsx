"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import {
  requestListingReservation,
  startListingConversation,
} from "@/app/(marketplace)/listing/actions";
import { ActionNotice } from "@/components/action-notice";
import { FavoriteButton } from "@/components/favorite-button";
import { ReportListingDialog } from "@/components/report-listing-dialog";
import {
  canFavoriteListing,
  canReportListing,
  canRequestListingReservation,
  canStartListingConversation,
  type ListingStatus,
} from "@/lib/listing-rules";

export function ListingBuyerActions({
  listingId,
  title,
  status,
  initialIsFavorited,
  activeReservation,
  existingConversationId,
}: {
  listingId: string;
  title: string;
  status: ListingStatus;
  initialIsFavorited: boolean;
  activeReservation: { id: string; status: string } | null;
  existingConversationId: string | null;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<"message" | "reserve" | null>(null);
  const [hasReservation, setHasReservation] = useState(Boolean(activeReservation));
  const [notice, setNotice] = useState<{
    message: string;
    variant: "success" | "error";
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const dismissNotice = useCallback(() => setNotice(null), []);

  function openConversation() {
    if (existingConversationId) {
      router.push(`/messages/${existingConversationId}`);
      return;
    }

    setPendingAction("message");
    startTransition(async () => {
      const result = await startListingConversation(listingId);
      if (result.ok && result.conversationId) {
        router.push(`/messages/${result.conversationId}`);
        return;
      }
      setPendingAction(null);
      setNotice({ message: result.message, variant: "error" });
    });
  }

  function requestReservation() {
    setPendingAction("reserve");
    startTransition(async () => {
      const result = await requestListingReservation(listingId);
      setPendingAction(null);
      if (result.ok) setHasReservation(true);
      setNotice({
        message: result.message,
        variant: result.ok ? "success" : "error",
      });
    });
  }

  return (
    <>
      <section aria-label="Listing actions" className="mt-8 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {canStartListingConversation(status) && (
            <button
              type="button"
              disabled={pending}
              onClick={openConversation}
              className="min-h-12 rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576] disabled:cursor-wait disabled:opacity-60"
            >
              {pendingAction === "message" ? "Opening…" : "Message Seller"}
            </button>
          )}
          {canRequestListingReservation(status) && (
            <button
              type="button"
              disabled={pending || hasReservation}
              onClick={requestReservation}
              className="min-h-12 rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8] hover:bg-[#e9effb] disabled:cursor-wait disabled:opacity-60"
            >
              {hasReservation
                ? "Reservation Requested"
                : pendingAction === "reserve"
                  ? "Requesting…"
                  : "Request Reservation"}
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {canFavoriteListing(status) && (
            <FavoriteButton
              listingId={listingId}
              title={title}
              initialIsFavorited={initialIsFavorited}
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
