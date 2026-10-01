import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AdminDetailRow,
  AdminLoadError,
  AdminStatusBadge,
  formatAdminDate,
  formatAdminPrice,
  isAdminUuid,
} from "@/features/moderation/components/admin-ui";
import { ListingModerationControls } from "@/features/moderation/components/moderation-action-dialog";
import { getAdminListing } from "@/features/moderation/server/queries";
import { requireActiveAdmin } from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Review Listing | UC Marketplace Admin",
};

export default async function AdminListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireActiveAdmin("/admin/listings");
  const { id } = await params;
  if (!isAdminUuid(id)) notFound();
  const { item: listing, error } = await getAdminListing(id);

  if (error) {
    return <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12"><AdminLoadError subject="this listing" retryHref={`/admin/listings/${id}`} /></main>;
  }
  if (!listing) notFound();

  const imageUrls = listing.imageUrls.filter((url) => url.startsWith("https://") || url.startsWith("/"));

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-5 py-8 sm:px-8 sm:py-12">
      <div>
        <Link href="/admin/listings" className="text-sm font-semibold text-[#0038a8] hover:underline">← Back to listings</Link>
        <h1 className="mt-4 break-words text-3xl font-bold tracking-tight text-[#002576]">{listing.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3"><AdminStatusBadge status={listing.status} /><span className="font-semibold text-[#121c2a]">{formatAdminPrice(listing.price)}</span></div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)]">
        <section aria-labelledby="listing-content-heading" className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
          <h2 id="listing-content-heading" className="text-xl font-bold">Listing content</h2>
          <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-[#444653]">{listing.description}</p>
          {imageUrls.length > 0 ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {imageUrls.slice(0, 6).map((url, index) => (
                <div key={`${url}-${index}`} className="relative aspect-[4/3] overflow-hidden rounded-lg border border-[#e4e4ec] bg-[#f2f3f8]">
                  <Image src={url} alt={`Image ${index + 1} for ${listing.title}`} fill sizes="(max-width: 640px) 100vw, 50vw" className="object-contain" unoptimized />
                </div>
              ))}
            </div>
          ) : <p className="mt-5 text-sm text-[#444653]">No listing images are available.</p>}
        </section>

        <section aria-labelledby="listing-context-heading" className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
          <h2 id="listing-context-heading" className="mb-4 text-xl font-bold">Review context</h2>
          <dl>
            <AdminDetailRow label="Status" value={<AdminStatusBadge status={listing.status} />} />
            <AdminDetailRow label="Condition" value={listing.condition.replaceAll("_", " ")} />
            <AdminDetailRow label="Price" value={formatAdminPrice(listing.price)} />
            <AdminDetailRow label="Created" value={formatAdminDate(listing.createdAt)} />
            <AdminDetailRow label="Updated" value={formatAdminDate(listing.updatedAt)} />
            <AdminDetailRow label="Seller" value={<Link href={`/admin/users/${listing.sellerId}`} className="font-semibold text-[#0038a8] hover:underline">{listing.sellerName || "View account"}</Link>} />
          </dl>
        </section>
      </div>

      <section aria-labelledby="listing-action-heading" className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
        <h2 id="listing-action-heading" className="text-xl font-bold">Listing action</h2>
        <p className="mt-2 text-sm leading-6 text-[#444653]">Remove only when the listing violates marketplace rules. This action does not resolve any reports automatically.</p>
        <div className="mt-5"><ListingModerationControls listingId={listing.id} status={listing.status} /></div>
      </section>
    </main>
  );
}
