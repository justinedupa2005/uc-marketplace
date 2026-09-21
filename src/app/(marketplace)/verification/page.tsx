import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { MobileNavigation } from "@/components/mobile-navigation";
import { getValidatedUser } from "@/lib/auth/server";

import { StudentInformation } from "./student-information";
import { studentInformationSchema } from "./validation";
import { VerificationForm } from "./verification-form";

export const metadata: Metadata = {
  title: "Student Verification | UC Marketplace",
  description: "Verify your UC Main student account.",
};

function formatSubmittedAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "long",
    timeZone: "Asia/Manila",
  }).format(date);
}

function StatusPanel({
  title,
  message,
  tone,
  children,
}: {
  title: string;
  message: string;
  tone: "blue" | "green" | "red";
  children?: React.ReactNode;
}) {
  const colors = {
    blue: "border-[#b7c5df] bg-[#edf3ff] text-[#002576]",
    green: "border-[#b8d8bf] bg-[#eaf6ed] text-[#185326]",
    red: "border-[#edb4b4] bg-[#fff0f0] text-[#8b1818]",
  };

  return (
    <section className={`rounded-xl border p-5 sm:p-7 ${colors[tone]}`}>
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mt-2 text-sm leading-6">{message}</p>
      {children}
    </section>
  );
}

export default async function VerificationPage() {
  const { supabase, user } = await getValidatedUser();
  if (!user) redirect("/login?next=/verification");

  const [profileResult, latestResult] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "full_name, student_id_number, course, year_level, role, account_status, verification_status",
      )
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("verifications")
      .select("status, rejection_reason, submitted_at")
      .eq("user_id", user.id)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const profile = profileResult.data;
  const latest = latestResult.data;
  const unavailable =
    Boolean(profileResult.error || latestResult.error) ||
    !profile ||
    profile.account_status !== "active";
  const canSubmit =
    !unavailable &&
    profile.role === "student" &&
    (profile.verification_status === "unverified" ||
      profile.verification_status === "rejected") &&
    latest?.status !== "pending";
  const hasCompleteInformation =
    !unavailable &&
    studentInformationSchema.safeParse({
      fullName: profile.full_name,
      studentIdNumber: profile.student_id_number,
      course: profile.course,
      yearLevel: profile.year_level,
    }).success;
  const submittedAt = formatSubmittedAt(latest?.submitted_at ?? null);
  const isPending =
    profile?.verification_status === "pending" || latest?.status === "pending";
  const isVerified = profile?.verification_status === "verified";
  const isRejected =
    profile?.verification_status === "rejected" && latest?.status === "rejected";

  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      <AppHeader variant="back" title="Student Verification" backHref="/profile" />

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 pb-28 pt-7 sm:px-6 sm:pt-10 md:pb-12">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#0038a8]">
            UC Main student identity
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Verify your student account
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[#444653] sm:text-base">
            Student verification helps ensure marketplace accounts belong to
            legitimate UC Main students and helps maintain a safer campus
            marketplace.
          </p>
        </header>

        {unavailable ? (
          <StatusPanel
            tone="red"
            title="Verification unavailable"
            message="We couldn't load your verification information. Refresh this page or try again later."
          />
        ) : profile.role !== "student" ? (
          <StatusPanel
            tone="blue"
            title="Student verification only"
            message="This page is for student accounts. Administrators can review requests from the admin verification page."
          >
            <Link href="/admin/verifications" className="mt-4 inline-block text-sm font-semibold underline">
              Go to verification review
            </Link>
          </StatusPanel>
        ) : (
          <>
            {isPending && (
              <StatusPanel
                tone="blue"
                title="Verification pending"
                message="Your student verification has been submitted. Our administrators are reviewing your information. You can continue using the marketplace features available to unverified accounts."
              >
                {submittedAt && (
                  <p className="mt-4 text-sm font-semibold">Submitted: {submittedAt}</p>
                )}
              </StatusPanel>
            )}

            {isVerified && (
              <StatusPanel
                tone="green"
                title="Student verified"
                message="Your student account has been successfully verified. You can now use seller features available to verified, active students."
              />
            )}

            {isRejected && (
              <StatusPanel
                tone="red"
                title="Verification rejected"
                message="Your request needs a correction before we can verify your student account."
              >
                {latest?.rejection_reason && (
                  <div className="mt-4 rounded-lg bg-white/80 p-4 text-sm leading-6 text-[#121c2a]">
                    <p className="font-semibold">Reason</p>
                    <p className="mt-1 whitespace-pre-wrap break-words">{latest.rejection_reason}</p>
                  </div>
                )}
                <Link
                  href="#verification-form"
                  className="mt-5 inline-block rounded-lg bg-[#0038a8] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#002576]"
                >
                  Submit again
                </Link>
              </StatusPanel>
            )}

            {!isPending && !isVerified && !isRejected && !canSubmit && (
              <StatusPanel
                tone="blue"
                title="Verification status unavailable"
                message="Refresh this page before submitting a new request. If the problem continues, contact an administrator."
              />
            )}

            <StudentInformation
              fullName={profile.full_name}
              studentIdNumber={profile.student_id_number}
              course={profile.course}
              yearLevel={profile.year_level}
              editable={canSubmit}
            />

            {canSubmit && !hasCompleteInformation && (
              <StatusPanel
                tone="blue"
                title="Complete your information"
                message="Edit your student information above before submitting your school ID."
              />
            )}

            {canSubmit && hasCompleteInformation && <VerificationForm />}
          </>
        )}
      </main>

      <MobileNavigation active="profile" />
    </div>
  );
}
