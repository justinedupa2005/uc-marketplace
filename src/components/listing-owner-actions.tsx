"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";

import { changeOwnedListingStatus } from "@/app/(marketplace)/listing/actions";
import { ActionNotice } from "@/components/action-notice";
import {
  canOwnerEditListing,
  canOwnerMarkListingSold,
  canOwnerRemoveListing,
  type ListingStatus,
} from "@/lib/listing-rules";

export function ListingOwnerActions({
  listingId,
  status,
  compact = false,
}: {
  listingId: string;
  status: ListingStatus;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{
    message: string;
    variant: "success" | "error";
  } | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);

  function updateStatus(target: "sold" | "removed") {
    const confirmed = window.confirm(
      target === "sold"
        ? "Mark this listing as sold? Buyers will no longer be able to reserve it."
        : "Remove this listing? It will disappear from marketplace browsing but remain in your history.",
    );
    if (!confirmed) return;

    startTransition(async () => {
      const result = await changeOwnedListingStatus(listingId, target);
      setNotice({
        message: result.message,
        variant: result.ok ? "success" : "error",
      });
    });
  }

  const baseClass = compact
    ? "min-h-9 px-3 text-xs"
    : "min-h-11 px-4 text-sm";

  return (
    <>
      <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-8"}`}>
        {canOwnerEditListing(status) && (
          <Link
            href={`/listing/${listingId}/edit`}
            className={`inline-flex items-center justify-center rounded-md bg-[#0038a8] font-semibold text-white hover:bg-[#002576] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8] ${baseClass}`}
          >
            Edit
          </Link>
        )}
        {canOwnerMarkListingSold(status) && (
          <button
            type="button"
            disabled={pending}
            onClick={() => updateStatus("sold")}
            className={`rounded-md border border-[#0038a8] font-semibold text-[#0038a8] hover:bg-[#e9effb] disabled:cursor-wait disabled:opacity-60 ${baseClass}`}
          >
            {pending ? "Updating…" : "Mark Sold"}
          </button>
        )}
        {canOwnerRemoveListing(status) && (
          <button
            type="button"
            disabled={pending}
            onClick={() => updateStatus("removed")}
            className={`rounded-md border border-red-300 font-semibold text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60 ${baseClass}`}
          >
            Remove
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
