import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AccessRefresh } from "@/components/access-refresh";
import { MobileNavigation } from "@/components/layout/mobile-navigation";
import { Navbar } from "@/components/layout/navbar";
import {
  getAuthorizedDestination,
  isVerifiedActiveStudent,
  requireActiveProfile,
  requireAuthenticatedProfile,
} from "@/lib/auth/authorization";
import { getSafeNextPath } from "@/lib/auth/redirects";

import { NotificationBell } from "./notification-bell";

type MarketplaceLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function MarketplaceLayout({
  children,
}: MarketplaceLayoutProps) {
  const requestedPath = getSafeNextPath(
    (await headers()).get("x-uc-marketplace-path"),
  );
  const isNotificationInbox = requestedPath.split("?", 1)[0] === "/notifications";
  const access = isNotificationInbox
    ? await requireAuthenticatedProfile(requestedPath)
    : await requireActiveProfile(requestedPath);
  const authorizedDestination = getAuthorizedDestination(
    access.profile,
    requestedPath,
  );

  if (authorizedDestination !== requestedPath) {
    redirect(authorizedDestination);
  }

  const showMarketplaceNavigation = isVerifiedActiveStudent(access.profile);

  return (
    <>
      <AccessRefresh />
      {showMarketplaceNavigation && (
        <Navbar notificationBell={<NotificationBell />} />
      )}
      {children}
      {showMarketplaceNavigation && <MobileNavigation />}
    </>
  );
}
