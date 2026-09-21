import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getSafeNextPath } from "@/lib/auth/redirects";
import { getValidatedUser, hasRecoveryMarker } from "@/lib/auth/server";

type MarketplaceLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function MarketplaceLayout({
  children,
}: MarketplaceLayoutProps) {
  const { supabase, user } = await getValidatedUser();

  if (!user) {
    const requestedPath = (await headers()).get("x-uc-marketplace-path");
    const nextPath = getSafeNextPath(requestedPath);
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  if (await hasRecoveryMarker(user.id)) {
    redirect("/reset-password");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || profile.account_status !== "active") {
    redirect("/account-status");
  }

  return children;
}
