import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AdminDetailRow,
  AdminLoadError,
  AdminStatusBadge,
  formatAdminDate,
  isAdminUuid,
} from "@/features/moderation/components/admin-ui";
import { ReportModerationControls } from "@/features/moderation/components/moderation-action-dialog";
import { getAdminReport } from "@/features/moderation/server/queries";
import { requireActiveAdmin } from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Review Report | UC Marketplace Admin",
};

export default async function AdminReportDetailPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  await requireActiveAdmin("/admin/reports");
  const { kind, id } = await params;
  if ((kind !== "listing" && kind !== "student") || !isAdminUuid(id)) notFound();
  const { item: report, error } = await getAdminReport(kind, id);

  if (error) {
    return <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12"><AdminLoadError subject="this report" retryHref={`/admin/reports/${kind}/${id}`} /></main>;
  }
  if (!report) notFound();

  const subjectLabel = kind === "listing" ? report.listingTitle || "Former listing" : report.subjectName;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-5 py-8 sm:px-8 sm:py-12">
      <div>
        <Link href={`/admin/reports?kind=${kind}`} className="text-sm font-semibold text-[#0038a8] hover:underline">← Back to {kind} reports</Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-[#5b6070]">Private {kind} report</p>
        <h1 className="mt-1 break-words text-3xl font-bold tracking-tight text-[#002576]">{subjectLabel}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3"><AdminStatusBadge status={report.status} /><span className="text-sm text-[#444653]">Submitted {formatAdminDate(report.createdAt)}</span></div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="report-concern-heading" className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
          <h2 id="report-concern-heading" className="text-xl font-bold">Reported concern</h2>
          <dl className="mt-4">
            <AdminDetailRow label="Reason" value={<span className="capitalize">{report.reason.replaceAll("_", " ")}</span>} />
            <AdminDetailRow label="Reporter" value={<Link href={`/admin/users/${report.reporterId}`} className="font-semibold text-[#0038a8] hover:underline">{report.reporterName || "View account"}</Link>} />
            <AdminDetailRow label="Submitted" value={formatAdminDate(report.createdAt)} />
          </dl>
          <h3 className="mt-5 text-sm font-semibold text-[#444653]">Additional details</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{report.details || "No additional details were provided."}</p>
        </section>

        <section aria-labelledby="report-subject-heading" className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
          <h2 id="report-subject-heading" className="text-xl font-bold">Subject and review</h2>
          <dl className="mt-4">
            {kind === "listing" && (
              <AdminDetailRow label="Listing" value={report.listingId
                ? <Link href={`/admin/listings/${report.listingId}`} className="font-semibold text-[#0038a8] hover:underline">{report.listingTitle || "View listing"}</Link>
                : "Listing no longer available"} />
            )}
            <AdminDetailRow label={kind === "listing" ? "Seller" : "Student"} value={<Link href={`/admin/users/${report.subjectId}`} className="font-semibold text-[#0038a8] hover:underline">{report.subjectName || "View account"}</Link>} />
            <AdminDetailRow label="Status" value={<AdminStatusBadge status={report.status} />} />
            <AdminDetailRow label="Last updated" value={formatAdminDate(report.updatedAt)} />
            <AdminDetailRow label="Decision date" value={formatAdminDate(report.reviewedAt)} />
          </dl>
          {report.adminNote && (
            <div className="mt-5 rounded-lg border border-[#c4c5d5] bg-[#f2f3f8] p-4">
              <h3 className="text-sm font-semibold">Private decision note</h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{report.adminNote}</p>
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby="report-action-heading" className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
        <h2 id="report-action-heading" className="text-xl font-bold">Decision</h2>
        <p className="mt-2 text-sm leading-6 text-[#444653]">A report decision records the outcome. It does not automatically change the student account or listing; use the linked moderation controls if action is needed.</p>
        <div className="mt-5"><ReportModerationControls kind={kind} reportId={report.id} status={report.status} /></div>
      </section>
    </main>
  );
}
