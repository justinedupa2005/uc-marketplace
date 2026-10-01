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
  oneQueryValue,
} from "@/features/moderation/components/admin-ui";
import { getAdminSearch } from "@/features/moderation/rules";
import { getAdminUsers } from "@/features/moderation/server/queries";
import { requireActiveAdmin } from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Users | UC Marketplace Admin",
};

const statuses = [
  ["all", "All"],
  ["active", "Active"],
  ["suspended", "Suspended"],
  ["disabled", "Disabled"],
] as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; page?: string | string[]; q?: string | string[] }>;
}) {
  await requireActiveAdmin("/admin/users");
  const params = await searchParams;
  const status = statuses.find(([value]) => value === oneQueryValue(params.status))?.[0] ?? "all";
  const page = adminPageNumber(params.page);
  const query = getAdminSearch(oneQueryValue(params.q));
  const data = await getAdminUsers({ status, page, query });
  const filters = { status: status === "all" ? undefined : status, q: query || undefined };

  if (!data.error && page > data.pageCount) {
    redirect(adminHref("/admin/users", filters, data.pageCount));
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-12">
      <AdminPageHeader
        title="Users"
        description="Review account and verification status before changing access. Student IDs and private verification documents are only available to authorized administrators."
        action={<Link href="/admin/verifications" className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#0038a8] px-4 text-sm font-semibold text-[#0038a8] hover:bg-[#e9effb]">Verification queue</Link>}
      />

      <form action="/admin/users" method="get" role="search" className="flex flex-wrap gap-3">
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        <label htmlFor="admin-user-search" className="sr-only">Search users</label>
        <input
          id="admin-user-search"
          name="q"
          type="search"
          defaultValue={query}
          maxLength={80}
          placeholder="Search users"
          className="min-h-11 w-full max-w-md rounded-md border border-[#c4c5d5] bg-white px-4 text-sm outline-none focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15"
        />
        <button type="submit" className="min-h-11 rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576]">Search</button>
        {query && <Link href={adminHref("/admin/users", { status: filters.status })} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-[#0038a8] hover:underline">Clear search</Link>}
      </form>

      <AdminFilterNav label="Filter users by account status" path="/admin/users" selected={status} parameter="status" options={statuses} otherFilters={{ q: query || undefined }} />

      {data.error ? (
        <AdminLoadError subject="users" retryHref={adminHref("/admin/users", filters, page)} />
      ) : data.items.length === 0 ? (
        <p className="rounded-xl border border-[#c4c5d5] bg-white p-8 text-center text-sm text-[#444653]">No users match these filters.</p>
      ) : (
        <>
          <p className="text-sm text-[#444653]">{data.totalCount} {data.totalCount === 1 ? "user" : "users"} found</p>
          <ul className="grid gap-3">
            {data.items.map((user) => (
              <li key={user.id} className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="break-words text-lg font-bold text-[#121c2a]">{user.fullName || "Name unavailable"}</h2>
                    <p className="mt-1 text-sm text-[#444653]">{user.role === "admin" ? "Administrator" : "Student"}{user.course ? ` · ${user.course}` : ""}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <AdminStatusBadge status={user.accountStatus} />
                    <AdminStatusBadge status={user.verificationStatus} />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#e4e4ec] pt-4 text-sm">
                  <span className="text-[#444653]">Joined {formatAdminDate(user.createdAt)}</span>
                  <Link href={`/admin/users/${user.id}`} className="inline-flex min-h-10 items-center font-semibold text-[#0038a8] hover:underline">Review account</Link>
                </div>
              </li>
            ))}
          </ul>
          <AdminPagination path="/admin/users" filters={filters} page={data.page} pageCount={data.pageCount} totalCount={data.totalCount} />
        </>
      )}
    </main>
  );
}
