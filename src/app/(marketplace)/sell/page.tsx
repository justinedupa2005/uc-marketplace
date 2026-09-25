import type { Metadata } from "next";

import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

import { SellForm, type SellCategory } from "./sell-form";

export const metadata: Metadata = {
  title: "Sell an Item | UC Marketplace",
  description: "Create a new student marketplace listing.",
};

export default async function SellPage() {
  const { supabase } = await requireVerifiedActiveStudent("/sell");
  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.warn("Unable to load sell-page categories", { code: error.code });
  }

  const categories: SellCategory[] = error
    ? []
    : (data ?? []).flatMap((category) =>
        typeof category.id === "string" && typeof category.name === "string"
          ? [{ id: category.id, name: category.name }]
          : [],
      );

  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      <main className="mx-auto w-full max-w-3xl px-5 pb-28 pt-7 sm:px-6 sm:pt-10 md:pb-14">
        <header>
          <p className="text-sm font-bold uppercase tracking-[0.08em] text-[#0038a8]">
            Student Marketplace
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-[-0.02em] sm:text-4xl">
            Sell an Item
          </h1>
          <p className="mt-3 max-w-xl text-base leading-6 text-[#444653]">
            Create a clear, honest listing so another verified UC student can
            discover your item and arrange a safe campus meetup.
          </p>
        </header>

        <SellForm
          categories={categories}
          categoryLoadError={Boolean(error)}
          submissionId={crypto.randomUUID()}
        />
      </main>
    </div>
  );
}
