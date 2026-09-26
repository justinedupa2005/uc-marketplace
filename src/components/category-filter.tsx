import Link from "next/link";

import {
  buildMarketplaceHref,
  type MarketplaceUrlValues,
} from "@/lib/marketplace-search-params";

export type MarketplaceCategoryOption = {
  id: string;
  name: string;
  slug: string;
};

export function CategoryFilter({
  categories,
  values,
}: {
  categories: MarketplaceCategoryOption[];
  values: MarketplaceUrlValues;
}) {
  const options: Array<MarketplaceCategoryOption | null> = [null, ...categories];

  return (
    <nav aria-label="Marketplace categories" className="-mx-1 overflow-x-auto py-2">
      <div className="flex w-max gap-2 px-1">
        {options.map((category) => {
          const slug = category?.slug;
          const selected = slug === values.category;

          return (
            <Link
              key={category?.id ?? "all"}
              href={buildMarketplaceHref(values, {
                category: slug ?? null,
              })}
              aria-current={selected ? "page" : undefined}
              className={`inline-flex min-h-[38px] items-center rounded-full border px-4 text-xs font-semibold tracking-[0.05em] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8] ${
                selected
                  ? "border-[#0038a8] bg-[#0038a8] text-white"
                  : "border-[#c4c5d5] bg-white text-[#0038a8] hover:bg-[#edf2ff]"
              }`}
            >
              {category?.name ?? "All Items"}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
