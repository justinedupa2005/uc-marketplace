import Link from "next/link";

import type { MarketplaceCategoryOption } from "@/components/category-filter";
import {
  buildMarketplaceUrl,
  countActiveMarketplaceFilters,
  type MarketplaceCondition,
  type MarketplaceFilterUpdates,
  type MarketplaceUrlValues,
} from "@/lib/marketplace-search-params";

const conditionLabels: Record<MarketplaceCondition, string> = {
  new: "New",
  like_new: "Like New",
  good: "Good",
  fair: "Fair",
};

const sortLabels = {
  newest: "Newest",
  "price-asc": "Lowest Price",
  "price-desc": "Highest Price",
} as const;

const compactPeso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

type FilterChip = {
  key: string;
  label: string;
  removeLabel: string;
  updates: MarketplaceFilterUpdates;
};

export function ActiveFilterChips({
  values,
  categories,
  priceRangeError = null,
}: {
  values: MarketplaceUrlValues;
  categories: MarketplaceCategoryOption[];
  priceRangeError?: string | null;
}) {
  const categoryName = categories.find(
    (category) => category.slug === values.category,
  )?.name;
  const chips: FilterChip[] = [];

  if (values.search) {
    chips.push({
      key: "search",
      label: `Search: ${values.search}`,
      removeLabel: `Remove search filter ${values.search}`,
      updates: { search: null },
    });
  }
  if (values.category && categoryName) {
    chips.push({
      key: "category",
      label: categoryName,
      removeLabel: `Remove category filter ${categoryName}`,
      updates: { category: null },
    });
  }
  if (values.condition) {
    const label = conditionLabels[values.condition];
    chips.push({
      key: "condition",
      label,
      removeLabel: `Remove condition filter ${label}`,
      updates: { condition: null },
    });
  }
  if (
    !priceRangeError &&
    (values.minPrice !== undefined || values.maxPrice !== undefined)
  ) {
    const label =
      values.minPrice !== undefined && values.maxPrice !== undefined
        ? `${compactPeso.format(values.minPrice)}\u2013${compactPeso.format(values.maxPrice)}`
        : values.minPrice !== undefined
          ? `From ${compactPeso.format(values.minPrice)}`
          : `Up to ${compactPeso.format(values.maxPrice ?? 0)}`;

    chips.push({
      key: "price",
      label,
      removeLabel: `Remove price filter ${label}`,
      updates: { minPrice: null, maxPrice: null },
    });
  }
  if (values.sort !== "newest") {
    const label = sortLabels[values.sort];
    chips.push({
      key: "sort",
      label: `Sort: ${label}`,
      removeLabel: `Reset sorting from ${label}`,
      updates: { sort: null },
    });
  }

  if (countActiveMarketplaceFilters(values) === 0 || chips.length === 0) {
    return null;
  }

  return (
    <section aria-label="Active marketplace filters" className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-[#5b6070]">
        Active
      </span>
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={buildMarketplaceUrl(values, chip.updates)}
          aria-label={chip.removeLabel}
          className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[#9eb8e8] bg-[#edf2ff] px-3 text-xs font-semibold text-[#002576] hover:border-[#0038a8] hover:bg-[#e1eaff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
        >
          <span>{chip.label}</span>
          <span aria-hidden="true" className="text-base leading-none">
            &times;
          </span>
        </Link>
      ))}
      <Link
        href="/marketplace"
        className="inline-flex min-h-9 items-center rounded-md px-2 text-xs font-semibold text-[#0038a8] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
      >
        Clear All
      </Link>
    </section>
  );
}
