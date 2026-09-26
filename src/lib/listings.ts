import "server-only";

import type { MarketplaceProduct } from "@/components/product-card";
import {
  requireVerifiedActiveStudent,
  type AuthorizedAccessContext,
} from "@/lib/auth/authorization";
import {
  FAVORITES_MAX_PAGE,
  FAVORITES_PAGE_SIZE,
  orderListingsByFavoriteIds,
} from "@/lib/favorites-pagination";
import {
  formatListingCondition,
  getListingStatusLabel,
  isListingStatus,
  type ListingStatus,
} from "@/lib/listing-rules";
import {
  MARKETPLACE_MAX_PAGE,
  MARKETPLACE_PAGE_SIZE,
  type MarketplaceCondition,
  type MarketplaceSort,
} from "@/lib/marketplace-search-params";

type ListingImageRow = {
  id?: string;
  storage_path: string;
  is_cover: boolean;
  sort_order: number;
};

type ListingCategoryRow = { id?: string; name: string; slug?: string };

type ListingCardRow = {
  id: string;
  seller_id: string;
  title: string;
  price: number | string;
  condition: string;
  status: string;
  created_at: string;
  category: ListingCategoryRow | ListingCategoryRow[] | null;
  listing_images: ListingImageRow[] | null;
};

type ListingDetailsRow = ListingCardRow & {
  seller_id: string;
  description: string;
  updated_at: string;
};

type SellerProfileRow = {
  id: string;
  full_name: string;
  course: string | null;
  year_level: number | null;
  avatar_path: string | null;
  verification_status: string;
};

type OwnedListingEditRow = {
  id: string;
  seller_id: string;
  category_id: string;
  title: string;
  description: string;
  price: number | string;
  condition: string;
  status: string;
  created_at: string;
  updated_at: string;
  listing_images: ListingImageRow[] | null;
};

type ListingImageSigningResult = {
  urls: Map<string, string>;
  hasError: boolean;
};

const priceFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

const LISTING_IMAGE_URL_LIFETIME_SECONDS = 5 * 60;

export type ListingCardsResult =
  | { products: MarketplaceProduct[]; error: null }
  | { products: []; error: "unavailable" };

export type FavoriteListingsResult =
  | {
      products: MarketplaceProduct[];
      totalCount: number;
      page: number;
      pageSize: number;
      error: null;
    }
  | {
      products: [];
      totalCount: 0;
      page: number;
      pageSize: number;
      error: "unavailable";
    };

export type MarketplaceCategory = {
  id: string;
  name: string;
  slug: string;
};

export type MarketplaceBrowseOptions = {
  search?: string;
  categoryId?: string;
  condition?: MarketplaceCondition;
  minPrice?: number;
  maxPrice?: number;
  sort?: MarketplaceSort;
  page?: number;
};

export type MarketplaceListingsResult =
  | {
      products: MarketplaceProduct[];
      totalCount: number;
      page: number;
      pageSize: number;
      error: null;
    }
  | {
      products: [];
      totalCount: 0;
      page: number;
      pageSize: number;
      error: "unavailable";
    };

export type ListingDetailsImage = {
  src: string;
  alt: string;
  isCover: boolean;
  sortOrder: number;
};

export type ListingSeller = {
  id: string;
  fullName: string;
  course: string | null;
  yearLevel: number | null;
  avatarUrl: string | null;
  isVerified: boolean;
};

export type ListingDetails = {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  price: string;
  condition: string;
  status: MarketplaceProduct["status"];
  statusValue: ListingStatus;
  categoryName: string;
  createdAt: string;
  updatedAt: string;
  isOwner: boolean;
  isFavorited: boolean;
  activeReservation: { id: string; status: string } | null;
  existingConversationId: string | null;
  seller: ListingSeller;
  images: ListingDetailsImage[];
};

export type ListingDetailsResult =
  | { listing: ListingDetails; error: null }
  | { listing: null; error: "not_found" | "unavailable" };

export type OwnedListingImage = ListingDetailsImage & {
  id: string;
  storagePath: string;
};

export type OwnedListingForEdit = {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  price: string;
  condition: string;
  status: ListingStatus;
  createdAt: string;
  updatedAt: string;
  images: OwnedListingImage[];
};

