import "server-only";

import { cache } from "react";

import {
  getNotificationPage,
  isNotificationType,
  NOTIFICATIONS_PAGE_SIZE,
} from "@/features/notifications/rules";
import type { NotificationItem, NotificationsResult } from "@/features/notifications/types";
import {
  getCurrentAccessContext,
  requireAuthenticatedProfile,
} from "@/lib/auth/authorization";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  listing_id: string | null;
  conversation_id: string | null;
  reservation_id: string | null;
  meetup_id: string | null;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
};

const notificationSelection = "id,type,title,message,listing_id,conversation_id,reservation_id,meetup_id,is_read,created_at,read_at";

// React cache deduplicates the page/bell lookup within a request only; counts
// and identities are never shared between users or persisted across requests.
export const getNotificationState = cache(async () => {
  try {
    const access = await getCurrentAccessContext();
    if (!access.user || !access.profile) return null;
    const { data, error } = await access.supabase
      .rpc("get_my_notification_state", {})
      .single();
    const count = Number(data?.unread_count);
    if (error || !data || !Number.isSafeInteger(count) || count < 0) {
      console.warn("Unable to load notification count", { code: error?.code ?? "invalid" });
      return null;
    }
    return { unreadCount: count, snapshotAt: data.snapshot_at };
  } catch {
    // A badge outage must not break the surrounding marketplace/account page.
    console.warn("Unable to load notification count");
    return null;
  }
});

export async function getUnreadNotificationCount(): Promise<number | null> {
  return (await getNotificationState())?.unreadCount ?? null;
}

export async function getNotifications(requestedPage = 1): Promise<NotificationsResult> {
  const page = getNotificationPage(String(requestedPage));
  const { supabase, user } = await requireAuthenticatedProfile("/notifications");
  const state = await getNotificationState();
  const unavailable: NotificationsResult = {
    notifications: [], totalCount: 0, unreadCount: 0,
    snapshotAt: "", page, pageCount: 1, error: true,
  };
  if (!state) return unavailable;

  const offset = (page - 1) * NOTIFICATIONS_PAGE_SIZE;
  const { data, count, error } = await supabase
    .from("notifications")
    .select(notificationSelection, { count: "exact" })
    .eq("user_id", user.id)
    .lte("created_at", state.snapshotAt)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + NOTIFICATIONS_PAGE_SIZE - 1);
  if (error) {
    console.warn("Unable to load notifications", { code: error.code });
    return unavailable;
  }

  const notifications = (data ?? []).flatMap((row: NotificationRow): NotificationItem[] => {
    if (!isNotificationType(row.type)) return [];
    return [{
      id: row.id, type: row.type, title: row.title, message: row.message,
      listingId: row.listing_id, conversationId: row.conversation_id,
      reservationId: row.reservation_id, meetupId: row.meetup_id,
      isRead: row.is_read, createdAt: row.created_at, readAt: row.read_at,
    }];
  });
  const totalCount = count ?? 0;
  return {
    notifications, totalCount, ...state, page,
    pageCount: Math.max(1, Math.ceil(totalCount / NOTIFICATIONS_PAGE_SIZE)),
    error: false,
  };
}
