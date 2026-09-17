import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FormNotification } from "@/components/form-notification";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Log In | UC Exchange",
  description: "Log in to your UC Exchange account.",
};

type LoginPageProps = {
  searchParams: Promise<{
    email?: string | string[];
    password?: string | string[];
    registered?: string | string[];
    confirmation?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  // Clean up URLs created by the old GET form so credentials are no longer
  // displayed in the address bar. Browser history should still be cleared.
  if (params.email !== undefined || params.password !== undefined) {
    redirect("/login");
  }

  const registered = Array.isArray(params.registered)
    ? params.registered[0]
    : params.registered;
  const confirmation = Array.isArray(params.confirmation)
    ? params.confirmation[0]
    : params.confirmation;

  let notification: { variant: "error" | "success"; message: string } | null =
    null;

  if (registered === "check-email") {
    notification = {
      variant: "success",
      message:
        "Registration successful. Check your email to confirm your account before logging in.",
    };
  } else if (registered === "ready") {
    notification = {
      variant: "success",
      message: "Registration successful. You can now log in.",
    };
  } else if (confirmation === "success") {
    notification = {
      variant: "success",
      message: "Your email has been confirmed. You can now log in.",
    };
  } else if (confirmation === "failed") {
    notification = {
      variant: "error",
      message:
        "The confirmation link is invalid or expired. Please request a new one.",
    };
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f9f9ff] px-5 py-10 text-[#121c2a]">
      <section className="w-full max-w-md rounded-2xl border border-[#c4c5d5]/70 bg-white p-6 shadow-[0_16px_50px_rgba(0,37,118,0.08)] sm:p-9">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-[#002576]">
          <Image src="/assets/app/brand.svg" alt="" width={22} height={18} />
          UC Exchange
        </Link>

        <h1 className="mt-8 text-3xl font-bold tracking-[-0.02em]">Welcome back</h1>
        <p className="mt-2 text-sm leading-6 text-[#444653]">Log in to continue to the marketplace.</p>

        {notification && (
          <div className="mt-6">
            <FormNotification variant={notification.variant}>
              {notification.message}
            </FormNotification>
          </div>
        )}

        <LoginForm />

        <p className="mt-6 text-center text-sm text-[#444653]">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-semibold text-[#0038a8] hover:underline">
            Register
          </Link>
        </p>
      </section>
    </main>
  );
}
