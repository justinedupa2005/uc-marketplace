import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { usesCodeConfirmation } from "@/lib/auth/confirmation-mode";
import { redirectAuthenticatedUser } from "@/lib/auth/server";

import { ResendConfirmationForm } from "./resend-confirmation-form";

export const metadata: Metadata = {
  title: "Resend Confirmation | UC Exchange",
  description: "Request a new account confirmation email.",
};

export default async function ResendConfirmationPage() {
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

        <h1 className="mt-8 text-3xl font-bold tracking-[-0.02em]">
          Need a new confirmation {codeMode ? "code" : "link"}?
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#444653]">
          Enter the email used to register. We&apos;ll send a new {codeMode ? "one-minute code" : "link"} if the account still needs confirmation.
        </p>

        <ResendConfirmationForm codeMode={codeMode} />

        <p className="mt-6 text-center text-sm text-[#444653]">
          Already confirmed?{" "}
          <Link
            href="/login"
            className="font-semibold text-[#0038a8] hover:underline"
          >
            Back to Log In
          </Link>
        </p>
      </section>
    </main>
  );
}
