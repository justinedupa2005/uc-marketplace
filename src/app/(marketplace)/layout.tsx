import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AccessRefresh } from "@/components/access-refresh";
import { MobileNavigation } from "@/components/mobile-navigation";
import { Navbar } from "@/components/navbar";
import {
  getAuthorizedDestination,
  isVerifiedActiveStudent,
  requireActiveProfile,
} from "@/lib/auth/authorization";
import { getSafeNextPath } from "@/lib/auth/redirects";

type MarketplaceLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function MarketplaceLayout({
  children,
}: MarketplaceLayoutProps) {
  const requestedPath = getSafeNextPath(
    (await headers()).get("x-uc-marketplace-path"),
  );
  const access = await requireActiveProfile(requestedPath);
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
      {showMarketplaceNavigation && <Navbar />}
      {children}
      {showMarketplaceNavigation && <MobileNavigation />}
    </>
  );
}