export type OwnedListingForEditResult =
  | { listing: OwnedListingForEdit; error: null }
  | {
      listing: null;
      error: "not_found" | "not_editable" | "unavailable";
    };

function sortListingImages(images: ListingImageRow[] | null) {
  return [...(images ?? [])].sort(
    (first, second) => first.sort_order - second.sort_order,
  );
}

function getCoverImage(images: ListingImageRow[] | null) {
  const orderedImages = sortListingImages(images);
  return orderedImages.find((image) => image.is_cover) ?? orderedImages[0] ?? null;
}

function getCategoryName(
  category: ListingCategoryRow | ListingCategoryRow[] | null,
) {
  return Array.isArray(category)
    ? (category[0]?.name ?? "Uncategorized")
    : (category?.name ?? "Uncategorized");
}

function toListingStatus(value: string): ListingStatus {
  return isListingStatus(value) ? value : "draft";
}

export function formatListingPrice(value: number | string) {
  return priceFormatter.format(Number(value));
}

export { formatListingCondition };

export function formatListingStatus(value: string) {
  return getListingStatusLabel(value);
}

export async function signListingImagePaths(
  supabase: AuthorizedAccessContext["supabase"],
  paths: string[],
): Promise<ListingImageSigningResult> {
  const storagePaths = [...new Set(paths.filter(Boolean))];
  const urls = new Map<string, string>();

  if (storagePaths.length === 0) return { urls, hasError: false };

  const { data, error } = await supabase.storage
    .from("listing-images")
    .createSignedUrls(storagePaths, LISTING_IMAGE_URL_LIFETIME_SECONDS);

  if (error) {
    console.warn("Unable to create private listing image URLs");
    return { urls, hasError: true };
  }

  data.forEach((signedImage) => {
    if (signedImage.path && signedImage.signedUrl && !signedImage.error) {
      urls.set(signedImage.path, signedImage.signedUrl);
    }
  });

  return {
    urls,
    hasError: storagePaths.some((path) => !urls.has(path)),
  };
}

async function getFavoriteListingIds(
  supabase: AuthorizedAccessContext["supabase"],
  userId: string,
  listingIds: string[],
) {
  if (listingIds.length === 0) {
    return { ids: new Set<string>(), hasError: false };
  }

  const { data, error } = await supabase
    .from("favorites")
    .select("listing_id")
    .eq("user_id", userId)
    .in("listing_id", listingIds);

  return {
    ids: new Set(
      error
        ? []
        : (data ?? []).flatMap((favorite) =>
            typeof favorite.listing_id === "string"
              ? [favorite.listing_id]
              : [],
          ),
    ),
    hasError: Boolean(error),
  };
}

function toMarketplaceProduct(
  listing: ListingCardRow,
  signedImageUrls: Map<string, string>,
  favoriteIds: Set<string>,
  currentUserId?: string,
): MarketplaceProduct {
  const coverPath = getCoverImage(listing.listing_images)?.storage_path;
  const statusValue = toListingStatus(listing.status);

  return {
    id: listing.id,
    title: listing.title,
    price: formatListingPrice(listing.price),
    condition: formatListingCondition(listing.condition),
    status: getListingStatusLabel(statusValue),
    statusValue,
    categoryName: getCategoryName(listing.category),
    createdAt: listing.created_at,
    image: coverPath ? (signedImageUrls.get(coverPath) ?? null) : null,
    imageAlt: listing.title,
    isFavorited: favoriteIds.has(listing.id),
    isOwner: listing.seller_id === currentUserId,
  };
}

async function mapListingCards(
  supabase: AuthorizedAccessContext["supabase"],
  listings: ListingCardRow[],
  favoriteIds = new Set<string>(),
  currentUserId?: string,
) {
  const coverPaths = listings
    .map((listing) => getCoverImage(listing.listing_images)?.storage_path)
    .filter((path): path is string => Boolean(path));
  const { urls } = await signListingImagePaths(supabase, coverPaths);

  return listings.map((listing) =>
    toMarketplaceProduct(listing, urls, favoriteIds, currentUserId),
  );
}

