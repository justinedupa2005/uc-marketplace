import type { Metadata } from "next";
import Link from "next/link";

import { ListingOwnerActions } from "@/components/listing-owner-actions";
import { ProductCard } from "@/components/product-card";
import { getSellerListings } from "@/lib/listings";

export const metadata: Metadata = {
  title: "My Items | UC Marketplace",
  description: "Manage your UC Marketplace listings.",
};

const filters = [
  ["all", "All"],
  ["available", "Available"],
  ["reserved", "Reserved"],
  ["sold", "Sold"],
  ["removed", "Removed"],
] as const;
type ListingFilter = (typeof filters)[number][0];

function isListingFilter(value: unknown): value is ListingFilter {
  return filters.some(([filter]) => filter === value);
}

export default async function MyListingsPage({ searchParams }: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const [{ products, error }, query] = await Promise.all([
    getSellerListings(),
    searchParams,
  ]);
  const selectedFilter = isListingFilter(query.status) ? query.status : "all";
  const counts = Object.fromEntries(
    filters.map(([filter]) => [
      filter,
      filter === "all"
        ? products.length
        : products.filter((product) => product.statusValue === filter).length,
    ]),
  ) as Record<ListingFilter, number>;
  const visibleProducts = selectedFilter === "all"
    ? products
    : products.filter((product) => product.statusValue === selectedFilter);
  const selectedLabel = filters.find(([value]) => value === selectedFilter)?.[1];

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-10 text-[#121c2a] sm:px-6 md:pb-12">
      <section className="mx-auto w-full max-w-[1200px]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#002576]">My Items</h1>
            <p className="mt-2 text-sm leading-6 text-[#444653]">Manage every marketplace listing you have posted.</p>
          </div>
          <Link href="/sell" className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576]">Sell an Item</Link>
        </div>

        {!error && products.length > 0 && (
          <nav aria-label="Filter listings by status" className="mt-7 overflow-x-auto pb-1">
            <ul className="flex min-w-max gap-2">
              {filters.map(([filter, label]) => {
                const selected = filter === selectedFilter;
                return (
                  <li key={filter}>
                    <Link
                      href={filter === "all" ? "/my-listings" : `/my-listings?status=${filter}`}
                      aria-current={selected ? "page" : undefined}
                      className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold ${selected ? "border-[#0038a8] bg-[#0038a8] text-white" : "border-[#c4c5d5] bg-white text-[#444653] hover:bg-[#e9effb]"}`}
                    >
                      {label} ({counts[filter]})
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {error ? (
          <div aria-live="polite" className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-bold">Your items are temporarily unavailable</h2>
            <p className="mt-2 text-sm leading-6 text-[#444653]">We couldn&apos;t load your listings right now. Please try again in a moment.</p>
            <Link href="/my-listings" className="mt-5 inline-flex min-h-11 items-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8] hover:bg-[#e9effb]">Try Again</Link>
          </div>
        ) : visibleProducts.length > 0 ? (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                showFavorite={false}
                showMetadata
                actions={<ListingOwnerActions listingId={String(product.id)} status={product.statusValue} compact />}
              />
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-bold">
              {products.length === 0
                ? "You haven't listed anything yet"
                : `You don't have any ${selectedLabel?.toLowerCase()} listings yet`}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#444653]">
              {products.length === 0
                ? "Publish your first item for verified UC Main students to discover."
                : "Choose another status filter to review your other items."}
            </p>
            {products.length === 0 && (
              <Link href="/sell" className="mt-5 inline-flex min-h-11 items-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576]">Sell an Item</Link>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
