import type { Metadata } from "next";

import { CategoryFilter } from "@/components/category-filter";
import { FilterBar } from "@/components/filter-bar";
import { MobileNavigation } from "@/components/mobile-navigation";
import { Navbar } from "@/components/navbar";
import { ProductCard } from "@/components/product-card";
import { SearchBar } from "@/components/search-bar";
import { getMarketplaceListings } from "@/lib/listings";

export const metadata: Metadata = {
  title: "Marketplace | UC-Market",
  description: "Browse recent listings from verified UC Main students.",
};

export default async function MarketplacePage() {
  const products = await getMarketplaceListings();

  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      <Navbar />

      <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-6 py-4 pb-24 md:pb-10">
        <SearchBar />
        <CategoryFilter />
        <FilterBar />

        <section aria-label="Recent marketplace listings">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
          {products.length === 0 && (
            <p className="py-12 text-center text-sm text-[#444653]">No listings found.</p>
          )}
        </section>
      </main>

      <MobileNavigation />
    </div>
  );
}
