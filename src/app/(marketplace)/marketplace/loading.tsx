import { MarketplaceSkeleton } from "@/components/marketplace-skeleton";

export default function MarketplaceLoading() {
  return (
    <main
      className="mx-auto min-h-screen w-full max-w-[1200px] bg-[#f9f9ff] px-6 py-4 pb-24 text-[#121c2a] md:pb-10"
      aria-busy="true"
      aria-label="Loading marketplace listings"
    >
      <p className="sr-only" role="status">
        Loading marketplace listings…
      </p>

      <div className="h-[57px] animate-pulse rounded-lg border border-[#d9dbe5] bg-white" />
      <div className="mt-4 flex gap-2 overflow-hidden py-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-[34px] w-24 shrink-0 animate-pulse rounded-full bg-[#e4e8f2]"
          />
        ))}
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="hidden h-80 animate-pulse rounded-xl border border-[#d9dbe5] bg-white lg:block" />
        <section aria-hidden="true">
          <div className="mb-4 flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-6 w-48 animate-pulse rounded bg-[#e4e8f2]" />
              <div className="h-3 w-24 animate-pulse rounded bg-[#e4e8f2]" />
            </div>
            <div className="h-10 w-32 animate-pulse rounded-md bg-[#e4e8f2]" />
          </div>

          <MarketplaceSkeleton cardCount={8} />
        </section>
      </div>
    </main>
  );
}
