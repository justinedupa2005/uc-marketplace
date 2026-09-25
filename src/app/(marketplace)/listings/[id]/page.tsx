import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { FormNotification } from "@/components/form-notification";
import { Badge } from "@/components/ui/badge";
import { getListingDetails } from "@/lib/listings";

export const metadata: Metadata = {
  title: "Listing Details | UC Marketplace",
  description: "View an item listed by a verified UC Main student.",
};

const listingIdSchema = z.string().uuid();

function getStatusTone(
  status: "Available" | "Reserved" | "Sold" | "Removed" | "Draft",
) {
  if (status === "Available") {
    return "available" as const;
  }

  if (status === "Reserved" || status === "Draft") {
    return "pending" as const;
  }

  return "neutral" as const;
}

export default async function ListingDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  if (!listingIdSchema.safeParse(id).success) {
    notFound();
  }

  const result = await getListingDetails(id);

  if (result.error !== null) {
    if (result.error === "not_found") {
      notFound();
    }

    throw new Error("Unable to load listing details.");
  }

  const { listing } = result;
  const formattedDate = new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
  }).format(new Date(listing.createdAt));
  const wasCreated = query.created === "1" && listing.isOwner;

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-6 pb-28 pt-6 text-[#121c2a] md:pb-12 md:pt-10">
      <article className="mx-auto w-full max-w-[1100px]">
        {wasCreated && (
          <div className="mb-4">
            <FormNotification variant="success">
              Your listing has been published successfully!
            </FormNotification>
          </div>
        )}

        <Link
          href="/marketplace"
          className="inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-[#0038a8] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
        >
          <span aria-hidden="true">&larr;</span>
          <span className="ml-2">Back to Marketplace</span>
        </Link>

        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-start">
          <section aria-label="Product images">
            {listing.images.length > 0 ? (
              <div className="space-y-3">
                <div className="relative aspect-square overflow-hidden rounded-2xl border border-[#c4c5d5] bg-[#d9e3f7] sm:aspect-[4/3]">
                  <Image
                    src={listing.images[0].src}
                    alt={listing.images[0].alt}
                    fill
                    unoptimized
                    priority
                    sizes="(max-width: 1023px) 100vw, 60vw"
                    className="object-contain"
                  />
                </div>

                {listing.images.length > 1 && (
                  <ul
                    aria-label="Additional product images"
                    className="grid grid-cols-4 gap-3 sm:grid-cols-5"
                  >
                    {listing.images.map((image) => (
                      <li key={`${image.sortOrder}-${image.src}`}>
                        <div className="relative aspect-square overflow-hidden rounded-lg border border-[#c4c5d5] bg-[#d9e3f7]">
                          <Image
                            src={image.src}
                            alt={image.alt}
                            fill
                            unoptimized
                            sizes="(max-width: 639px) 25vw, 130px"
                            className="object-cover"
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-2xl border border-[#c4c5d5] bg-[#d9e3f7] sm:aspect-[4/3]">
                <p className="text-sm font-medium text-[#444653]">
                  No product image is available.
                </p>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[#c4c5d5] bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{listing.condition}</Badge>
              <Badge tone={getStatusTone(listing.status)}>{listing.status}</Badge>
              {listing.isOwner && <Badge tone="neutral">Your Listing</Badge>}
            </div>

            <h1 className="mt-5 text-3xl font-bold tracking-[-0.02em] text-[#121c2a] sm:text-4xl">
              {listing.title}
            </h1>
            <p className="mt-4 text-3xl font-bold text-[#002576]">
              {listing.price}
            </p>

            <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-[#e1e2ea] py-5 text-sm">
              <div>
                <dt className="font-medium text-[#444653]">Category</dt>
                <dd className="mt-1 font-semibold text-[#121c2a]">
                  {listing.categoryName}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[#444653]">Listed</dt>
                <dd className="mt-1 font-semibold text-[#121c2a]">
                  {formattedDate}
                </dd>
              </div>
            </dl>

            <section aria-labelledby="listing-description" className="mt-6">
              <h2
                id="listing-description"
                className="text-lg font-bold text-[#121c2a]"
              >
                Description
              </h2>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-[#444653]">
                {listing.description}
              </p>
            </section>

            {!listing.isOwner && listing.status === "Available" && (
              <div className="mt-8 rounded-xl bg-[#eff3ff] p-4 text-sm leading-6 text-[#444653]">
                Messaging and reservations will be available in a later
                marketplace step.
              </div>
            )}
          </section>
        </div>
      </article>
    </main>
  );
}
