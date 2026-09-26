import type { Metadata } from "next";
import Link from "next/link";

import { ReservationSummaryCard } from "@/components/reservation-summary-card";
import { getReservations } from "@/lib/marketplace-interactions";

export const metadata: Metadata = {
  title: "Reservations | UC Marketplace",
  description: "Manage UC Marketplace reservation requests.",
};

export default async function ReservationsPage({ searchParams }: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [{ reservations, error }, query] = await Promise.all([getReservations(), searchParams]);
  const view = query.view === "outgoing" ? "outgoing" : "incoming";
  const incoming = reservations.filter((reservation) => reservation.isIncoming);
  const outgoing = reservations.filter((reservation) => !reservation.isIncoming);
  const visible = view === "incoming" ? incoming : outgoing;

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-10 text-[#121c2a] sm:px-6 md:pb-12">
      <section className="mx-auto w-full max-w-[1100px]">
        <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#002576] sm:text-4xl">Reservations</h1>
        <p className="mt-2 text-base text-[#444653]">Manage reservation requests for campus exchanges.</p>

        {!error && (
          <nav aria-label="Reservation type" className="mt-7 flex max-w-md border-b border-[#c4c5d5]">
            <Link href="/reservations" aria-current={view === "incoming" ? "page" : undefined} className={`flex-1 border-b-2 px-4 py-3 text-center text-sm font-semibold ${view === "incoming" ? "border-[#0038a8] text-[#0038a8]" : "border-transparent text-[#444653]"}`}>Incoming ({incoming.length})</Link>
            <Link href="/reservations?view=outgoing" aria-current={view === "outgoing" ? "page" : undefined} className={`flex-1 border-b-2 px-4 py-3 text-center text-sm font-semibold ${view === "outgoing" ? "border-[#0038a8] text-[#0038a8]" : "border-transparent text-[#444653]"}`}>Outgoing ({outgoing.length})</Link>
          </nav>
        )}

        {error ? (
          <div className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-bold">Reservations temporarily unavailable</h2>
            <Link href="/reservations" className="mt-5 inline-flex min-h-11 items-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8]">Try Again</Link>
          </div>
        ) : visible.length > 0 ? (
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {visible.map((reservation) => <ReservationSummaryCard key={reservation.id} reservation={reservation} />)}
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-bold">No {view} reservations</h2>
            <p className="mt-2 text-sm text-[#444653]">{view === "incoming" ? "New buyer requests will appear here." : "Request an available item to track it here."}</p>
            {view === "outgoing" && <Link href="/marketplace" className="mt-5 inline-flex min-h-11 items-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white">Browse Marketplace</Link>}
          </div>
        )}
      </section>
    </main>
  );
}
