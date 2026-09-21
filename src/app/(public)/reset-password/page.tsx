import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { getValidatedUser, hasRecoveryMarker } from "@/lib/auth/server";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a New Password | UC Exchange",
  description: "Securely update your UC Exchange password.",
};

export default async function ResetPasswordPage() {
  let hasValidRecoveryState = false;
  let authUnavailable = false;

  try {
    const { user, error } = await getValidatedUser();
    authUnavailable = Boolean(
      error &&
        (error.status === 0 ||
          error.code === "request_timeout" ||
          error.name === "AuthRetryableFetchError"),
    );
    hasValidRecoveryState = Boolean(
      user && (await hasRecoveryMarker(user.id)),
    );
  } catch {
    authUnavailable = true;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f9f9ff] px-5 py-10 text-[#121c2a]">
      <section className="w-full max-w-md rounded-2xl border border-[#c4c5d5]/70 bg-white p-6 shadow-[0_16px_50px_rgba(0,37,118,0.08)] sm:p-9">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-bold text-[#002576]"
        >
          <Image src="/assets/app/brand.svg" alt="" width={22} height={18} />
          UC Exchange
        </Link>

        {hasValidRecoveryState ? (
          <>
            <h1 className="mt-8 text-3xl font-bold tracking-[-0.02em]">
              Choose a new password
            </h1>
            <p className="mt-2 text-sm leading-6 text-[#444653]">
              Your recovery link is valid. Enter a new password for your account.
            </p>
            <ResetPasswordForm />
          </>
        ) : (
          <>
            <div
              className="mt-8 flex size-12 items-center justify-center rounded-full bg-[#fff0f0] text-xl font-bold text-[#ba1a1a]"
              aria-hidden="true"
            >
              !
            </div>
            <h1 className="mt-5 text-3xl font-bold tracking-[-0.02em]">
              {authUnavailable ? "Password service unavailable" : "Reset link unavailable"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-[#444653]">
              {authUnavailable
                ? "We could not verify your reset session right now. Please try again shortly."
                : "This password reset link is invalid, expired, already used, or was opened in a different browser."}
            </p>
            <Link
              href={authUnavailable ? "/reset-password" : "/forgot-password"}
              className="mt-7 inline-flex h-12 w-full items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#002576]"
            >
              {authUnavailable ? "Try Again" : "Request Another Reset Link"}
            </Link>
            <Link
              href="/login"
              className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8] transition-colors hover:bg-[#e6eeff]"
            >
              Back to Log In
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
