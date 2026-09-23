"use client";

export default function MarketplaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[#f9f9ff] px-5 py-10 text-[#121c2a]">
      <section className="w-full max-w-md rounded-2xl border border-[#c4c5d5]/70 bg-white p-6 text-center shadow-[0_16px_50px_rgba(0,37,118,0.08)] sm:p-9">
        <div
          className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#fff0f0] text-xl font-bold text-[#ba1a1a]"
          aria-hidden="true"
        >
          !
        </div>
        <h1 className="mt-5 text-2xl font-bold">Something went wrong</h1>
        <p className="mt-3 text-sm leading-6 text-[#444653]">
          We couldn&apos;t load this page. No changes were made. Please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-7 inline-flex h-12 w-full items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#002576]"
        >
          Try Again
        </button>
      </section>
    </main>
  );
}
