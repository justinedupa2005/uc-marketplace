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
import { getAdminReports } from "@/features/moderation/server/queries";
import { requireActiveAdmin } from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Reports | UC Marketplace Admin",
};

const kinds = [
  ["listing", "Listing reports"],
  ["student", "Student reports"],
] as const;

const statuses = [
  ["open", "Open"],
  ["all", "All"],
  ["pending", "Pending"],
  ["reviewing", "Reviewing"],
  ["resolved", "Resolved"],
  ["dismissed", "Dismissed"],
] as const;

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string | string[]; status?: string | string[]; page?: string | string[] }>;
}) {
  await requireActiveAdmin("/admin/reports");
  const params = await searchParams;
  const kind = kinds.find(([value]) => value === oneQueryValue(params.kind))?.[0] ?? "listing";
  const status = statuses.find(([value]) => value === oneQueryValue(params.status))?.[0] ?? "open";
  const page = adminPageNumber(params.page);
  const data = await getAdminReports({ kind, status, page });
  const filters = { kind, status: status === "open" ? undefined : status };

  if (!data.error && page > data.pageCount) {
    redirect(adminHref("/admin/reports", filters, data.pageCount));
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-12">
      <AdminPageHeader
        title="Reports"
        description="Reports are private. Read the submitted concern and subject context, take any necessary account or listing action, then record a resolution or dismissal."
      />

      <AdminFilterNav label="Report subject" path="/admin/reports" selected={kind} parameter="kind" options={kinds} otherFilters={{ status: filters.status }} />
      <AdminFilterNav label="Filter reports by status" path="/admin/reports" selected={status} parameter="status" options={statuses} otherFilters={{ kind }} defaultValue="open" />

      {data.error ? (
        <AdminLoadError subject="reports" retryHref={adminHref("/admin/reports", filters, page)} />
      ) : data.items.length === 0 ? (
        <p className="rounded-xl border border-[#c4c5d5] bg-white p-8 text-center text-sm text-[#444653]">No {kind} reports match this status.</p>
      ) : (
        <>
          <p className="text-sm text-[#444653]">{data.totalCount} {data.totalCount === 1 ? "report" : "reports"} found</p>
          <ul className="grid gap-3">
            {data.items.map((report) => (
              <li key={report.id} className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#5b6070]">{kind === "listing" ? "Reported listing" : "Reported student"}</p>
                    <h2 className="mt-1 break-words text-lg font-bold text-[#121c2a]">{kind === "listing" ? report.listingTitle || report.subjectName : report.subjectName}</h2>
                    <p className="mt-1 text-sm text-[#444653]">Reason: <span className="capitalize">{report.reason.replaceAll("_", " ")}</span></p>
                  </div>
                  <AdminStatusBadge status={report.status} />
                </div>
                {report.details && <p className="mt-3 line-clamp-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#444653]">{report.details}</p>}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#e4e4ec] pt-4 text-sm">
                  <span className="text-[#444653]">Reported by {report.reporterName || "student"} · {formatAdminDate(report.createdAt)}</span>
                  <Link href={`/admin/reports/${kind}/${report.id}`} className="inline-flex min-h-10 items-center font-semibold text-[#0038a8] hover:underline">Review report</Link>
                </div>
              </li>
            ))}
          </ul>
          <AdminPagination path="/admin/reports" filters={filters} page={data.page} pageCount={data.pageCount} totalCount={data.totalCount} />
        </>
      )}
    </main>
  );
}
