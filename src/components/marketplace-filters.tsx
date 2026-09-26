"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { MarketplaceCategoryOption } from "@/components/category-filter";
import {
  MARKETPLACE_PRICE_MAX_PHP,
  MARKETPLACE_PRICE_RANGE_ERROR,
  buildMarketplaceUrl,
  countActiveMarketplaceFilters,
  type MarketplaceCondition,
  type MarketplaceUrlValues,
} from "@/lib/marketplace-search-params";

const conditions: Array<{ value: MarketplaceCondition; label: string }> = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like New" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
];

function optionalFormValue(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

type MarketplaceFiltersProps = {
  values: MarketplaceUrlValues;
  categories?: MarketplaceCategoryOption[];
  priceRangeError?: string | null;
};

export function MarketplaceFilters(props: MarketplaceFiltersProps) {
  const { values } = props;
  const stateKey = [
    values.search,
    values.category,
    values.condition,
    values.minPrice,
    values.maxPrice,
    values.sort,
    values.page,
  ].join(":");

  return <MarketplaceFiltersForm key={stateKey} {...props} />;
}

function MarketplaceFiltersForm({
  values,
  categories = [],
  priceRangeError = null,
}: MarketplaceFiltersProps) {
  const router = useRouter();
  const [clientError, setClientError] = useState<string | null>(priceRangeError);
  const activeCount = countActiveMarketplaceFilters(values);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const minimum = optionalFormValue(formData, "minPrice");
    const maximum = optionalFormValue(formData, "maxPrice");

    if (
      minimum !== null &&
      maximum !== null &&
      Number(minimum) > Number(maximum)
    ) {
      setClientError(MARKETPLACE_PRICE_RANGE_ERROR);
      return;
    }

    setClientError(null);
    router.push(
      buildMarketplaceUrl(values, {
        category: optionalFormValue(formData, "category"),
        condition: optionalFormValue(
          formData,
          "condition",
        ) as MarketplaceCondition | null,
        minPrice: minimum,
        maxPrice: maximum,
      }),
    );
  }

  return (
    <details className="group rounded-xl border border-[#c4c5d5] bg-white shadow-sm">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-[#121c2a] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0038a8] md:hidden">
        <span>Filters{activeCount > 0 ? ` (${activeCount})` : ""}</span>
        <span aria-hidden="true" className="text-lg text-[#0038a8] group-open:rotate-180">
          &#8964;
        </span>
      </summary>

      <div className="hidden border-t border-[#e1e2ea] p-4 group-open:block md:block md:border-t-0 md:p-5">
        <div className="mb-4 hidden items-center justify-between md:flex">
          <h2 className="font-bold text-[#121c2a]">Filters</h2>
          {activeCount > 0 && (
            <span className="rounded-full bg-[#e6eeff] px-2 py-1 text-xs font-semibold text-[#0038a8]">
              {activeCount} active
            </span>
          )}
        </div>

        <form
          action="/marketplace"
          method="get"
          onSubmit={applyFilters}
          className="grid gap-4 sm:grid-cols-2 md:grid-cols-1"
        >
          {values.search && (
            <input type="hidden" name="search" value={values.search} />
          )}
          {values.sort !== "newest" && (
            <input type="hidden" name="sort" value={values.sort} />
          )}

          {categories.length > 0 && (
            <div className="sm:col-span-2 md:col-span-1">
              <label htmlFor="marketplace-category" className="block text-sm font-semibold">
                Category
              </label>
              <select
                id="marketplace-category"
                name="category"
                defaultValue={values.category ?? ""}
                className="mt-2 min-h-11 w-full rounded-md border border-[#c4c5d5] bg-white px-3 text-sm text-[#121c2a] outline-none focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15"
              >
                <option value="">All Categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.slug}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="sm:col-span-2 md:col-span-1">
            <label htmlFor="marketplace-condition" className="block text-sm font-semibold">
              Condition
            </label>
            <select
              id="marketplace-condition"
              name="condition"
              defaultValue={values.condition ?? ""}
              className="mt-2 min-h-11 w-full rounded-md border border-[#c4c5d5] bg-white px-3 text-sm text-[#121c2a] outline-none focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15"
            >
              <option value="">All Conditions</option>
              {conditions.map((condition) => (
                <option key={condition.value} value={condition.value}>
                  {condition.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="marketplace-min-price" className="block text-sm font-semibold">
              Minimum price
            </label>
            <div className="relative mt-2">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#5b6070]" aria-hidden="true">
                &#8369;
              </span>
              <input
                id="marketplace-min-price"
                name="minPrice"
                type="number"
                inputMode="decimal"
                min="0"
                max={MARKETPLACE_PRICE_MAX_PHP}
                step="0.01"
                defaultValue={values.minPrice}
                aria-invalid={Boolean(clientError)}
                aria-describedby={clientError ? "marketplace-price-error" : undefined}
                className="min-h-11 w-full rounded-md border border-[#c4c5d5] bg-white pl-8 pr-3 text-sm outline-none focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15"
              />
            </div>
          </div>

          <div>
            <label htmlFor="marketplace-max-price" className="block text-sm font-semibold">
              Maximum price
            </label>
            <div className="relative mt-2">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#5b6070]" aria-hidden="true">
                &#8369;
              </span>
              <input
                id="marketplace-max-price"
                name="maxPrice"
                type="number"
                inputMode="decimal"
                min="0"
                max={MARKETPLACE_PRICE_MAX_PHP}
                step="0.01"
                defaultValue={values.maxPrice}
                aria-invalid={Boolean(clientError)}
                aria-describedby={clientError ? "marketplace-price-error" : undefined}
                className="min-h-11 w-full rounded-md border border-[#c4c5d5] bg-white pl-8 pr-3 text-sm outline-none focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15"
              />
            </div>
          </div>

          {clientError && (
            <p
              id="marketplace-price-error"
              role="alert"
              className="text-sm font-medium text-[#ba1a1a] sm:col-span-2 md:col-span-1"
            >
              {clientError}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row md:col-span-1 md:flex-col">
            <button
              type="submit"
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-[#0038a8] px-4 text-sm font-semibold text-white transition hover:bg-[#002576] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
            >
              Apply Filters
            </button>
            {(activeCount > 0 || clientError) && (
              <Link
                href="/marketplace"
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-[#0038a8] px-4 text-sm font-semibold text-[#0038a8] hover:bg-[#edf2ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
              >
                Clear All Filters
              </Link>
            )}
          </div>
        </form>
      </div>
    </details>
  );
}
