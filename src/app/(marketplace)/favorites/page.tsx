import type { Metadata } from "next";
import Link from "next/link";

import { ProductCard } from "@/components/product-card";
import { getFavoriteListings } from "@/lib/listings";

export const metadata: Metadata = {
  title: "Favorites | UC Marketplace",
  description: "View items saved from the UC Marketplace.",
};

export default async function FavoritesPage() {
  const { products, error } = await getFavoriteListings();

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-10 text-[#121c2a] sm:px-6 md:pb-12">
      <section className="mx-auto w-full max-w-[1200px]">
        <header>
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#002576]">Favorites</h1>
          <p className="mt-2 text-sm leading-6 text-[#444653]">Items you&apos;ve saved for later.</p>
        </header>

        {error ? (
          <div className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-bold">Favorites temporarily unavailable</h2>
            <p className="mt-2 text-sm text-[#444653]">We couldn&apos;t load your saved items right now.</p>
            <Link href="/favorites" className="mt-5 inline-flex min-h-11 items-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8]">Try Again</Link>
          </div>
        ) : products.length > 0 ? (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => <ProductCard key={product.id} product={product} showMetadata />)}
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-bold">No saved listings yet</h2>
            <p className="mt-2 text-sm leading-6 text-[#444653]">Use the heart button on a listing to keep it here.</p>
            <Link href="/marketplace" className="mt-5 inline-flex min-h-11 items-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576]">Browse Marketplace</Link>
          </div>
        )}
      </section>
    </main>
  );
}
