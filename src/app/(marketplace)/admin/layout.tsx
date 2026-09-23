import type { ReactNode } from "react";
import Link from "next/link";

import { logout } from "@/app/auth/actions";

import { requireActiveAdmin } from "./verifications/admin-access";

export default async function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  await requireActiveAdmin();

  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      <header className="border-b border-[#c4c5d5] bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/admin/verifications" className="text-lg font-bold text-[#002576]">
            UC Marketplace <span className="font-medium text-[#444653]">Admin</span>
          </Link>
          <nav aria-label="Admin navigation" className="flex flex-wrap items-center gap-4 text-sm font-semibold">
            <Link href="/admin/verifications" className="text-[#002576] hover:underline">
              Verifications
            </Link>
            <Link href="/profile" className="text-[#444653] hover:text-[#002576]">
              Profile
            </Link>
            <form action={logout}>
              <button type="submit" className="font-semibold text-[#ba1a1a] hover:underline">
                Log Out
              </button>
            </form>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
