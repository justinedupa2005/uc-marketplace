import type { Metadata } from "next";
import Link from "next/link";

import { requireActiveAdmin } from "./admin-access";

export const metadata: Metadata = {
  title: "Verification Requests | UC Marketplace Admin",
};

type VerificationStatus = "pending" | "approved" | "rejected";
type Filter = VerificationStatus | "all";

type VerificationListItem = {
  id: string;
  full_name_snapshot: string;
  student_id_number_snapshot: string;
  course_snapshot: string;
  year_level_snapshot: number;
  submitted_at: string;
  status: VerificationStatus;
};

const filters: { value: Filter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

export default async function AdminVerificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { status, page: pageParam } = await searchParams;
  const selectedFilter = filters.find((filter) => filter.value === status)?.value ?? "pending";
  const requestedPage = typeof pageParam === "string" && /^[1-9]\d{0,3}$/.test(pageParam)
    ? Number(pageParam)
    : 1;
  const page = Math.min(requestedPage, 1000);
  const offset = (page - 1) * 100;
  const { supabase } = await requireActiveAdmin();

  let query = supabase
    .from("verifications")
    .select(
      "id, full_name_snapshot, student_id_number_snapshot, course_snapshot, year_level_snapshot, submitted_at, status",
    );

  if (selectedFilter !== "all") {
    query = query.eq("status", selectedFilter);
  }

  const { data, error } = await query
    .order("submitted_at", { ascending: selectedFilter === "pending" })
    .order("id", { ascending: true })
    .range(offset, offset + 100);
  const hasNextPage = (data?.length ?? 0) > 100;
  const requests = (data ?? []).slice(0, 100) as VerificationListItem[];

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="mb-7">
        <h1 className="text-3xl font-bold tracking-tight text-[#121c2a]">Student verifications</h1>
        <p className="mt-2 max-w-2xl text-[#444653]">
          Review submitted student information and privately stored school IDs.
        </p>
      </div>

      <nav aria-label="Filter verifications" className="mb-6 flex flex-wrap gap-2">
        {filters.map((filter) => (
          <Link
            key={filter.value}
            href={`/admin/verifications?status=${filter.value}`}
            aria-current={selectedFilter === filter.value ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              selectedFilter === filter.value
                ? "bg-[#0038a8] text-white"
                : "border border-[#c4c5d5] bg-white text-[#444653] hover:border-[#0038a8] hover:text-[#0038a8]"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      {error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">
          Verification requests could not be loaded. Please try again.
        </p>
      ) : requests.length === 0 ? (
        <p className="rounded-xl border border-[#c4c5d5] bg-white p-8 text-center text-[#444653]">
          No {selectedFilter === "all" ? "" : `${selectedFilter} `}verification requests found.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#c4c5d5] bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-[#c4c5d5] bg-[#f2f3f8] text-[#444653]">
              <tr>
                <th scope="col" className="px-5 py-4 font-semibold">Student</th>
                <th scope="col" className="px-5 py-4 font-semibold">Student ID</th>
                <th scope="col" className="px-5 py-4 font-semibold">Course</th>
                <th scope="col" className="px-5 py-4 font-semibold">Year</th>
                <th scope="col" className="px-5 py-4 font-semibold">Submitted</th>
                <th scope="col" className="px-5 py-4 font-semibold">Status</th>
                <th scope="col" className="px-5 py-4 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e4ec]">
              {requests.map((request) => (
                <tr key={request.id}>
                  <th scope="row" className="px-5 py-4 font-semibold">{request.full_name_snapshot}</th>
                  <td className="px-5 py-4">{request.student_id_number_snapshot}</td>
                  <td className="px-5 py-4">{request.course_snapshot}</td>
                  <td className="px-5 py-4">{request.year_level_snapshot}</td>
                  <td className="whitespace-nowrap px-5 py-4">{formatDate(request.submitted_at)}</td>
                  <td className="px-5 py-4 capitalize">{request.status}</td>
                  <td className="px-5 py-4">
                    <Link
                      href={`/admin/verifications/${request.id}`}
                      className="font-semibold text-[#0038a8] hover:underline"
                    >
                      {request.status === "pending" ? "Review" : "View"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!error && (page > 1 || hasNextPage) && (
        <nav aria-label="Verification pages" className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-[#444653]">
            Page {page}{requests.length > 0 ? ` · Showing ${offset + 1}–${offset + requests.length}` : ""}
          </span>
          <div className="flex gap-3">
            {page > 1 && (
              <Link href={`/admin/verifications?status=${selectedFilter}&page=${page - 1}`} className="rounded-md border border-[#c4c5d5] bg-white px-4 py-2 font-semibold text-[#0038a8] hover:border-[#0038a8]">
                Previous
              </Link>
            )}
            {hasNextPage && (
              <Link href={`/admin/verifications?status=${selectedFilter}&page=${page + 1}`} className="rounded-md border border-[#c4c5d5] bg-white px-4 py-2 font-semibold text-[#0038a8] hover:border-[#0038a8]">
                Next
              </Link>
            )}
          </div>
        </nav>
      )}
    </main>
  );
}
