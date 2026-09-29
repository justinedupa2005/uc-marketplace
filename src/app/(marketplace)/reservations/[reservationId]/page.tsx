import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ListingStatusBadge } from "@/features/listings/components/listing-badges";
import { VerificationBadge } from "@/features/listings/components/seller-card";
import { MeetupCard } from "@/features/reservations/components/meetup-card";
import { ReservationActionPanel } from "@/features/reservations/components/reservation-action-panel";
import { ReservationStatusBadge } from "@/features/reservations/components/reservation-status-badge";
import { getReservationDetails } from "@/features/reservations/server/queries";
import type { ReservationStudent } from "@/features/reservations/types";

export const metadata: Metadata = {
  title: "Reservation Details | UC Marketplace",
  description: "Review a reservation, meetup, and marketplace exchange.",
};

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

function ParticipantCard({
  label,
  student,
  isCurrentUser,
}: {
  label: "Buyer" | "Seller";
  student: ReservationStudent;
  isCurrentUser: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#e1e2ea] bg-[#f9f9ff] p-4">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#747685]">
        {label}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <div className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e6eeff] text-sm font-bold text-[#002576]">
          {student.avatarUrl ? (
            <Image
              src={student.avatarUrl}
              alt=""
              fill
              unoptimized
              sizes="44px"
              className="object-cover"
            />
          ) : (
            <span aria-hidden="true">{initials(student.name) || "UC"}</span>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate font-bold">
            {student.name} {isCurrentUser && <span className="font-normal text-[#747685]">(you)</span>}
          </p>
          {student.isVerified && (
            <div className="mt-1.5">
              <VerificationBadge />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function ReservationDetailsPage({
  params,
}: {
  params: Promise<{ reservationId: string }>;
}) {
  const { reservationId } = await params;
  if (!z.string().uuid().safeParse(reservationId).success) notFound();

  const result = await getReservationDetails(reservationId);
  if (result.error === "not_found") notFound();
  if (result.error || !result.reservation) {
    throw new Error("Unable to load reservation details.");
  }

  const reservation = result.reservation;
  const backHref = `/reservations?view=${reservation.viewerRole === "seller" ? "selling" : "buying"}`;
  const timeline = [
    ["Requested", reservation.createdAt],
    ["Responded", reservation.respondedAt],
    ["Cancelled", reservation.cancelledAt],
    ["Completed", reservation.completedAt],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-6 text-[#121c2a] sm:px-6 md:pb-12 md:pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <Link
          href={backHref}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-[#0038a8] hover:underline"
        >
          <span aria-hidden="true">&larr;</span>
          <span className="ml-2">All {reservation.viewerRole === "seller" ? "selling" : "buying"} reservations</span>
        </Link>

        <header className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.08em] text-[#747685]">
              {reservation.viewerRole === "seller" ? "Selling" : "Buying"}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-[-0.02em] text-[#002576] sm:text-4xl">
              Reservation details
            </h1>
          </div>
          <ReservationStatusBadge status={reservation.status} />
        </header>

        <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)] lg:items-start">
          <div className="space-y-6">
            <section className="overflow-hidden rounded-2xl border border-[#c4c5d5] bg-white shadow-sm">
              <div className="grid sm:grid-cols-[220px_minmax(0,1fr)]">
                <div className="relative min-h-56 bg-[#d9e3f7] sm:min-h-full">
                  {reservation.listing.imageUrl ? (
                    <Image
                      src={reservation.listing.imageUrl}
                      alt={reservation.listing.title}
                      fill
                      unoptimized
                      sizes="(max-width: 639px) 100vw, 220px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex size-full min-h-56 items-center justify-center text-sm text-[#747685]">
                      No image available
                    </div>
                  )}
                </div>
                <div className="p-5 sm:p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <ListingStatusBadge status={reservation.listing.status} />
                  </div>
                  {reservation.listing.canView ? (
                    <Link
                      href={`/listing/${reservation.listing.id}`}
                      className="mt-4 block text-2xl font-bold hover:text-[#0038a8] hover:underline"
                    >
                      {reservation.listing.title}
                    </Link>
                  ) : (
                    <h2 className="mt-4 text-2xl font-bold">
                      {reservation.listing.title}
                    </h2>
                  )}
                  <p className="mt-2 text-2xl font-bold text-[#002576]">
                    {reservation.listing.price}
                  </p>
                  <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
                    UC Marketplace does not collect payment. Inspect the item
                    and agree on payment directly during a safe campus meetup.
                  </p>
                </div>
              </div>
            </section>

            <section
              aria-labelledby="participants-title"
              className="rounded-2xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-6"
            >
              <h2 id="participants-title" className="text-lg font-bold">
                Participants
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <ParticipantCard
                  label="Buyer"
                  student={reservation.buyer}
                  isCurrentUser={reservation.currentUserId === reservation.buyer.id}
                />
                <ParticipantCard
                  label="Seller"
                  student={reservation.seller}
                  isCurrentUser={reservation.currentUserId === reservation.seller.id}
                />
              </div>
            </section>

            <section
              aria-labelledby="request-title"
              className="rounded-2xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-6"
            >
              <h2 id="request-title" className="text-lg font-bold">
                Reservation request
              </h2>
              {reservation.message ? (
                <p className="mt-4 whitespace-pre-wrap rounded-xl bg-[#f7f8fc] px-4 py-3 text-sm leading-6 text-[#444653]">
                  {reservation.message}
                </p>
              ) : (
                <p className="mt-3 text-sm text-[#747685]">
                  No message was included with this request.
                </p>
              )}
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                {timeline.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[#747685]">{label}</dt>
                    <dd className="mt-1 font-semibold">
                      <time dateTime={value}>{formatDate(value)}</time>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24">
            <section className="rounded-2xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-bold">Next steps</h2>
              <p className="mt-2 text-sm leading-6 text-[#444653]">
                {reservation.status === "pending"
                  ? reservation.viewerRole === "seller"
                    ? "Review the buyer's request. Accepting it reserves the item and declines competing requests."
                    : "Wait for the seller's response, or cancel if your plans change."
                  : reservation.status === "accepted"
                    ? "Coordinate a public campus meetup. The seller marks the sale complete after the exchange."
                    : reservation.status === "completed"
                      ? "This exchange is complete. The listing and meetup history are preserved here."
                      : "This reservation is closed. Its history remains available to both participants."}
              </p>
              {reservation.viewerRole === "seller" &&
                reservation.status === "pending" &&
                reservation.pendingRequestCount > 1 && (
                  <p className="mt-3 text-sm font-semibold text-amber-800">
                    {reservation.pendingRequestCount} pending requests exist for this listing.
                  </p>
                )}
              <div className="mt-5">
                <ReservationActionPanel
                  reservationId={reservation.id}
                  role={reservation.viewerRole}
                  status={reservation.status}
                  listingStatus={reservation.listing.status}
                  meetup={reservation.meetup}
                  conversationId={reservation.conversationId}
                  listingTitle={reservation.listing.title}
                  participantName={reservation.otherStudent.name}
                />
              </div>
            </section>

            {reservation.meetup ? (
              <MeetupCard meetup={reservation.meetup} />
            ) : reservation.status === "accepted" ? (
              <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-950">
                <h2 className="font-bold">Meet safely on campus</h2>
                <p className="mt-2">
                  Choose a public, staffed location. Neither participant needs
                  to share a home address.
                </p>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}
