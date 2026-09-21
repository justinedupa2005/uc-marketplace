import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireActiveAdmin, VERIFICATION_ID_PATTERN } from "../admin-access";
import { ReviewActions } from "./review-actions";

export const metadata: Metadata = {
  title: "Review Student Verification | UC Marketplace Admin",
};

type VerificationRecord = {
  id: string;
  user_id: string;
  full_name_snapshot: string;
  student_id_number_snapshot: string;
  course_snapshot: string;
  year_level_snapshot: number;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  submitted_at: string;
  reviewed_at: string | null;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

function Detail({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-t border-[#e4e4ec] py-3 sm:grid sm:grid-cols-[13rem_1fr] sm:gap-4">
      <dt className="text-sm font-semibold text-[#444653]">{label}</dt>
      <dd className="mt-1 break-words text-sm sm:mt-0">{value}</dd>
    </div>
  );
}

export default async function AdminVerificationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  const { supabase } = await requireActiveAdmin();

  if (!VERIFICATION_ID_PATTERN.test(id)) {
    notFound();
  }

  const { data, error } = await supabase
    .from("verifications")
    .select(
      "id, user_id, full_name_snapshot, student_id_number_snapshot, course_snapshot, year_level_snapshot, status, rejection_reason, submitted_at, reviewed_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">
          This verification request could not be loaded. Please try again.
        </p>
        <Link href="/admin/verifications" className="mt-4 inline-block text-sm font-semibold text-[#0038a8] hover:underline">
          Back to verifications
        </Link>
      </main>
    );
  }

  if (!data) {
    notFound();
  }

  const verification = data as VerificationRecord;
  const { data: profile } = await supabase
    .from("profiles")
    .select("account_status, verification_status, full_name, student_id_number, course, year_level")
    .eq("id", verification.user_id)
    .maybeSingle();

  const noticeText =
    notice === "approved"
      ? "Verification approved. The student is now verified."
      : notice === "rejected"
        ? "Verification rejected. The student can see your reason and resubmit."
        : notice === "already-reviewed"
          ? "This verification has already been reviewed. The latest status is shown below."
          : null;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-5 py-8 sm:px-8 sm:py-12">
      <div>
        <Link href="/admin/verifications" className="text-sm font-semibold text-[#0038a8] hover:underline">
          ← Back to verifications
        </Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Review student verification</h1>
        <p className="mt-2 text-[#444653]">
          Submitted {formatDate(verification.submitted_at)} · Status: <span className="font-semibold capitalize">{verification.status}</span>
        </p>
      </div>

      {noticeText && (
        <p role="status" className="rounded-xl border border-[#b9d1bd] bg-[#ecf7ed] p-4 text-sm text-[#155724]">
          {noticeText}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="submitted-heading" className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
          <h2 id="submitted-heading" className="mb-4 text-xl font-bold">Submitted information</h2>
          <p className="mb-4 text-sm text-[#444653]">This snapshot is what the student submitted for review.</p>
          <dl>
            <Detail label="Full name" value={verification.full_name_snapshot} />
            <Detail label="Student ID" value={verification.student_id_number_snapshot} />
            <Detail label="Course" value={verification.course_snapshot} />
            <Detail label="Year level" value={verification.year_level_snapshot} />
          </dl>
        </section>

        <section aria-labelledby="account-heading" className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
          <h2 id="account-heading" className="mb-4 text-xl font-bold">Current account information</h2>
          {profile ? (
            <dl>
              <Detail label="Account status" value={profile.account_status} />
              <Detail label="Verification status" value={profile.verification_status} />
              <Detail label="Full name" value={profile.full_name ?? "Not provided"} />
              <Detail label="Student ID" value={profile.student_id_number ?? "Not provided"} />
              <Detail label="Course" value={profile.course ?? "Not provided"} />
              <Detail label="Year level" value={profile.year_level ?? "Not provided"} />
            </dl>
          ) : (
            <p className="text-sm text-[#444653]">Current profile information is unavailable.</p>
          )}
        </section>
      </div>

      <section aria-labelledby="document-heading" className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
        <h2 id="document-heading" className="text-xl font-bold">Private school ID</h2>
        <p className="mt-2 text-sm text-[#444653]">Only authorized administrators can view this image. It is not public.</p>
        <div className="mt-5 flex min-h-64 items-center justify-center overflow-hidden rounded-lg border border-[#e4e4ec] bg-[#f2f3f8] p-3">
          <Image
            src={`/admin/verifications/${verification.id}/document`}
            alt="Student-submitted school ID for verification review"
            width={1000}
            height={650}
            unoptimized
            className="max-h-[38rem] w-auto max-w-full object-contain"
          />
        </div>
      </section>

      {verification.status === "pending" ? (
        <ReviewActions verificationId={verification.id} />
      ) : (
        <section className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-xl font-bold">Review complete</h2>
          <p className="mt-2 text-sm text-[#444653]">
            This request was {verification.status} on {verification.reviewed_at ? formatDate(verification.reviewed_at) : "an unknown date"}.
          </p>
          {verification.status === "rejected" && verification.rejection_reason && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
              <h3 className="text-sm font-semibold text-[#ba1a1a]">Rejection reason</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm">{verification.rejection_reason}</p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
