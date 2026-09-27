import { z } from "zod";

export const FAVORITES_PAGE_SIZE = 12;
export const FAVORITES_MAX_PAGE = 10_000;

export type FavoritesSearchParamsInput = Record<
  string,
  string | string[] | undefined
>;

export type FavoritesPagination = {
  page: number;
};

const pageSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(FAVORITES_MAX_PAGE));

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseFavoritesSearchParams(
  input: FavoritesSearchParamsInput,
): FavoritesPagination {
  const parsedPage = pageSchema.safeParse(firstValue(input.page));

  return { page: parsedPage.success ? parsedPage.data : 1 };
}

export function buildFavoritesHref(page: number) {
  const parsedPage = pageSchema.safeParse(String(page));

  if (!parsedPage.success || parsedPage.data === 1) return "/favorites";

  return `/favorites?page=${parsedPage.data}`;
}

export function orderListingsByFavoriteIds<T extends { id: string }>(
  favoriteListingIds: readonly string[],
  listings: readonly T[],
) {
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));

  return favoriteListingIds.flatMap((listingId) => {
    const listing = listingById.get(listingId);
    return listing ? [listing] : [];
  });
}
