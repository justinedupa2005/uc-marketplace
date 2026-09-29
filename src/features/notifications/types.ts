import type { NotificationType } from "@/features/notifications/rules";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  listingId: string | null;
  conversationId: string | null;
  reservationId: string | null;
  meetupId: string | null;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
};

export type NotificationsResult = {
  notifications: NotificationItem[];
  totalCount: number;
  unreadCount: number;
  snapshotAt: string;
  page: number;
  pageCount: number;
  error: boolean;
};
