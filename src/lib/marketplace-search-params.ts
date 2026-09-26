import { z } from "zod";

export const MARKETPLACE_PAGE_SIZE = 12;
export const MARKETPLACE_MAX_PAGE = 10_000;
// Keep marketplace URL input aligned with the listing creation price ceiling.
export const MARKETPLACE_PRICE_MAX_PHP = 1_000_000;
export const MARKETPLACE_PRICE_RANGE_ERROR =
  "Minimum price cannot be greater than maximum price.";

export const marketplaceConditions = [
  "new",
  "like_new",
  "good",
  "fair",
] as const;

export const marketplaceSorts = [
  "newest",
  "price-asc",
  "price-desc",
] as const;

export type MarketplaceCondition = (typeof marketplaceConditions)[number];
export type MarketplaceSort = (typeof marketplaceSorts)[number];

export type MarketplaceSearchParamsInput = Record<
  string,
  string | string[] | undefined
>;

export type MarketplaceFilters = {
  search?: string;
  category?: string;
  condition?: MarketplaceCondition;
  minPrice?: number;
  maxPrice?: number;
  sort: MarketplaceSort;
  page: number;
};

/**
 * Canonical values for controls and URL serialization. Valid but inverted
 * prices remain here so the controls can show what needs correcting, while
 * they are deliberately omitted from `filters`.
 */
export type MarketplaceUrlValues = {
  search?: string;
  category?: string;
  condition?: MarketplaceCondition;
  minPrice?: number;
  maxPrice?: number;
  sort: MarketplaceSort;
  page: number;
};

export type MarketplaceSearchParamsResult = {
  filters: MarketplaceFilters;
  values: MarketplaceUrlValues;
  priceRangeError: string | null;
  hasActiveFilters: boolean;
};

export type MarketplaceSearchParamPatch = Partial<{
  search: string | null;
  category: string | null;
  condition: MarketplaceCondition | null;
  minPrice: number | string | null;
  maxPrice: number | string | null;
  sort: MarketplaceSort | null;
  page: number | string | null;
}>;

export type MarketplaceFilterUpdates = MarketplaceSearchParamPatch;

const conditionSchema = z.enum(marketplaceConditions);
const sortSchema = z.enum(marketplaceSorts);
const categorySchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const priceSchema = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/)
  .transform(Number)
  .pipe(z.number().finite().nonnegative().max(MARKETPLACE_PRICE_MAX_PHP));
const pageSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(MARKETPLACE_MAX_PAGE));

const filterKeys = new Set([
  "search",
  "category",
  "condition",
  "minPrice",
  "maxPrice",
  "sort",
]);

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizedSearch(value: string | undefined) {
  if (value === undefined) return undefined;

  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();

  return normalized || undefined;
}

function parseOptional<T>(
  schema: z.ZodType<T>,
  value: string | undefined,
): T | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

function toInputRecord(values: MarketplaceUrlValues): MarketplaceSearchParamsInput {
  return {
    search: values.search,
    category: values.category,
    condition: values.condition,
    minPrice:
      values.minPrice === undefined ? undefined : String(values.minPrice),
    maxPrice:
      values.maxPrice === undefined ? undefined : String(values.maxPrice),
    sort: values.sort,
    page: String(values.page),
  };
}

export function parseMarketplaceSearchParams(
  input: MarketplaceSearchParamsInput,
): MarketplaceSearchParamsResult {
  const search = normalizedSearch(firstValue(input.search));
  const category = parseOptional(
    categorySchema,
    firstValue(input.category),
  );
  const condition = parseOptional(
    conditionSchema,
    firstValue(input.condition),
  );
  const minPrice = parseOptional(priceSchema, firstValue(input.minPrice));
  const maxPrice = parseOptional(priceSchema, firstValue(input.maxPrice));
  const sort =
    parseOptional(sortSchema, firstValue(input.sort)) ?? "newest";
  const page = parseOptional(pageSchema, firstValue(input.page)) ?? 1;
  const hasInvalidPriceRange =
    minPrice !== undefined &&
    maxPrice !== undefined &&
    minPrice > maxPrice;

  const values: MarketplaceUrlValues = {
    search,
    category,
    condition,
    minPrice,
    maxPrice,
    sort,
    page,
  };

  const filters: MarketplaceFilters = {
    search,
    category,
    condition,
    minPrice: hasInvalidPriceRange ? undefined : minPrice,
    maxPrice: hasInvalidPriceRange ? undefined : maxPrice,
    sort,
    page,
  };

  return {
    filters,
    values,
    priceRangeError: hasInvalidPriceRange
      ? MARKETPLACE_PRICE_RANGE_ERROR
      : null,
    hasActiveFilters: Boolean(
      search ||
        category ||
        condition ||
        (!hasInvalidPriceRange &&
          (minPrice !== undefined || maxPrice !== undefined)) ||
        sort !== "newest",
    ),
  };
}

/**
 * Produces a canonical marketplace link. Applying any filter or sort value
 * drops the old page, while a page-only patch preserves all active filters.
 */
export function buildMarketplaceHref(
  current: MarketplaceUrlValues | MarketplaceFilters,
  patch: MarketplaceSearchParamPatch = {},
) {
  const next = toInputRecord(current);

  for (const [key, value] of Object.entries(patch)) {
    next[key] = value === null || value === undefined ? undefined : String(value);
  }

  if (Object.keys(patch).some((key) => filterKeys.has(key))) {
    next.page = undefined;
  }

  const { values } = parseMarketplaceSearchParams(next);
  const params = new URLSearchParams();

  if (values.search) params.set("search", values.search);
  if (values.category) params.set("category", values.category);
  if (values.condition) params.set("condition", values.condition);
  if (values.minPrice !== undefined) {
    params.set("minPrice", String(values.minPrice));
  }
  if (values.maxPrice !== undefined) {
    params.set("maxPrice", String(values.maxPrice));
  }
  if (values.sort !== "newest") params.set("sort", values.sort);
  if (values.page > 1) params.set("page", String(values.page));

  const query = params.toString();
  return query ? `/marketplace?${query}` : "/marketplace";
}

/** Alias used by marketplace controls that describe the destination as a URL. */
export function buildMarketplaceUrl(
  current: MarketplaceUrlValues | MarketplaceFilters,
  updates: MarketplaceFilterUpdates = {},
) {
  return buildMarketplaceHref(current, updates);
}

/**
 * Counts applied URL state for compact filter indicators. Minimum and maximum
 * price form one range filter, and an invalid inverted range is not counted.
 */
export function countActiveMarketplaceFilters(
  filters: MarketplaceUrlValues | MarketplaceFilters,
) {
  const hasValidPriceRange =
    (filters.minPrice !== undefined || filters.maxPrice !== undefined) &&
    !(
      filters.minPrice !== undefined &&
      filters.maxPrice !== undefined &&
      filters.minPrice > filters.maxPrice
    );

  return [
    Boolean(filters.search),
    Boolean(filters.category),
    Boolean(filters.condition),
    hasValidPriceRange,
    filters.sort !== "newest",
  ].filter(Boolean).length;
}
