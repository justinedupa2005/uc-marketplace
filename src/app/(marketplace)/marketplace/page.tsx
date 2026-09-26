import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ActiveFilterChips } from "@/components/active-filter-chips";
import { CategoryFilter } from "@/components/category-filter";
import { FilterBar } from "@/components/filter-bar";
import { MarketplaceEmptyState } from "@/components/marketplace-empty-state";
import { MarketplaceFilters } from "@/components/marketplace-filters";
import { MarketplacePagination } from "@/components/marketplace-pagination";
import { ProductCard } from "@/components/product-card";
import { SearchBar } from "@/components/search-bar";
import {
  getMarketplaceCategories,
  getMarketplaceListings,
} from "@/lib/listings";
import {
  buildMarketplaceHref,
  countActiveMarketplaceFilters,
  parseMarketplaceSearchParams,
  type MarketplaceSearchParamsInput,
} from "@/lib/marketplace-search-params";

export const metadata: Metadata = {
  title: "Marketplace | UC-Market",
  description: "Browse recent listings from verified UC Main students.",
};

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<MarketplaceSearchParamsInput>;
}) {
  const parsed = parseMarketplaceSearchParams(await searchParams);
  const categoryResult = await getMarketplaceCategories();
  const selectedCategory = categoryResult.categories.find(
    (category) => category.slug === parsed.filters.category,
  );

  // Unknown or inactive slugs are not allowed to influence either the query or
  // the visible controls. All other validated URL state remains intact.
  const values = {
    ...parsed.values,
    category: selectedCategory?.slug,
  };
  const filters = {
    ...parsed.filters,
    category: selectedCategory?.slug,
  };

  const result = await getMarketplaceListings({
    search: filters.search,
    categoryId: selectedCategory?.id,
    condition: filters.condition,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    sort: filters.sort,
    page: filters.page,
  });

  const totalPages = Math.max(
    1,
    Math.ceil(result.totalCount / result.pageSize),
  );

  if (!result.error && values.page > totalPages) {
    redirect(buildMarketplaceHref(values, { page: totalPages }));
  }

  const marketplaceHref = buildMarketplaceHref(values);
  const hasFilters =
    countActiveMarketplaceFilters(values) > 0 || Boolean(parsed.priceRangeError);

  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-5 py-4 pb-24 sm:px-6 md:pb-10">
        <h1 className="sr-only">UC Marketplace listings</h1>

        <SearchBar values={values} />
        <CategoryFilter categories={categoryResult.categories} values={values} />

        {categoryResult.error && !result.error && (
          <p
            role="status"
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            Category filters are temporarily unavailable. All active listings
            are still shown.
          </p>
        )}

        <ActiveFilterChips
          values={values}
          categories={categoryResult.categories}
          priceRangeError={parsed.priceRangeError}
        />

        <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <MarketplaceFilters
            values={values}
            categories={categoryResult.categories}
            priceRangeError={parsed.priceRangeError}
          />

          <div className="min-w-0">
            <FilterBar values={values} totalCount={result.totalCount} />

            {result.error ? (
              <section
                aria-live="polite"
                className="mt-3 rounded-xl border border-[#c4c5d5] bg-white px-6 py-10 text-center shadow-sm"
              >
                <h2 className="text-lg font-bold text-[#121c2a]">
                  Marketplace temporarily unavailable
                </h2>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#444653]">
                  We couldn&apos;t load the listings right now. Please wait a
                  moment and try again.
                </p>
                <a
                  href={marketplaceHref}
                  className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
                >
                  Try again
                </a>
              </section>
            ) : result.products.length === 0 ? (
              <MarketplaceEmptyState
                search={values.search}
                hasFilters={hasFilters}
              />
            ) : (
              <section
                aria-label="Marketplace search results"
                className="mt-3"
              >
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                  {result.products.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      returnTo={marketplaceHref}
                    />
                  ))}
                </div>

                <MarketplacePagination
                  values={values}
                  totalPages={totalPages}
                />
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
