import "server-only";

import { Suspense } from "react";

import { NotificationBellLink } from "@/components/layout/notification-bell-link";
import { getUnreadNotificationCount } from "@/features/notifications/server/queries";

async function CountedNotificationBell() {
  return <NotificationBellLink unreadCount={await getUnreadNotificationCount()} />;
}

// Compose server data and shared UI at the route boundary. Neither the shared
// header nor the notification data service needs to import the other layer.
export function NotificationBell() {
  return (
    <Suspense fallback={<NotificationBellLink unreadCount={null} />}>
      <CountedNotificationBell />
    </Suspense>
  );
}
