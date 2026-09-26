import Image from "next/image";
import Link from "next/link";

import type { MarketplaceSort } from "@/lib/listings";

const sortOptions: Array<{ value: MarketplaceSort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

function sortUrl(value: MarketplaceSort, categoryId?: string, query?: string) {
  const params = new URLSearchParams();
  if (categoryId) params.set("category", categoryId);
  if (query) params.set("query", query);
  if (value !== "newest") params.set("sort", value);
  const search = params.toString();
  return search ? `/marketplace?${search}` : "/marketplace";
}

export function FilterBar({
  sort,
  categoryId,
  query,
  resultCount,
}: {
  sort: MarketplaceSort;
  categoryId?: string;
  query?: string;
  resultCount: number;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <h2 className="text-lg font-semibold leading-7 text-[#121c2a]">Marketplace Listings</h2>
        <p className="text-xs text-[#747685]">{resultCount} {resultCount === 1 ? "item" : "items"}</p>
      </div>
      <details className="relative">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-sm text-[#121c2a] hover:bg-[#edf2ff] focus-visible:outline-2 focus-visible:outline-[#0038a8]">
          <Image src="/assets/marketplace/filter.svg" alt="" width={14} height={9} aria-hidden="true" />
          Sort
        </summary>
        <div className="absolute right-0 z-20 mt-1 min-w-48 overflow-hidden rounded-lg border border-[#c4c5d5] bg-white py-1 shadow-lg">
          {sortOptions.map((option) => (
            <Link
              key={option.value}
              href={sortUrl(option.value, categoryId, query)}
              aria-current={option.value === sort ? "page" : undefined}
              className={`block px-4 py-2 text-sm hover:bg-[#edf2ff] ${option.value === sort ? "font-bold text-[#0038a8]" : "text-[#444653]"}`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </details>
    </div>
  );
}
