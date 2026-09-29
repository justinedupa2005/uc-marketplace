export const NOTIFICATION_TYPES = [
  "message",
  "reservation_requested",
  "reservation_accepted",
  "reservation_rejected",
  "reservation_cancelled",
  "meetup_scheduled",
  "meetup_updated",
  "sale_completed",
  "verification_approved",
  "verification_rejected",
  "listing_removed",
  "account_suspended",
  "account_reactivated",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const NOTIFICATIONS_PAGE_SIZE = 20;
const MAX_NOTIFICATION_PAGE = 100_000;
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function isNotificationType(value: string): value is NotificationType {
  return NOTIFICATION_TYPES.some((type) => type === value);
}

export function getNotificationPage(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || !/^[1-9]\d*$/.test(first)) return 1;
  const page = Number(first);
  return Number.isSafeInteger(page) && page <= MAX_NOTIFICATION_PAGE ? page : 1;
}

export function getNotificationsPageHref(page: number) {
  return Number.isSafeInteger(page) && page > 1 && page <= MAX_NOTIFICATION_PAGE
    ? `/notifications?page=${page}`
    : "/notifications";
}

// Destinations are allowlisted application routes, never URLs from a row.
// Deleted entities have null references and remain readable without a dead link.
export function getNotificationDestination(notification: {
  type: string;
  conversationId: string | null;
  reservationId: string | null;
}) {
  const { type, conversationId, reservationId } = notification;
  if (type === "message") {
    return conversationId && UUID_PATTERN.test(conversationId)
      ? `/messages/${conversationId}`
      : null;
  }
  if (
    type === "reservation_requested" || type === "reservation_accepted" ||
    type === "reservation_rejected" || type === "reservation_cancelled" ||
    type === "meetup_scheduled" || type === "meetup_updated" ||
    type === "sale_completed"
  ) {
    return reservationId && UUID_PATTERN.test(reservationId)
      ? `/reservations/${reservationId}`
      : null;
  }
  switch (type) {
    case "verification_approved":
    case "account_reactivated":
      return "/profile";
    case "verification_rejected":
      return "/verification";
    case "listing_removed":
      return "/my-listings";
    case "account_suspended":
      return "/account-status";
    default:
      return null;
  }
}