const cardSelection = `
  id,
  seller_id,
  title,
  price,
  condition,
  status,
  created_at,
  category:categories (id, name),
  listing_images (storage_path, is_cover, sort_order)
`;

export async function getMarketplaceCategories(): Promise<{
  categories: MarketplaceCategory[];
  error: boolean;
}> {
  const { supabase } = await requireVerifiedActiveStudent("/marketplace");
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, slug")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.warn("Unable to load marketplace categories", { code: error.code });
    return { categories: [], error: true };
  }

  return {
    categories: (data ?? []).flatMap((category) =>
      typeof category.id === "string" &&
      typeof category.name === "string" &&
      typeof category.slug === "string"
        ? [{ id: category.id, name: category.name, slug: category.slug }]
        : [],
    ),
    error: false,
  };
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function getMarketplaceListings(
  options: MarketplaceBrowseOptions = {},
): Promise<MarketplaceListingsResult> {
  const { supabase, user } = await requireVerifiedActiveStudent("/marketplace");
  const search = options.search?.trim().slice(0, 80);
  const requestedPage = Number.isSafeInteger(options.page) ? options.page! : 1;
  const page = Math.min(
    MARKETPLACE_MAX_PAGE,
    Math.max(1, requestedPage),
  );
  const offset = (page - 1) * MARKETPLACE_PAGE_SIZE;
  let query = supabase
    .from("listings")
    .select(cardSelection, { count: "exact" })
    .in("status", ["available", "reserved"]);

  if (search) {
    query = query.ilike("search_text", `%${escapeLikePattern(search)}%`);
  }
  if (options.categoryId) query = query.eq("category_id", options.categoryId);
  if (options.condition) query = query.eq("condition", options.condition);
  if (options.minPrice !== undefined) {
    query = query.gte("price", options.minPrice);
  }
  if (options.maxPrice !== undefined) {
    query = query.lte("price", options.maxPrice);
  }

  if (options.sort === "price-asc") {
    query = query
      .order("price", { ascending: true })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
  } else if (options.sort === "price-desc") {
    query = query
      .order("price", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
  } else {
    query = query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
  }

  const { data, error, count } = await query.range(
    offset,
    offset + MARKETPLACE_PAGE_SIZE - 1,
  );

  if (error) {
    console.warn("Unable to load marketplace listings", { code: error.code });
    return {
      products: [],
      totalCount: 0,
      page,
      pageSize: MARKETPLACE_PAGE_SIZE,
      error: "unavailable",
    };
  }

  const listings = (data ?? []) as unknown as ListingCardRow[];
  const favorites = await getFavoriteListingIds(
    supabase,
    user.id,
    listings.map((listing) => listing.id),
  );

  if (favorites.hasError) {
    console.warn("Unable to load marketplace favorites");
    return {
      products: [],
      totalCount: 0,
      page,
      pageSize: MARKETPLACE_PAGE_SIZE,
      error: "unavailable",
    };
  }

  return {
    products: await mapListingCards(supabase, listings, favorites.ids, user.id),
    totalCount: count ?? 0,
    page,
    pageSize: MARKETPLACE_PAGE_SIZE,
    error: null,
  };
}

export async function getSellerListings(): Promise<ListingCardsResult> {
  const { supabase, user } = await requireVerifiedActiveStudent("/my-listings");
  const { data, error } = await supabase
    .from("listings")
    .select(cardSelection)
    .eq("seller_id", user.id)
    .neq("status", "draft")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Unable to load seller listings", { code: error.code });
    return { products: [], error: "unavailable" };
  }

  return {
    products: await mapListingCards(
      supabase,
      (data ?? []) as unknown as ListingCardRow[],
      new Set<string>(),
      user.id,
    ),
    error: null,
  };
}

