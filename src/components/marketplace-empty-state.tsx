import Link from "next/link";

export function MarketplaceEmptyState({
  search,
  hasFilters,
}: {
  search?: string;
  hasFilters: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[#c4c5d5] bg-white px-6 py-12 text-center text-[#444653]">
      <h2 className="text-lg font-bold text-[#121c2a]">No matching listings</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6">
        {search
          ? `No listings were found for \u201c${search}\u201d. Try another search or adjust your filters.`
          : hasFilters
            ? "No listings match your current filters. Try adjusting or clearing them."
            : "There are no active marketplace listings yet. You can be the first to list an item."}
      </p>
      <Link
        href={hasFilters ? "/marketplace" : "/sell"}
        className="mt-5 inline-flex min-h-11 items-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8] hover:bg-[#edf2ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
      >
        {hasFilters ? "Clear All Filters" : "Sell an Item"}
      </Link>
    </div>
  );
}
