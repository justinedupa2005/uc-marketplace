import type { ReactNode } from "react";

import { AppHeader } from "@/components/layout/app-header";
import {
  getAuthorizedDestination,
  isVerifiedActiveStudent,
  requireAuthenticatedProfile,
} from "@/lib/auth/authorization";

import { NotificationBell } from "../notification-bell";

export default async function NotificationsLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAuthenticatedProfile("/notifications");

  return (
    <>
      {!isVerifiedActiveStudent(profile) && (
        <AppHeader
          notificationBell={<NotificationBell />}
          variant="back"
          title="Notifications"
          backHref={getAuthorizedDestination(profile)}
          showLogout
          showMarketplaceNavigation={false}
        />
      )}
      {children}
    </>
  );
}
