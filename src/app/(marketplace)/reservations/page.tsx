import type { Metadata } from "next";
import Link from "next/link";

import { ReservationSummaryCard } from "@/features/reservations/components/reservation-summary-card";
import {
  isReservationStatus,
  RESERVATION_STATUSES,
} from "@/features/reservations/rules";
import { getReservations } from "@/features/reservations/server/queries";
import type { ReservationStatus } from "@/features/reservations/types";

export const metadata: Metadata = {
  title: "Reservations | UC Marketplace",
  description: "Manage UC Marketplace reservation requests and campus meetups.",
};

type ReservationView = "buying" | "selling";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function statusHref(
  view: ReservationView,
  status: ReservationStatus | null,
  listingId: string | null,
) {
  const query = new URLSearchParams({ view });
  if (status) query.set("status", status);
  if (listingId) query.set("listing", listingId);
  return `/reservations?${query.toString()}`;
}

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[];
    status?: string | string[];
    listing?: string | string[];
  }>;
}) {
  const [{ reservations, error }, query] = await Promise.all([
    getReservations(),
    searchParams,
  ]);
  const requestedView = firstValue(query.view);
  const view: ReservationView =
    requestedView === "selling" || requestedView === "incoming"
      ? "selling"
      : "buying";
  const requestedStatus = firstValue(query.status);
  const selectedStatus =
    requestedStatus && isReservationStatus(requestedStatus)
      ? requestedStatus
      : null;
  const listingFilter = firstValue(query.listing) ?? null;
  const buying = reservations.filter(
    (reservation) => reservation.viewerRole === "buyer",
  );
  const selling = reservations.filter(
    (reservation) => reservation.viewerRole === "seller",
  );
  const roleReservations = view === "buying" ? buying : selling;
  const listingReservations = listingFilter
    ? roleReservations.filter(
        (reservation) => reservation.listing.id === listingFilter,
      )
    : roleReservations;
  const visible = selectedStatus
    ? listingReservations.filter(
        (reservation) => reservation.status === selectedStatus,
      )
    : listingReservations;

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-10 text-[#121c2a] sm:px-6 md:pb-12">
      <section className="mx-auto w-full max-w-4xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#002576] sm:text-4xl">
              Reservations
            </h1>
            <p className="mt-2 text-base text-[#444653]">
              Manage requests, campus meetups, and completed exchanges.
            </p>
          </div>
          <Link
            href="/marketplace"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8] hover:bg-[#e9effb]"
          >
            Browse Marketplace
          </Link>
        </div>

        {!error && (
          <>
            <nav aria-label="Reservation role" className="mt-7 flex border-b border-[#c4c5d5]">
              <Link
                href="/reservations?view=buying"
                aria-current={view === "buying" ? "page" : undefined}
                className={`flex-1 border-b-2 px-4 py-3 text-center text-sm font-semibold ${view === "buying" ? "border-[#0038a8] text-[#0038a8]" : "border-transparent text-[#444653] hover:text-[#0038a8]"}`}
              >
                Buying ({buying.length})
              </Link>
              <Link
                href="/reservations?view=selling"
                aria-current={view === "selling" ? "page" : undefined}
                className={`flex-1 border-b-2 px-4 py-3 text-center text-sm font-semibold ${view === "selling" ? "border-[#0038a8] text-[#0038a8]" : "border-transparent text-[#444653] hover:text-[#0038a8]"}`}
              >
                Selling ({selling.length})
              </Link>
            </nav>

            {listingFilter && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d9e3f7] bg-[#f7f9ff] px-4 py-3 text-sm">
                <span>Showing reservations for one listing.</span>
                <Link
                  href={statusHref(view, selectedStatus, null)}
                  className="font-semibold text-[#0038a8] hover:underline"
                >
                  Clear listing filter
                </Link>
              </div>
            )}

            {roleReservations.length > 0 && (
              <nav aria-label="Filter by reservation status" className="mt-5 overflow-x-auto pb-1">
                <ul className="flex min-w-max gap-2">
                  <li>
                    <Link
                      href={statusHref(view, null, listingFilter)}
                      aria-current={!selectedStatus ? "page" : undefined}
                      className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${!selectedStatus ? "border-[#0038a8] bg-[#0038a8] text-white" : "border-[#c4c5d5] bg-white text-[#444653] hover:bg-[#e9effb]"}`}
                    >
                      All ({listingReservations.length})
                    </Link>
                  </li>
                  {RESERVATION_STATUSES.map((status) => {
                    const count = listingReservations.filter(
                      (reservation) => reservation.status === status,
                    ).length;
                    if (count === 0) return null;
                    return (
                      <li key={status}>
                        <Link
                          href={statusHref(view, status, listingFilter)}
                          aria-current={selectedStatus === status ? "page" : undefined}
                          className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold capitalize ${selectedStatus === status ? "border-[#0038a8] bg-[#0038a8] text-white" : "border-[#c4c5d5] bg-white text-[#444653] hover:bg-[#e9effb]"}`}
                        >
                          {status} ({count})
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            )}
          </>
        )}

        {error ? (
          <div className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-bold">Reservations temporarily unavailable</h2>
            <p className="mt-2 text-sm leading-6 text-[#444653]">
              Your requests are still safe. Please try loading them again.
            </p>
            <Link
              href="/reservations"
              className="mt-5 inline-flex min-h-11 items-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8]"
            >
              Try Again
            </Link>
          </div>
        ) : visible.length > 0 ? (
          <div className="mt-8 space-y-5">
            {visible.map((reservation) => (
              <ReservationSummaryCard
                key={reservation.id}
                reservation={reservation}
              />
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-bold">
              {selectedStatus
                ? `No ${selectedStatus} reservations`
                : `No ${view} reservations`}
            </h2>
            <p className="mt-2 text-sm text-[#444653]">
              {view === "selling"
                ? "Buyer requests for your listings will appear here."
                : "Request an available item to track it here."}
            </p>
            {view === "buying" && (
              <Link
                href="/marketplace"
                className="mt-5 inline-flex min-h-11 items-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white"
              >
                Browse Marketplace
              </Link>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
