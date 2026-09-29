"use client";

export default function ReservationDetailsError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[#f9f9ff] px-6 pb-28 md:pb-12">
      <section className="w-full max-w-lg rounded-2xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
        <div
          className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-50 text-xl font-bold text-red-700"
          aria-hidden="true"
        >
          !
        </div>
        <h1 className="mt-4 text-2xl font-bold">Unable to load this reservation</h1>
        <p className="mt-3 text-sm leading-6 text-[#444653]">
          Your reservation and meetup details are still safe. Please try again.
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576]"
        >
          Try Again
        </button>
      </section>
    </main>
  );
}