export async function getFavoriteListings(
  requestedPage = 1,
): Promise<FavoriteListingsResult> {
  const { supabase, user } = await requireVerifiedActiveStudent("/favorites");
  const page =
    Number.isSafeInteger(requestedPage) &&
    requestedPage >= 1 &&
    requestedPage <= FAVORITES_MAX_PAGE
      ? requestedPage
      : 1;
  const offset = (page - 1) * FAVORITES_PAGE_SIZE;
  const {
    data: favorites,
    error: favoriteError,
    count,
  } = await supabase
    .from("favorites")
    // Keep hidden or unavailable listings out before count/range pagination.
    // The inner relation also applies the listings table's RLS policy.
    .select("listing_id, created_at, listings!inner()", { count: "exact" })
    .eq("user_id", user.id)
    .in("listings.status", ["available", "reserved"])
    .order("created_at", { ascending: false })
    .order("listing_id", { ascending: false })
    .range(offset, offset + FAVORITES_PAGE_SIZE - 1);

  if (favoriteError) {
    console.warn("Unable to load favorites", { code: favoriteError.code });
    return {
      products: [],
      totalCount: 0,
      page,
      pageSize: FAVORITES_PAGE_SIZE,
      error: "unavailable",
    };
  }

  const listingIds = (favorites ?? []).flatMap((favorite) =>
    typeof favorite.listing_id === "string" ? [favorite.listing_id] : [],
  );
  if (listingIds.length === 0) {
    return {
      products: [],
      totalCount: count ?? 0,
      page,
      pageSize: FAVORITES_PAGE_SIZE,
      error: null,
    };
  }

  const { data, error } = await supabase
    .from("listings")
    .select(cardSelection)
    .in("id", listingIds)
    .in("status", ["available", "reserved"])
    .order("is_cover", {
      referencedTable: "listing_images",
      ascending: false,
    })
    .order("sort_order", {
      referencedTable: "listing_images",
      ascending: true,
    })
    .limit(1, { referencedTable: "listing_images" });

  if (error) {
    console.warn("Unable to load favorite listings", { code: error.code });
    return {
      products: [],
      totalCount: 0,
      page,
      pageSize: FAVORITES_PAGE_SIZE,
      error: "unavailable",
    };
  }

  const orderedListings = orderListingsByFavoriteIds(
    listingIds,
    (data ?? []) as unknown as ListingCardRow[],
  );

  return {
    products: await mapListingCards(
      supabase,
      orderedListings,
      new Set(listingIds),
      user.id,
    ),
    totalCount: count ?? 0,
    page,
    pageSize: FAVORITES_PAGE_SIZE,
    error: null,
  };
}

function getAvatarUrl(
  supabase: AuthorizedAccessContext["supabase"],
  sellerId: string,
  avatarPath: string | null,
) {
  if (!avatarPath || !avatarPath.startsWith(`${sellerId}/`)) return null;
  return supabase.storage.from("avatars").getPublicUrl(avatarPath).data.publicUrl;
}

