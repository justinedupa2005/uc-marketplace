export const LISTING_STATUSES = [
  "draft",
  "available",
  "reserved",
  "sold",
  "removed",
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export type ListingStatusLabel =
  | "Draft"
  | "Available"
  | "Reserved"
  | "Sold"
  | "Removed";

const conditionLabels: Record<string, string> = {
  new: "New",
  like_new: "Like New",
  good: "Good",
  fair: "Fair",
};

export const listingStatusLabels: Record<
  ListingStatus,
  ListingStatusLabel
> = {
  draft: "Draft",
  available: "Available",
  reserved: "Reserved",
  sold: "Sold",
  removed: "Removed",
};

export function isListingStatus(value: string): value is ListingStatus {
  return LISTING_STATUSES.some((status) => status === value);
}

export function getListingStatusLabel(value: string): ListingStatusLabel {
  return isListingStatus(value) ? listingStatusLabels[value] : "Draft";
}

export function formatListingCondition(value: string) {
  return conditionLabels[value] ?? value;
}

export function isNormallyBrowsableListing(status: ListingStatus) {
  return status === "available" || status === "reserved";
}

export function canOwnerEditListing(status: ListingStatus) {
  return status === "available" || status === "reserved";
}

export function canOwnerMarkListingSold(status: ListingStatus) {
  return status === "available" || status === "reserved";
}

export function canOwnerRemoveListing(status: ListingStatus) {
  return status !== "removed" && status !== "draft";
}

export function canFavoriteListing(status: ListingStatus) {
  return status === "available" || status === "reserved";
}

export function canStartListingConversation(status: ListingStatus) {
  return status === "available" || status === "reserved";
}

export function canSendExistingConversation(status: string) {
  return status === "available" || status === "reserved" || status === "sold";
}

export function canRequestListingReservation(status: ListingStatus) {
  return status === "available";
}

export function canReportListing(status: ListingStatus) {
  return status === "available" || status === "reserved";
}
