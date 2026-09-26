import Image from "next/image";
import Link from "next/link";

import {
  buildMarketplaceHref,
  type MarketplaceSort,
  type MarketplaceUrlValues,
} from "@/lib/marketplace-search-params";

const sortOptions: Array<{ value: MarketplaceSort; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Lowest Price" },
  { value: "price-desc", label: "Highest Price" },
];

export function FilterBar({
  values,
  totalCount,
}: {
  values: MarketplaceUrlValues;
  totalCount: number;
}) {
  const currentSort =
    sortOptions.find((option) => option.value === values.sort)?.label ?? "Newest";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <div>
        <h2 className="text-lg font-semibold leading-7 text-[#121c2a]">
          Marketplace Listings
        </h2>
        <p className="text-xs text-[#747685]" aria-live="polite">
          {totalCount.toLocaleString("en-PH")} {totalCount === 1 ? "listing" : "listings"} found
        </p>
      </div>
      <details className="relative">
        <summary
          aria-label={`Sort listings. Current selection: ${currentSort}`}
          className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md border border-[#c4c5d5] bg-white px-3 text-sm font-semibold text-[#121c2a] hover:bg-[#edf2ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
        >
          <Image src="/assets/marketplace/filter.svg" alt="" width={14} height={9} aria-hidden="true" />
          <span className="hidden sm:inline">Sort:</span> {currentSort}
        </summary>
        <div className="absolute right-0 z-20 mt-1 min-w-48 overflow-hidden rounded-lg border border-[#c4c5d5] bg-white py-1 shadow-lg">
          {sortOptions.map((option) => (
            <Link
              key={option.value}
              href={buildMarketplaceHref(values, {
                sort: option.value,
              })}
              aria-current={option.value === values.sort ? "true" : undefined}
              className={`block min-h-11 px-4 py-3 text-sm hover:bg-[#edf2ff] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0038a8] ${
                option.value === values.sort
                  ? "font-bold text-[#0038a8]"
                  : "text-[#444653]"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </details>
    </div>
  );
}
