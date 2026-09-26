import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildFavoritesHref,
  FAVORITES_MAX_PAGE,
  FAVORITES_PAGE_SIZE,
  orderListingsByFavoriteIds,
  parseFavoritesSearchParams,
} from "../src/lib/favorites-pagination.ts";

describe("favorites pagination parameters", () => {
  test("uses page one by default", () => {
    assert.deepEqual(parseFavoritesSearchParams({}), { page: 1 });
    assert.equal(FAVORITES_PAGE_SIZE, 12);
  });

  test("accepts a bounded positive integer and the first duplicate value", () => {
    assert.deepEqual(parseFavoritesSearchParams({ page: " 24 " }), {
      page: 24,
    });
    assert.deepEqual(
      parseFavoritesSearchParams({ page: ["3", "9"] }),
      { page: 3 },
    );
    assert.deepEqual(
      parseFavoritesSearchParams({ page: String(FAVORITES_MAX_PAGE) }),
      { page: FAVORITES_MAX_PAGE },
    );
  });

  test("falls back to page one for invalid or excessive values", () => {
    for (const page of [
      "",
      "0",
      "-1",
      "1.5",
      "01",
      "NaN",
      "Infinity",
      "page",
      String(FAVORITES_MAX_PAGE + 1),
    ]) {
      assert.equal(
        parseFavoritesSearchParams({ page }).page,
        1,
        `expected ${JSON.stringify(page)} to resolve to page one`,
      );
    }
  });
});

describe("favorites pagination URLs", () => {
  test("keeps the first page URL canonical", () => {
    assert.equal(buildFavoritesHref(1), "/favorites");
  });

  test("serializes valid later pages", () => {
    assert.equal(buildFavoritesHref(2), "/favorites?page=2");
    assert.equal(
      buildFavoritesHref(FAVORITES_MAX_PAGE),
      `/favorites?page=${FAVORITES_MAX_PAGE}`,
    );
  });

  test("does not serialize invalid page numbers", () => {
    for (const page of [
      0,
      -1,
      1.5,
      FAVORITES_MAX_PAGE + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      assert.equal(buildFavoritesHref(page), "/favorites");
    }
  });
});

describe("favorite listing ordering", () => {
  test("restores favorite-created order after the batched listing query", () => {
    const listings = [
      { id: "listing-b", title: "B" },
      { id: "listing-a", title: "A" },
      { id: "listing-c", title: "C" },
    ];

    assert.deepEqual(
      orderListingsByFavoriteIds(
        ["listing-c", "listing-a", "listing-b"],
        listings,
      ).map((listing) => listing.id),
      ["listing-c", "listing-a", "listing-b"],
    );
  });

  test("omits inaccessible or missing listings without reordering visible rows", () => {
    const listings = [
      { id: "listing-c" },
      { id: "listing-a" },
    ];

    assert.deepEqual(
      orderListingsByFavoriteIds(
        ["listing-a", "removed-listing", "listing-c"],
        listings,
      ).map((listing) => listing.id),
      ["listing-a", "listing-c"],
    );
  });
});
