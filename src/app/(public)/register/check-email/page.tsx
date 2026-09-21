import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { FormNotification } from "@/components/form-notification";
import { usesCodeConfirmation } from "@/lib/auth/confirmation-mode";
import { redirectAuthenticatedUser } from "@/lib/auth/server";

import { CheckEmailForm } from "./check-email-form";

export const metadata: Metadata = {
  title: "Check Your Email | UC Exchange",
  description: "Confirm your email address to finish registration.",
};

export default async function CheckEmailPage() {
  await redirectAuthenticatedUser();
  const codeMode = usesCodeConfirmation();

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

        <div
          className="mt-8 flex size-12 items-center justify-center rounded-full bg-[#e6eeff] text-2xl text-[#0038a8]"
          aria-hidden="true"
        >
          &#9993;
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-[-0.02em]">
          {codeMode ? "Verify your email" : "Check your email"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#444653]">
          {codeMode
            ? "If this address needs confirmation, enter the eight-digit code from your email. The code expires one minute after it is sent."
            : "If this address needs confirmation, check its inbox for a link and open it before signing in."}
        </p>

        {codeMode ? (
          <CheckEmailForm />
        ) : (
          <div className="mt-6">
            <FormNotification variant="success">
              Already confirmed or registered before? Try logging in instead.
            </FormNotification>
          </div>
        )}

        <Link
          href="/register/resend-confirmation"
          className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8] transition-colors hover:bg-[#e6eeff]"
        >
          {codeMode ? "Resend verification code" : "Resend confirmation link"}
        </Link>

        <p className="mt-4 text-center text-xs leading-5 text-[#5b6070]">
          Didn&apos;t receive it? Check your spam folder or request a new {codeMode ? "code" : "link"}.
        </p>

        <Link
          href="/login"
          className="mt-4 block text-center text-sm font-semibold text-[#0038a8] hover:underline"
        >
          Back to Log In
        </Link>
      </section>
    </main>
  );
}
