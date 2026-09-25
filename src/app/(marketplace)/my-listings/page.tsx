import type { Metadata } from "next";
import Link from "next/link";

import { ProductCard } from "@/components/product-card";
import { getSellerListings } from "@/lib/listings";

export const metadata: Metadata = {
  title: "My Items | UC Marketplace",
  description: "Manage your UC Marketplace listings.",
};

export default async function MyListingsPage() {
  const { products, error } = await getSellerListings();

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-6 pb-28 pt-10 text-[#121c2a] md:pb-12">
      <section className="mx-auto w-full max-w-[1200px]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#002576]">
              My Items
            </h1>
            <p className="mt-2 text-sm leading-6 text-[#444653]">
              Review the items you have listed on UC Marketplace.
            </p>
          </div>
          <Link
            href="/sell"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#002576] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
          >
            Sell an Item
          </Link>
        </div>

        {error ? (
          <div
            aria-live="polite"
            className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm"
          >
            <h2 className="text-lg font-bold">
              Your items are temporarily unavailable
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#444653]">
              We couldn&apos;t load your listings right now. Please try again in a
              moment.
            </p>
            <Link
              href="/my-listings"
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8] transition-colors hover:bg-[#e9effb]"
            >
              Try Again
            </Link>
          </div>
        ) : products.length > 0 ? (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                showFavorite={false}
              />
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-bold">No items to manage yet</h2>
            <p className="mt-2 text-sm leading-6 text-[#444653]">
              Publish your first item to make it available to verified UC Main
              students.
            </p>
            <Link
              href="/sell"
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576]"
            >
              Sell an Item
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
