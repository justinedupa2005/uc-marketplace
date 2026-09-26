"use client";

import { useCallback, useState, useTransition } from "react";

import { toggleListingFavorite } from "@/app/(marketplace)/listing/actions";
import { ActionNotice } from "@/components/action-notice";

export function FavoriteButton({
  listingId,
  title,
  initialIsFavorited,
  compact = false,
}: {
  listingId: string;
  title: string;
  initialIsFavorited: boolean;
  compact?: boolean;
}) {
  const [isFavorited, setIsFavorited] = useState(initialIsFavorited);
  const [notice, setNotice] = useState<{
    message: string;
    variant: "success" | "error";
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const dismissNotice = useCallback(() => setNotice(null), []);

  function toggleFavorite() {
    if (pending) return;

    startTransition(async () => {
      const result = await toggleListingFavorite(listingId);

      if (result.ok && typeof result.isFavorited === "boolean") {
        setIsFavorited(result.isFavorited);
      }

      setNotice({
        message: result.message,
        variant: result.ok ? "success" : "error",
      });
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={toggleFavorite}
        aria-pressed={isFavorited}
        aria-label={`${isFavorited ? "Remove" : "Save"} ${title} ${
          isFavorited ? "from" : "to"
        } favorites`}
        className={`inline-flex items-center justify-center gap-2 rounded-md border border-[#c4c5d5] bg-white font-semibold text-[#002576] transition hover:bg-[#e9effb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8] disabled:cursor-wait disabled:opacity-60 ${
          compact ? "size-9 rounded-full p-2" : "min-h-11 px-4 text-sm"
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill={isFavorited ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
        </svg>
        {!compact && (isFavorited ? "Saved" : "Save")}
        {pending && <span className="sr-only">Updating</span>}
      </button>

      <ActionNotice
        message={notice?.message ?? null}
        variant={notice?.variant ?? "success"}
        onDismiss={dismissNotice}
      />
    </>
  );
}
