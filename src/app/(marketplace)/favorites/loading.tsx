import { MarketplaceSkeleton } from "@/components/marketplace-skeleton";
import { FAVORITES_PAGE_SIZE } from "@/lib/favorites-pagination";

export default function FavoritesLoading() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-10 text-[#121c2a] sm:px-6 md:pb-12">
      <section className="mx-auto w-full max-w-[1200px]">
        <header>
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#002576]">
            Favorites
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#444653]">
            Items you&apos;ve saved for later.
          </p>
        </header>

        <div className="mt-8">
          <MarketplaceSkeleton
            cardCount={FAVORITES_PAGE_SIZE}
            label="Loading favorite listings"
            gridClassName="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          />
        </div>
      </section>
    </main>
  );
}
