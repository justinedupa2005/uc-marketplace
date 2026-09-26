import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { FormNotification } from "@/components/form-notification";
import { ConditionBadge, ListingStatusBadge } from "@/components/listing-badges";
import { ListingBuyerActions } from "@/components/listing-buyer-actions";
import { ListingImageGallery } from "@/components/listing-image-gallery";
import { ListingOwnerActions } from "@/components/listing-owner-actions";
import { SellerCard } from "@/components/seller-card";
import { getListingDetails } from "@/lib/listings";

export const metadata: Metadata = {
  title: "Listing Details | UC Marketplace",
  description: "View an item listed by a verified UC Main student.",
};

const listingIdSchema = z.string().uuid();

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getMarketplaceReturnPath(value: string | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value, "https://uc-marketplace.local");
    if (
      url.origin !== "https://uc-marketplace.local" ||
      url.pathname !== "/marketplace"
    ) {
      return null;
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export default async function ListingDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    created?: string | string[];
    updated?: string | string[];
    from?: string | string[];
  }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!listingIdSchema.safeParse(id).success) notFound();

  const result = await getListingDetails(id);
  if (result.error === "not_found") notFound();
  if (result.error) throw new Error("Unable to load listing details.");

  const { listing } = result;
  const wasCreated = query.created === "1" && listing.isOwner;
  const wasUpdated = query.updated === "1" && listing.isOwner;
  const hasMeaningfulUpdate = listing.updatedAt !== listing.createdAt;
  const marketplaceReturnPath = getMarketplaceReturnPath(firstValue(query.from));
  const backHref = marketplaceReturnPath ??
    (listing.isOwner ? "/my-listings" : "/marketplace");
  const backLabel = marketplaceReturnPath
    ? "Back to Marketplace"
    : listing.isOwner
      ? "Back to My Items"
      : "Back to Marketplace";

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-6 text-[#121c2a] sm:px-6 md:pb-12 md:pt-10">
      <article className="mx-auto w-full max-w-[1100px]">
        {(wasCreated || wasUpdated) && (
          <div className="mb-4">
            <FormNotification variant="success">
              {wasCreated
                ? "Your listing has been published successfully!"
                : "Your listing changes were saved."}
            </FormNotification>
          </div>
        )}

        <Link
          href={backHref}
          className="inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-[#0038a8] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
        >
          <span aria-hidden="true">&larr;</span>
          <span className="ml-2">{backLabel}</span>
        </Link>

        {listing.statusValue === "removed" && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            This listing is removed and is visible only in your listing history.
          </div>
        )}

        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-start">
          <section aria-label="Product images">
            <ListingImageGallery images={listing.images} title={listing.title} />
          </section>

          <section className="rounded-2xl border border-[#c4c5d5] bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <ConditionBadge condition={listing.condition} />
              <ListingStatusBadge status={listing.statusValue} />
              {listing.isOwner && (
                <span className="rounded-full bg-[#e6eeff] px-2.5 py-1 text-xs font-semibold text-[#002576]">
                  Your Listing
                </span>
              )}
            </div>

            <h1 className="mt-5 break-words text-3xl font-bold tracking-[-0.02em] sm:text-4xl">
              {listing.title}
            </h1>
            <p className="mt-4 text-3xl font-bold text-[#002576]">{listing.price}</p>

            <dl className="mt-6 grid grid-cols-1 gap-4 border-y border-[#e1e2ea] py-5 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-[#444653]">Category</dt>
                <dd className="mt-1 font-semibold">{listing.categoryName}</dd>
              </div>
              <div>
                <dt className="font-medium text-[#444653]">Date posted</dt>
                <dd className="mt-1 font-semibold">{formatDate(listing.createdAt)}</dd>
              </div>
              {hasMeaningfulUpdate && (
                <div className="sm:col-span-2">
                  <dt className="font-medium text-[#444653]">Last updated</dt>
                  <dd className="mt-1 font-semibold">{formatDate(listing.updatedAt)}</dd>
                </div>
              )}
            </dl>

            <section aria-labelledby="listing-description" className="mt-6">
              <h2 id="listing-description" className="text-lg font-bold">
                Description
              </h2>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-[#444653]">
                {listing.description}
              </p>
            </section>

            <SellerCard seller={listing.seller} />

            {listing.isOwner ? (
              <ListingOwnerActions
                listingId={listing.id}
                status={listing.statusValue}
              />
            ) : (
              <ListingBuyerActions
                listingId={listing.id}
                title={listing.title}
                status={listing.statusValue}
                initialIsFavorited={listing.isFavorited}
                activeReservation={listing.activeReservation}
                existingConversationId={listing.existingConversationId}
              />
            )}
          </section>
        </div>
      </article>
    </main>
  );
}
