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
import { UserModerationControls } from "@/features/moderation/components/moderation-action-dialog";
import { getAdminUser } from "@/features/moderation/server/queries";
import { requireActiveAdmin } from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Review User | UC Marketplace Admin",
};

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireActiveAdmin("/admin/users");
  const { id } = await params;
  if (!isAdminUuid(id)) notFound();
  const { item: user, error } = await getAdminUser(id);

  if (error) {
    return <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12"><AdminLoadError subject="this user" retryHref={`/admin/users/${id}`} /></main>;
  }
  if (!user) notFound();

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-5 py-8 sm:px-8 sm:py-12">
      <div>
        <Link href="/admin/users" className="text-sm font-semibold text-[#0038a8] hover:underline">← Back to users</Link>
        <h1 className="mt-4 break-words text-3xl font-bold tracking-tight text-[#002576]">{user.fullName || "Name unavailable"}</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <AdminStatusBadge status={user.accountStatus} />
          <AdminStatusBadge status={user.verificationStatus} />
        </div>
      </div>

      <section aria-labelledby="account-details-heading" className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
        <h2 id="account-details-heading" className="mb-4 text-xl font-bold">Account details</h2>
        <dl>
          <AdminDetailRow label="Role" value={user.role === "admin" ? "Administrator" : "Student"} />
          <AdminDetailRow label="Account status" value={<AdminStatusBadge status={user.accountStatus} />} />
          <AdminDetailRow label="Verification" value={<AdminStatusBadge status={user.verificationStatus} />} />
          <AdminDetailRow label="Joined" value={formatAdminDate(user.createdAt)} />
          {user.role === "student" && (
            <>
              <AdminDetailRow label="Student ID" value={user.studentIdNumber || "Not provided"} />
              <AdminDetailRow label="Course" value={user.course || "Not provided"} />
              <AdminDetailRow label="Year level" value={user.yearLevel ?? "Not provided"} />
            </>
          )}
        </dl>
        {user.role === "student" && (
          <Link href="/admin/verifications" className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-[#0038a8] hover:underline">View verification queue</Link>
        )}
      </section>

      {user.role === "student" && (
        <section aria-labelledby="account-action-heading" className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
          <h2 id="account-action-heading" className="text-xl font-bold">Account action</h2>
          <p className="mt-2 text-sm leading-6 text-[#444653]">Review relevant reports before changing access. A status change does not close a report automatically.</p>
          <div className="mt-5"><UserModerationControls userId={user.id} accountStatus={user.accountStatus} /></div>
        </section>
      )}
    </main>
  );
}
