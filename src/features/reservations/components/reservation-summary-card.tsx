import Image from "next/image";
import Link from "next/link";

import { VerificationBadge } from "@/features/listings/components/seller-card";
import { ReservationActionPanel } from "@/features/reservations/components/reservation-action-panel";
import {
  MeetupStatusBadge,
  ReservationStatusBadge,
} from "@/features/reservations/components/reservation-status-badge";
import type { ReservationSummary } from "@/features/reservations/types";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function ReservationSummaryCard({
  reservation,
}: {
  reservation: ReservationSummary;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-[#c4c5d5] bg-white shadow-sm">
      <div className="grid sm:grid-cols-[160px_minmax(0,1fr)]">
        <div className="relative min-h-44 bg-[#eff3ff] sm:min-h-full">
          {reservation.listing.imageUrl ? (
            <Image
              src={reservation.listing.imageUrl}
              alt={reservation.listing.title}
              fill
              unoptimized
              sizes="(max-width: 639px) 100vw, 160px"
              className="object-cover"
            />
          ) : (
            <div className="flex size-full min-h-44 items-center justify-center text-sm text-[#747685]">
              No image available
            </div>
          )}
        </div>

        <div className="min-w-0 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#747685]">
                {reservation.viewerRole === "seller" ? "Selling" : "Buying"}
              </p>
              {reservation.listing.canView ? (
                <Link
                  href={`/listing/${reservation.listing.id}`}
                  className="mt-1 block line-clamp-2 text-lg font-bold hover:text-[#0038a8] hover:underline"
                >
                  {reservation.listing.title}
                </Link>
              ) : (
                <h2 className="mt-1 line-clamp-2 text-lg font-bold">
                  {reservation.listing.title}
                </h2>
              )}
            </div>
            <ReservationStatusBadge status={reservation.status} />
          </div>

          <p className="mt-2 text-lg font-bold text-[#002576]">
            {reservation.listing.price}
          </p>

          <div className="mt-4 flex items-center gap-3">
            <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e6eeff] text-xs font-bold text-[#002576]">
              {reservation.otherStudent.avatarUrl ? (
                <Image
                  src={reservation.otherStudent.avatarUrl}
                  alt=""
                  fill
                  unoptimized
                  sizes="36px"
                  className="object-cover"
                />
              ) : (
                <span aria-hidden="true">
                  {initials(reservation.otherStudent.name) || "UC"}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {reservation.viewerRole === "seller" ? "Buyer" : "Seller"}: {reservation.otherStudent.name}
              </p>
              {reservation.otherStudent.isVerified && (
                <div className="mt-1.5">
                  <VerificationBadge />
                </div>
              )}
              <time dateTime={reservation.createdAt} className="mt-1 block text-xs text-[#747685]">
                Requested {formatDate(reservation.createdAt)}
              </time>
            </div>
          </div>

          {reservation.message && (
            <p className="mt-4 line-clamp-2 rounded-lg bg-[#f7f8fc] px-3 py-2 text-sm leading-6 text-[#444653]">
              &ldquo;{reservation.message}&rdquo;
            </p>
          )}

          {reservation.meetup && (
            <div
              className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
                reservation.meetup.status === "cancelled"
                  ? "border-slate-200 bg-slate-50 text-slate-700"
                  : reservation.meetup.status === "completed"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-violet-200 bg-violet-50 text-violet-900"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {reservation.meetup.status === "cancelled"
                    ? "Meetup cancelled"
                    : reservation.meetup.status === "completed"
                      ? "Meetup completed"
                      : reservation.meetup.status === "proposed"
                        ? "Meetup proposed"
                        : "Meetup scheduled"}
                </span>
                <MeetupStatusBadge status={reservation.meetup.status} />
              </div>
              <p className="mt-1">
                {formatDate(reservation.meetup.scheduledAt)} at {reservation.meetup.locationName}
              </p>
            </div>
          )}

          <div className="mt-5 border-t border-[#e1e2ea] pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link
                href={`/reservations/${reservation.id}`}
                className="inline-flex min-h-9 items-center rounded-md text-sm font-semibold text-[#0038a8] hover:underline"
              >
                View Details
              </Link>
              <ReservationActionPanel
                reservationId={reservation.id}
                role={reservation.viewerRole}
                status={reservation.status}
                listingStatus={reservation.listing.status}
                meetup={reservation.meetup}
                conversationId={reservation.conversationId}
                listingTitle={reservation.listing.title}
                participantName={reservation.otherStudent.name}
                compact
              />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
