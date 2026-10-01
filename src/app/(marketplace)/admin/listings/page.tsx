import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  AdminFilterNav,
  AdminLoadError,
  AdminPageHeader,
  AdminPagination,
  AdminStatusBadge,
  adminHref,
  adminPageNumber,
  formatAdminDate,
  formatAdminPrice,
  oneQueryValue,
} from "@/features/moderation/components/admin-ui";
import { getAdminSearch } from "@/features/moderation/rules";
import { getAdminListings } from "@/features/moderation/server/queries";
import { requireActiveAdmin } from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Listings | UC Marketplace Admin",
};

const statuses = [
  ["all", "All"],
  ["available", "Available"],
  ["reserved", "Reserved"],
  ["sold", "Sold"],
  ["draft", "Draft"],
  ["removed", "Removed"],
] as const;

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; page?: string | string[]; q?: string | string[] }>;
}) {
  await requireActiveAdmin("/admin/listings");
  const params = await searchParams;
  const status = statuses.find(([value]) => value === oneQueryValue(params.status))?.[0] ?? "all";
  const page = adminPageNumber(params.page);
  const query = getAdminSearch(oneQueryValue(params.q));
  const data = await getAdminListings({ status, page, query });
  const filters = { status: status === "all" ? undefined : status, q: query || undefined };

  if (!data.error && page > data.pageCount) {
    redirect(adminHref("/admin/listings", filters, data.pageCount));
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-12">
      <AdminPageHeader
        title="Listings"
        description="Inspect item details and seller context before removing a listing. Removal is a separate action from closing its reports."
      />

      <form action="/admin/listings" method="get" role="search" className="flex flex-wrap gap-3">
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        <label htmlFor="admin-listing-search" className="sr-only">Search listings</label>
        <input id="admin-listing-search" name="q" type="search" defaultValue={query} maxLength={80} placeholder="Search listings" className="min-h-11 w-full max-w-md rounded-md border border-[#c4c5d5] bg-white px-4 text-sm outline-none focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15" />
        <button type="submit" className="min-h-11 rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576]">Search</button>
        {query && <Link href={adminHref("/admin/listings", { status: filters.status })} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-[#0038a8] hover:underline">Clear search</Link>}
      </form>

      <AdminFilterNav label="Filter listings by status" path="/admin/listings" selected={status} parameter="status" options={statuses} otherFilters={{ q: query || undefined }} />

      {data.error ? (
        <AdminLoadError subject="listings" retryHref={adminHref("/admin/listings", filters, page)} />
      ) : data.items.length === 0 ? (
        <p className="rounded-xl border border-[#c4c5d5] bg-white p-8 text-center text-sm text-[#444653]">No listings match these filters.</p>
      ) : (
        <>
          <p className="text-sm text-[#444653]">{data.totalCount} {data.totalCount === 1 ? "listing" : "listings"} found</p>
          <ul className="grid gap-3">
            {data.items.map((listing) => (
              <li key={listing.id} className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="break-words text-lg font-bold text-[#121c2a]">{listing.title}</h2>
                    <p className="mt-1 text-sm text-[#444653]">Seller: {listing.sellerName || "Name unavailable"}</p>
                  </div>
                  <div className="flex items-center gap-3"><AdminStatusBadge status={listing.status} /><span className="font-semibold text-[#002576]">{formatAdminPrice(listing.price)}</span></div>
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-6 text-[#444653]">{listing.description}</p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#e4e4ec] pt-4 text-sm">
                  <span className="text-[#444653]">Posted {formatAdminDate(listing.createdAt)}</span>
                  <Link href={`/admin/listings/${listing.id}`} className="inline-flex min-h-10 items-center font-semibold text-[#0038a8] hover:underline">Review listing</Link>
                </div>
              </li>
            ))}
          </ul>
          <AdminPagination path="/admin/listings" filters={filters} page={data.page} pageCount={data.pageCount} totalCount={data.totalCount} />
        </>
      )}
    </main>
  );
}
