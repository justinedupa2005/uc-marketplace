import type { ReactNode } from "react";

import { AppHeader } from "@/components/layout/app-header";
import { getAuthorizedDestination, isVerifiedActiveStudent, type AuthorizationProfile } from "@/lib/auth/authorization";

import { NotificationBell } from "../../notification-bell";

export function ProfileShell({
  authorization,
  title,
  backHref,
  children,
}: {
  authorization: AuthorizationProfile;
  title: string;
  backHref?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      {!isVerifiedActiveStudent(authorization) && (
        <AppHeader
          variant="back"
          title={title}
          backHref={backHref ?? getAuthorizedDestination(authorization)}
          notificationBell={<NotificationBell />}
          showLogout
          showMarketplaceNavigation={false}
        />
      )}
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 pb-28 pt-8 md:pb-12">
        {children}
      </main>
    </div>
  );
}
