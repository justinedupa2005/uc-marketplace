import type { Metadata } from "next";
import Link from "next/link";

import { CategoryFilter } from "@/components/category-filter";
import { FilterBar } from "@/components/filter-bar";
import { ProductCard } from "@/components/product-card";
import { SearchBar } from "@/components/search-bar";
import {
  getMarketplaceCategories,
  getMarketplaceListings,
  type MarketplaceSort,
} from "@/lib/listings";

export const metadata: Metadata = {
  title: "Marketplace | UC-Market",
  description: "Browse recent listings from verified UC Main students.",
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isMarketplaceSort(value: string | undefined): value is MarketplaceSort {
  return value === "newest" || value === "price_asc" || value === "price_desc";
}

export default async function MarketplacePage({ searchParams }: {
  searchParams: Promise<{
    query?: string | string[];
    category?: string | string[];
    sort?: string | string[];
  }>;
}) {
  const queryParams = await searchParams;
  const search = firstValue(queryParams.query)?.trim().slice(0, 80) ?? "";
  const requestedCategoryId = firstValue(queryParams.category);
  const requestedSort = firstValue(queryParams.sort);
  const sort: MarketplaceSort = isMarketplaceSort(requestedSort)
    ? requestedSort
    : "newest";
  const categoryResult = await getMarketplaceCategories();
  const selectedCategoryId = categoryResult.categories.some(
    (category) => category.id === requestedCategoryId,
  )
    ? requestedCategoryId
    : undefined;
  const { products, error } = await getMarketplaceListings({
    search,
    categoryId: selectedCategoryId,
    sort,
  });
  const hasFilters = Boolean(search || selectedCategoryId || sort !== "newest");

  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-6 py-4 pb-24 md:pb-10">
        <SearchBar
          defaultValue={search}
          categoryId={selectedCategoryId}
          sort={sort}
        />
        <CategoryFilter
          categories={categoryResult.categories}
          selectedCategoryId={selectedCategoryId}
          query={search}
          sort={sort}
        />
        <FilterBar
          sort={sort}
          categoryId={selectedCategoryId}
          query={search}
          resultCount={products.length}
        />

        {categoryResult.error && !error && (
          <p role="status" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Category filters are temporarily unavailable. All active listings
            are still shown.
          </p>
        )}

        {error ? (
          <section
            aria-live="polite"
            className="rounded-xl border border-[#c4c5d5] bg-white px-6 py-10 text-center shadow-sm"
          >
            <h2 className="text-lg font-bold text-[#121c2a]">
              Marketplace temporarily unavailable
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#444653]">
              We couldn&apos;t load the listings right now. Your account data is
              safe; wait a moment and try again.
            </p>
            <Link
              href="/marketplace"
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576]"
            >
              Try Again
            </Link>
          </section>
        ) : (
          <section aria-label="Recent marketplace listings">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
            {products.length === 0 && (
              <div className="py-12 text-center text-sm text-[#444653]">
                <p>No listings match your current search and filters.</p>
                {hasFilters && (
                  <Link href="/marketplace" className="mt-4 inline-flex min-h-11 items-center rounded-md border border-[#0038a8] px-5 font-semibold text-[#0038a8] hover:bg-[#edf2ff]">
                    Clear filters
                  </Link>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
