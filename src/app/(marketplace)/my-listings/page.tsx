import type { Metadata } from "next";
import Link from "next/link";

import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "My Items | UC Marketplace",
  description: "Manage your UC Marketplace listings.",
};

export default async function MyListingsPage() {
  await requireVerifiedActiveStudent("/my-listings");

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-6 pb-28 pt-10 text-[#121c2a] md:pb-12">
      <section className="mx-auto w-full max-w-5xl">
        <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#002576]">
          My Items
        </h1>
        <div className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-bold">No items to manage yet</h2>
          <p className="mt-2 text-sm leading-6 text-[#444653]">
            Listing creation and management will be connected in the next marketplace step.
          </p>
          <Link
            href="/sell"
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576]"
          >
            Sell an Item
          </Link>
        </div>
      </section>
    </main>
  );
}