export async function getListingDetails(
  listingId: string,
): Promise<ListingDetailsResult> {
  const { supabase, user } = await requireVerifiedActiveStudent(
    `/listing/${listingId}`,
  );
  const { data, error } = await supabase
    .from("listings")
    .select(`
      id, seller_id, title, description, price, condition, status,
      created_at, updated_at,
      category:categories (id, name),
      listing_images (storage_path, is_cover, sort_order)
    `)
    .eq("id", listingId)
    .maybeSingle();

  if (error) {
    console.warn("Unable to load listing details", { code: error.code });
    return { listing: null, error: "unavailable" };
  }
  if (!data) return { listing: null, error: "not_found" };

  const listing = data as unknown as ListingDetailsRow;
  const isOwner = listing.seller_id === user.id;
  const [sellerResult, favoriteResult, reservationResult, conversationResult] =
    await Promise.all([
      supabase
        .from("marketplace_profiles")
        .select("id, full_name, course, year_level, avatar_path, verification_status")
        .eq("id", listing.seller_id)
        .maybeSingle(),
      isOwner
        ? Promise.resolve({ data: null, error: null })
        : supabase
            .from("favorites")
            .select("listing_id")
            .eq("user_id", user.id)
            .eq("listing_id", listingId)
            .maybeSingle(),
      isOwner
        ? Promise.resolve({ data: null, error: null })
        : supabase
            .from("reservations")
            .select("id, status")
            .eq("listing_id", listingId)
            .eq("buyer_id", user.id)
            .in("status", ["pending", "accepted"])
            .maybeSingle(),
      isOwner
        ? Promise.resolve({ data: null, error: null })
        : supabase
            .from("conversations")
            .select("id")
            .eq("listing_id", listingId)
            .eq("buyer_id", user.id)
            .maybeSingle(),
    ]);

  if (
    sellerResult.error ||
    !sellerResult.data ||
    favoriteResult.error ||
    reservationResult.error ||
    conversationResult.error
  ) {
    console.warn("Unable to load related listing details");
    return { listing: null, error: "unavailable" };
  }

  const seller = sellerResult.data as SellerProfileRow;
  const orderedImages = sortListingImages(listing.listing_images);
  const { urls, hasError } = await signListingImagePaths(
    supabase,
    orderedImages.map((image) => image.storage_path),
  );
  if (hasError) return { listing: null, error: "unavailable" };

  const statusValue = toListingStatus(listing.status);

  return {
    listing: {
      id: listing.id,
      sellerId: listing.seller_id,
      title: listing.title,
      description: listing.description,
      price: formatListingPrice(listing.price),
      condition: formatListingCondition(listing.condition),
      status: getListingStatusLabel(statusValue),
      statusValue,
      categoryName: getCategoryName(listing.category),
      createdAt: listing.created_at,
      updatedAt: listing.updated_at,
      isOwner,
      isFavorited: Boolean(favoriteResult.data),
      activeReservation: reservationResult.data
        ? { id: String(reservationResult.data.id), status: String(reservationResult.data.status) }
        : null,
      existingConversationId:
        typeof conversationResult.data?.id === "string"
          ? conversationResult.data.id
          : null,
      seller: {
        id: seller.id,
        fullName: seller.full_name,
        course: seller.course,
        yearLevel: seller.year_level,
        avatarUrl: getAvatarUrl(supabase, seller.id, seller.avatar_path),
        isVerified: seller.verification_status === "verified",
      },
      images: orderedImages.flatMap((image, index) => {
        const src = urls.get(image.storage_path);
        return src
          ? [{
              src,
              alt: `${listing.title} photo ${index + 1}`,
              isCover: image.is_cover,
              sortOrder: image.sort_order,
            }]
          : [];
      }),
    },
    error: null,
  };
}

export async function getOwnedListingForEdit(
  listingId: string,
): Promise<OwnedListingForEditResult> {
  const { supabase, user } = await requireVerifiedActiveStudent(
    `/listing/${listingId}/edit`,
  );
  const { data, error } = await supabase
    .from("listings")
    .select(`
      id, seller_id, category_id, title, description, price, condition,
      status, created_at, updated_at,
      listing_images (id, storage_path, is_cover, sort_order)
    `)
    .eq("id", listingId)
    .eq("seller_id", user.id)
    .maybeSingle();

  if (error) {
    console.warn("Unable to load listing for edit", { code: error.code });
    return { listing: null, error: "unavailable" };
  }
  if (!data) return { listing: null, error: "not_found" };

  const listing = data as unknown as OwnedListingEditRow;
  const status = toListingStatus(listing.status);
  if (status !== "available" && status !== "reserved") {
    return { listing: null, error: "not_editable" };
  }

  const orderedImages = sortListingImages(listing.listing_images);
  const { urls, hasError } = await signListingImagePaths(
    supabase,
    orderedImages.map((image) => image.storage_path),
  );
  if (hasError) return { listing: null, error: "unavailable" };

  return {
    listing: {
      id: listing.id,
      title: listing.title,
      description: listing.description,
      categoryId: listing.category_id,
      price: Number(listing.price).toFixed(2),
      condition: listing.condition,
      status,
      createdAt: listing.created_at,
      updatedAt: listing.updated_at,
      images: orderedImages.flatMap((image, index) => {
        const src = urls.get(image.storage_path);
        return src && image.id
          ? [{
              id: image.id,
              storagePath: image.storage_path,
              src,
              alt: `${listing.title} photo ${index + 1}`,
              isCover: image.is_cover,
              sortOrder: image.sort_order,
            }]
          : [];
      }),
    },
    error: null,
  };
}
