"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useState, useTransition } from "react";

import { cancelReservation, respondToReservation } from "@/app/(marketplace)/listing/actions";
import { ActionNotice } from "@/components/action-notice";
import type { ReservationSummary } from "@/lib/marketplace-interactions";

const statusClasses: Record<ReservationSummary["status"], string> = {
  pending: "bg-amber-100 text-amber-900",
  accepted: "bg-blue-100 text-blue-900",
  rejected: "bg-red-50 text-red-800",
  cancelled: "bg-slate-100 text-slate-700",
  completed: "bg-emerald-100 text-emerald-900",
};

export function ReservationSummaryCard({ reservation }: { reservation: ReservationSummary }) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ message: string; variant: "success" | "error" } | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);

  function respond(decision: "accepted" | "rejected") {
    if (decision === "accepted" && !window.confirm("Accept this reservation request and mark the listing reserved?")) return;
    startTransition(async () => {
      const result = await respondToReservation(reservation.id, decision);
      setNotice({ message: result.message, variant: result.ok ? "success" : "error" });
    });
  }

  function cancel() {
    if (!window.confirm("Cancel this reservation request?")) return;
    startTransition(async () => {
      const result = await cancelReservation(reservation.id);
      setNotice({ message: result.message, variant: result.ok ? "success" : "error" });
    });
  }

  return (
    <>
      <article className="overflow-hidden rounded-2xl border border-[#c4c5d5] bg-white shadow-sm">
        <div className="relative h-44 bg-[#eff3ff]">
          {reservation.imageUrl ? (
            <Image src={reservation.imageUrl} alt={reservation.listingTitle} fill unoptimized sizes="(max-width: 767px) 100vw, 50vw" className="object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-sm text-[#747685]">No image available</div>
          )}
          <span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs font-bold capitalize ${statusClasses[reservation.status]}`}>{reservation.status}</span>
        </div>
        <div className="p-5">
          {reservation.canViewListing ? (
            <Link href={`/listing/${reservation.listingId}`} className="line-clamp-2 text-lg font-bold hover:text-[#0038a8] hover:underline">{reservation.listingTitle}</Link>
          ) : (
            <h2 className="line-clamp-2 text-lg font-bold">{reservation.listingTitle}</h2>
          )}
          <p className="mt-2 text-sm text-[#444653]">{reservation.isIncoming ? "Buyer" : "Seller"}: {reservation.otherStudentName}</p>
          <time dateTime={reservation.createdAt} className="mt-1 block text-xs text-[#747685]">Requested {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(reservation.createdAt))}</time>

          {reservation.isIncoming && reservation.status === "pending" && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" disabled={pending} onClick={() => respond("accepted")} className="min-h-10 rounded-md bg-[#0038a8] px-3 text-sm font-semibold text-white disabled:opacity-60">Accept</button>
              <button type="button" disabled={pending} onClick={() => respond("rejected")} className="min-h-10 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-60">Decline</button>
            </div>
          )}
          {!reservation.isIncoming && ["pending", "accepted"].includes(reservation.status) && (
            <button type="button" disabled={pending} onClick={cancel} className="mt-4 min-h-10 w-full rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-60">Cancel Request</button>
          )}
        </div>
      </article>
      <ActionNotice message={notice?.message ?? null} variant={notice?.variant ?? "success"} onDismiss={dismissNotice} />
    </>
  );
}
