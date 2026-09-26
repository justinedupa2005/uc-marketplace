import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";
import { getOwnedListingForEdit } from "@/lib/listings";

import { EditListingForm, type EditCategory } from "./edit-form";

export const metadata: Metadata = {
  title: "Edit Listing | UC Marketplace",
  description: "Update an item you listed on UC Marketplace.",
};

const listingIdSchema = z.string().uuid();

export default async function EditListingPage({ params }: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!listingIdSchema.safeParse(id).success) notFound();

  const result = await getOwnedListingForEdit(id);
  if (result.error === "not_found") notFound();
  if (result.error === "not_editable") redirect(`/listing/${id}`);
  if (result.error) throw new Error("Unable to load the listing editor.");

  const { supabase } = await requireVerifiedActiveStudent(`/listing/${id}/edit`);
  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true });
  const categories: EditCategory[] = error
    ? []
    : (data ?? []).flatMap((category) =>
        typeof category.id === "string" && typeof category.name === "string"
          ? [{ id: category.id, name: category.name }]
          : [],
      );

  if (error) console.warn("Unable to load edit-page categories", { code: error.code });

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-7 text-[#121c2a] sm:px-6 sm:pt-10 md:pb-14">
      <div className="mx-auto w-full max-w-3xl">
        <Link href={`/listing/${id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-[#0038a8] hover:underline">← Back to listing</Link>
        <header className="mt-3">
          <p className="text-sm font-bold uppercase tracking-[0.08em] text-[#0038a8]">My Items</p>
          <h1 className="mt-1 text-3xl font-bold tracking-[-0.02em] sm:text-4xl">Edit Listing</h1>
          <p className="mt-3 max-w-xl text-base leading-6 text-[#444653]">Update the details and image order buyers see.</p>
        </header>

        <EditListingForm
          listing={result.listing}
          categories={categories}
          categoryLoadError={Boolean(error)}
        />
      </div>
    </main>
  );
}
