import { MarketplaceSkeleton } from "@/features/listings/components/marketplace-skeleton";

export default function PublicProfileLoading() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-8 sm:px-6 md:pb-12">
      <div className="mx-auto w-full max-w-[1200px]">
        <section aria-label="Loading student profile" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading student profile.</span>
          <div aria-hidden="true" className="mb-6 h-11 w-40 animate-pulse rounded-md bg-[#e1e2ea]" />
          <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-[#c4c5d5] bg-white shadow-sm">
            <div className="h-24 bg-[#e6eeff]" />
            <div className="-mt-12 flex animate-pulse flex-col items-center gap-5 px-6 pb-7 sm:flex-row sm:items-end">
              <div className="size-24 shrink-0 rounded-full border-4 border-white bg-[#d9e3f7]" />
              <div className="flex flex-col items-center gap-3 sm:items-start">
                <div className="h-7 w-52 rounded bg-[#e1e2ea]" />
                <div className="h-6 w-32 rounded-full bg-[#e6eeff]" />
                <div className="h-4 w-40 rounded bg-[#e1e2ea]" />
                <div className="h-4 w-36 rounded bg-[#e1e2ea]" />
              </div>
            </div>
          </div>
        </section>
        <div aria-hidden="true" className="mb-4 mt-8 h-7 w-56 animate-pulse rounded bg-[#e1e2ea]" />
        <MarketplaceSkeleton cardCount={8} label="Loading student listings" />
      </div>
    </main>
  );
}
