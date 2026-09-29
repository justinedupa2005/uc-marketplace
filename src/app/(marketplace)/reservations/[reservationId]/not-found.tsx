import Link from "next/link";

export default function ReservationNotFound() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[#f9f9ff] px-6 pb-28 md:pb-12">
      <section className="w-full max-w-lg rounded-2xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-[#0038a8]">
          Reservation unavailable
        </p>
        <h1 className="mt-2 text-2xl font-bold">This reservation could not be found</h1>
        <p className="mt-3 text-sm leading-6 text-[#444653]">
          The link may be invalid, the reservation may no longer exist, or you
          may not be one of its participants.
        </p>
        <Link
          href="/reservations"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576]"
        >
          Back to Reservations
        </Link>
      </section>
    </main>
  );
}
