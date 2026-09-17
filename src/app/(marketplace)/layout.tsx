import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type MarketplaceLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function MarketplaceLayout({
  children,
}: MarketplaceLayoutProps) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    redirect("/login");
  }

  return children;
}
