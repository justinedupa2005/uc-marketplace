import type { ReactNode } from "react";
import Link from "next/link";

import { logout } from "@/features/auth/actions";

import { AdminNavigation } from "@/features/moderation/components/admin-navigation";
import { requireActiveAdmin } from "./verifications/admin-access";

export default async function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  await requireActiveAdmin();

  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      <header className="border-b border-[#c4c5d5] bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/admin" className="text-lg font-bold text-[#002576]">
            UC Marketplace <span className="font-medium text-[#444653]">Admin</span>
          </Link>
          <div className="flex items-center gap-4 text-sm font-semibold">
            <Link href="/profile" className="text-[#444653] hover:text-[#002576]">
              Profile
            </Link>
            <form action={logout}>
              <button type="submit" className="font-semibold text-[#ba1a1a] hover:underline">
                Log Out
              </button>
            </form>
          </div>
        </div>
        <AdminNavigation />
      </header>
      {children}
    </div>
  );
}
