"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAuthenticatedProfile } from "@/lib/auth/authorization";

export type NotificationActionResult = {
  ok: boolean;
  message: string;
  notificationId?: string;
  unreadCount?: number;
};

function refreshNotificationViews() {
  // The bell is rendered in shared layouts as well as restricted account
  // headers. Refresh the current user's router tree after acknowledging events.
  revalidatePath("/", "layout");
}

export async function markNotificationRead(
  notificationId: string,
): Promise<NotificationActionResult> {
  const parsedId = z.string().uuid().safeParse(notificationId);
  if (!parsedId.success) return { ok: false, message: "Choose a valid notification." };
  const { supabase } = await requireAuthenticatedProfile("/notifications");
  const { data, error } = await supabase.rpc("mark_notification_read", {
    p_notification_id: parsedId.data,
  });
  if (error || data !== true) {
    if (error) console.warn("Unable to mark notification read", { code: error.code });
    return { ok: false, message: "Unable to mark this notification as read. Refresh and try again." };
  }
  refreshNotificationViews();
  return { ok: true, notificationId: parsedId.data, message: "Notification marked as read." };
}

export async function markAllNotificationsRead(
  snapshotAt: string,
): Promise<NotificationActionResult> {
  const parsed = z.string().datetime({ offset: true }).safeParse(snapshotAt);
  if (!parsed.success) return { ok: false, message: "Refresh your notifications and try again." };
  const { supabase } = await requireAuthenticatedProfile("/notifications");
  const { data, error } = await supabase.rpc("mark_all_notifications_read", {
    p_before: parsed.data,
  });
  if (error || typeof data !== "number" || !Number.isSafeInteger(data) || data < 0) {
    console.warn("Unable to mark notifications read", { code: error?.code ?? "invalid" });
    return { ok: false, message: "Unable to mark notifications as read. Refresh and try again." };
  }
  refreshNotificationViews();
  return { ok: true, message: data > 0 ? "Notifications marked as read." : "Your notifications are already up to date." };
}
