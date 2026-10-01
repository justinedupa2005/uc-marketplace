import type { Metadata } from "next";
import Link from "next/link";

import { AdminLoadError, AdminPageHeader } from "@/features/moderation/components/admin-ui";
import { getAdminDashboard } from "@/features/moderation/server/queries";
import { requireActiveAdmin } from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Admin Overview | UC Marketplace",
};

const sections = [
  {
    href: "/admin/reports?kind=listing&status=open",
    label: "Listing reports",
    description: "Review complaints about items and decide whether a listing needs action.",
  },
  {
    href: "/admin/reports?kind=student&status=open",
    label: "Student reports",
    description: "Review reports about marketplace participants and their accounts.",
  },
  {
    href: "/admin/verifications",
    label: "Verifications",
    description: "Check school ID submissions before approving students.",
  },
  {
    href: "/admin/users",
    label: "Users",
    description: "Find accounts, suspend access, or reactivate an account.",
  },
  {
    href: "/admin/listings",
    label: "Listings",
    description: "Review marketplace items and remove inappropriate content.",
  },
] as const;

export default async function AdminPage() {
  await requireActiveAdmin("/admin");
  const dashboard = await getAdminDashboard();

  const totals = [
    ["Pending verifications", dashboard.pendingVerifications, "/admin/verifications?status=pending"],
    ["Open listing reports", dashboard.openListingReports, "/admin/reports?kind=listing&status=open"],
    ["Open student reports", dashboard.openStudentReports, "/admin/reports?kind=student&status=open"],
    ["Available or reserved listings", dashboard.activeListings, "/admin/listings"],
    ["Suspended users", dashboard.suspendedUsers, "/admin/users?status=suspended"],
  ] as const;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-5 py-8 sm:px-8 sm:py-12">
      <AdminPageHeader
        title="Moderation overview"
        description="Review reports and verification requests, then take proportionate action on accounts and listings. Decisions are recorded for accountability."
      />

      {dashboard.error ? (
        <AdminLoadError subject="the overview" retryHref="/admin" />
      ) : (
        <section aria-label="Moderation queue totals" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {totals.map(([label, value, href]) => (
            <Link
              key={label}
              href={href}
              className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm hover:border-[#0038a8] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
            >
              <span className="block text-sm font-medium text-[#444653]">{label}</span>
              <span className="mt-3 block text-3xl font-bold text-[#002576]">{value}</span>
            </Link>
          ))}
        </section>
      )}

      <section aria-labelledby="admin-work-heading">
        <h2 id="admin-work-heading" className="text-xl font-bold text-[#121c2a]">Moderation tools</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="group rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm hover:border-[#0038a8] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
            >
              <h3 className="font-bold text-[#002576] group-hover:underline">{section.label}</h3>
              <p className="mt-2 text-sm leading-6 text-[#444653]">{section.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
