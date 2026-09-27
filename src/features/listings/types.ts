import type { ListingStatus, ListingStatusLabel } from "@/features/listings/rules";
import type {
  MarketplaceCondition,
  MarketplaceSort,
} from "@/features/listings/search-params";

export type MarketplaceProduct = {
  id: string;
  title: string;
  price: string;
  condition: string;
  status: ListingStatusLabel;
  statusValue: ListingStatus;
  categoryName: string;
  createdAt: string;
  image: string | null;
  imageAlt: string;
  isFavorited: boolean;
  isOwner: boolean;
};

export type MarketplaceCategory = {
  id: string;
  name: string;
  slug: string;
};

export type ListingCategoryOption = Pick<MarketplaceCategory, "id" | "name">;

export type MarketplaceBrowseOptions = {
  search?: string;
  categoryId?: string;
  condition?: MarketplaceCondition;
  minPrice?: number;
  maxPrice?: number;
  sort?: MarketplaceSort;
  page?: number;
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
  status: ListingStatusLabel;
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
