import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildMarketplaceHref,
  buildMarketplaceUrl,
  countActiveMarketplaceFilters,
  MARKETPLACE_PAGE_SIZE,
  MARKETPLACE_PRICE_RANGE_ERROR,
  parseMarketplaceSearchParams,
} from "../src/lib/marketplace-search-params.ts";

function parse(input = {}) {
  return parseMarketplaceSearchParams(input);
}

describe("marketplace search parameter parsing", () => {
  test("uses clean defaults when no parameters are present", () => {
    const result = parse();

    assert.deepEqual(result.filters, {
      search: undefined,
      category: undefined,
      condition: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      sort: "newest",
      page: 1,
    });
    assert.equal(result.priceRangeError, null);
    assert.equal(result.hasActiveFilters, false);
    assert.equal(MARKETPLACE_PAGE_SIZE, 12);
  });

  test("normalizes search text and uses the first duplicate URL value", () => {
    const result = parse({
      search: ["  scientific   calculator  ", "ignored"],
    });

    assert.equal(result.filters.search, "scientific calculator");
    assert.equal(parse({ search: "   " }).filters.search, undefined);
  });

  test("normalizes a valid category slug and ignores invalid slugs", () => {
    assert.equal(
      parse({ category: "  School-Supplies " }).filters.category,
      "school-supplies",
    );
    assert.equal(parse({ category: "not/a/slug" }).filters.category, undefined);
  });

  test("allows only supported listing conditions", () => {
    for (const condition of ["new", "like_new", "good", "fair"]) {
      assert.equal(parse({ condition }).filters.condition, condition);
    }

    assert.equal(parse({ condition: "random" }).filters.condition, undefined);
  });

  test("parses zero and decimal prices", () => {
    const result = parse({ minPrice: "0", maxPrice: "499.50" });

    assert.equal(result.filters.minPrice, 0);
    assert.equal(result.filters.maxPrice, 499.5);
    assert.equal(result.priceRangeError, null);
  });

  test("ignores invalid price inputs", () => {
    for (const value of [
      "-1",
      "NaN",
      "Infinity",
      "1e2",
      "12.345",
      "1000000.01",
      "price",
      "",
    ]) {
      assert.equal(
        parse({ minPrice: value }).filters.minPrice,
        undefined,
        `expected ${JSON.stringify(value)} to be ignored`,
      );
    }
  });

  test("flags an inverted range and applies neither price constraint", () => {
    const result = parse({ minPrice: "1000", maxPrice: "500" });

    assert.equal(result.values.minPrice, 1000);
    assert.equal(result.values.maxPrice, 500);
    assert.equal(result.filters.minPrice, undefined);
    assert.equal(result.filters.maxPrice, undefined);
    assert.equal(result.priceRangeError, MARKETPLACE_PRICE_RANGE_ERROR);
    assert.equal(result.hasActiveFilters, false);
  });

  test("allowlists sort values and positive integer pages", () => {
    assert.equal(parse({ sort: "price-asc" }).filters.sort, "price-asc");
    assert.equal(parse({ sort: "price-desc" }).filters.sort, "price-desc");
    assert.equal(parse({ sort: "random" }).filters.sort, "newest");
    assert.equal(parse({ page: "4" }).filters.page, 4);

    for (const page of ["0", "-1", "1.5", "NaN", "Infinity", "page"]) {
      assert.equal(parse({ page }).filters.page, 1);
    }

    assert.equal(parse({ page: "10001" }).filters.page, 1);
  });
});

describe("marketplace URL building", () => {
  const current = parse({
    search: "calculator",
    category: "electronics",
    condition: "good",
    minPrice: "100",
    maxPrice: "1000",
    sort: "price-desc",
    page: "4",
  }).values;

  test("preserves unrelated filters and resets page when a filter changes", () => {
    assert.equal(
      buildMarketplaceHref(current, { condition: "fair" }),
      "/marketplace?search=calculator&category=electronics&condition=fair&minPrice=100&maxPrice=1000&sort=price-desc",
    );
  });

  test("removes only the cleared filter", () => {
    assert.equal(
      buildMarketplaceHref(current, { condition: null }),
      "/marketplace?search=calculator&category=electronics&minPrice=100&maxPrice=1000&sort=price-desc",
    );
  });

  test("normalizes blank searches and default sorting out of the URL", () => {
    const state = parse({ search: "book", sort: "price-asc", page: "2" }).values;

    assert.equal(
      buildMarketplaceHref(state, { search: "  ", sort: "newest" }),
      "/marketplace",
    );
  });

  test("changes pages without deleting active filters", () => {
    assert.equal(
      buildMarketplaceHref(current, { page: 2 }),
      "/marketplace?search=calculator&category=electronics&condition=good&minPrice=100&maxPrice=1000&sort=price-desc&page=2",
    );
  });

  test("serializes the default state as the clean marketplace URL", () => {
    assert.equal(buildMarketplaceHref(parse().values), "/marketplace");
  });

  test("provides the canonical URL alias used by reusable controls", () => {
    assert.equal(
      buildMarketplaceUrl(current, { sort: "price-asc" }),
      "/marketplace?search=calculator&category=electronics&condition=good&minPrice=100&maxPrice=1000&sort=price-asc",
    );
  });

  test("counts a price range once and excludes pagination", () => {
    assert.equal(countActiveMarketplaceFilters(current), 5);
    assert.equal(
      countActiveMarketplaceFilters(parse({ page: "4" }).filters),
      0,
    );
    assert.equal(
      countActiveMarketplaceFilters(
        parse({ minPrice: "1000", maxPrice: "500" }).values,
      ),
      0,
    );
  });
});
