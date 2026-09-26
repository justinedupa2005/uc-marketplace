import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FavoritesGrid } from "@/components/favorites-grid";
import { Pagination } from "@/components/pagination";
import {
  buildFavoritesHref,
  parseFavoritesSearchParams,
  type FavoritesSearchParamsInput,
} from "@/lib/favorites-pagination";
import { getFavoriteListings } from "@/lib/listings";

export const metadata: Metadata = {
  title: "Favorites | UC Marketplace",
  description: "View items saved from the UC Marketplace.",
};

export default async function FavoritesPage({
  searchParams,
}: {
  searchParams: Promise<FavoritesSearchParamsInput>;
}) {
  const { page } = parseFavoritesSearchParams(await searchParams);
  const result = await getFavoriteListings(page);
  const totalPages = Math.max(
    1,
    Math.ceil(result.totalCount / result.pageSize),
  );

  if (!result.error && page > totalPages) {
    redirect(buildFavoritesHref(totalPages));
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-10 text-[#121c2a] sm:px-6 md:pb-12">
      <section className="mx-auto w-full max-w-[1200px]">
        <header>
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#002576]">
            Favorites
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#444653]">
            Items you&apos;ve saved for later, with your newest saves first.
          </p>
        </header>

        {result.error ? (
          <div
            role="alert"
            className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm"
          >
            <h2 className="text-lg font-bold">
              Favorites temporarily unavailable
            </h2>
            <p className="mt-2 text-sm text-[#444653]">
              Unable to load your favorites. Please try again.
            </p>
            <a
              href={buildFavoritesHref(page)}
              className="mt-5 inline-flex min-h-11 items-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8] hover:bg-[#edf2ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
            >
              Try again
            </a>
          </div>
        ) : (
          <>
            <FavoritesGrid
              products={result.products}
              returnTo={buildFavoritesHref(page)}
            />
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              hrefForPage={buildFavoritesHref}
              ariaLabel="Favorite listing pages"
            />
          </>
        )}
      </section>
    </main>
  );
}
