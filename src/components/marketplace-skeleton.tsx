export function MarketplaceSkeleton({ cardCount = 8 }: { cardCount?: number }) {
  return (
    <section aria-label="Loading marketplace listings" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading marketplace listings.</span>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: cardCount }, (_, index) => (
          <div
            key={index}
            aria-hidden="true"
            className="animate-pulse overflow-hidden rounded-2xl border border-[#e1e2ea] bg-white"
          >
            <div className="aspect-square bg-[#d9e3f7] sm:aspect-[4/3]" />
            <div className="space-y-3 p-4">
              <div className="h-4 w-4/5 rounded bg-[#e1e2ea]" />
              <div className="h-4 w-3/5 rounded bg-[#e1e2ea]" />
              <div className="h-6 w-2/5 rounded bg-[#d9e3f7]" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
