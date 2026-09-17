import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { MobileNavigation } from "@/components/mobile-navigation";
import { ReservationCard, type MockReservation } from "@/components/reservation-card";

export const metadata: Metadata = {
  title: "Reservations | UC Marketplace",
  description: "Manage upcoming UC Marketplace meetups.",
};

const reservations: MockReservation[] = [
  {
    id: 1,
    title: "TI-84 Plus CE Calculator",
    buyer: "Sarah J.",
    location: "UC Main - Library Lobby",
    time: "Today, 2:30 PM",
    status: "Pending",
    image: "/assets/app/reservation-calculator.png",
    imageAlt: "A TI-84 Plus CE calculator",
  },
  {
    id: 2,
    title: "Intro to Psychology 4th Ed.",
    buyer: "Michael T.",
    location: "Student Union - Cafe",
    time: "Tomorrow, 10:00 AM",
    status: "Confirmed",
    image: "/assets/app/reservation-books.png",
    imageAlt: "A stack of psychology textbooks",
  },
];

export default function ReservationsPage() {
  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      <AppHeader />

      <main className="mx-auto w-full max-w-7xl px-6 pb-28 pt-10 md:pb-12">
        <header>
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#002576] sm:text-4xl">
            Reservations
          </h1>
          <p className="mt-2 max-w-sm text-lg leading-7 text-[#444653]">
            Manage your upcoming campus meetups.
          </p>
        </header>

        <div role="tablist" aria-label="Reservation type" className="mt-8 flex max-w-md border-b border-[#c4c5d5]">
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="flex-1 border-b-2 border-[#0038a8] px-4 py-3 text-center text-lg font-semibold leading-6 text-[#0038a8]"
          >
            Incoming<br />(Seller)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            className="flex-1 px-4 py-3 text-center text-lg font-semibold leading-6 text-[#444653]"
          >
            Outgoing<br />(Buyer)
          </button>
        </div>

        <section aria-label="Incoming reservations" className="mt-8 grid gap-4 md:grid-cols-2">
          {reservations.map((reservation) => (
            <ReservationCard key={reservation.id} reservation={reservation} />
          ))}
        </section>
      </main>

      <MobileNavigation active="profile" />
    </div>
  );
}
