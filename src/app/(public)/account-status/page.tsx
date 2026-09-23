import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { logout } from "@/app/auth/actions";
import {
  getAuthorizedDestination,
  getCurrentAccessContext,
} from "@/lib/auth/authorization";
import { isAuthServiceUnavailable } from "@/lib/auth/errors";
import { hasRecoveryMarker } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Account Status | UC Exchange",
  description: "Review your UC Exchange account access status.",
};

export default async function AccountStatusPage() {
  let access: Awaited<ReturnType<typeof getCurrentAccessContext>>;

  try {
    access = await getCurrentAccessContext();
  } catch {
    redirect("/login?auth=unavailable");
  }

  const { user, profile, error, profileIssue } = access;

  if (!user) {
    redirect(isAuthServiceUnavailable(error) ? "/login?auth=unavailable" : "/login");
  }

  if (await hasRecoveryMarker(user.id)) {
    redirect("/reset-password");
  }

  if (profile?.account_status === "active") {
    redirect(getAuthorizedDestination(profile));
  }

  const title =
    profile?.account_status === "suspended"
      ? "Your account is suspended"
      : profile?.account_status === "disabled"
        ? "Your account is disabled"
        : profileIssue === "unavailable"
          ? "Account status temporarily unavailable"
        : "Your account profile is unavailable";

  const description =
    profile?.account_status === "suspended"
      ? "Marketplace actions are unavailable while your account is suspended. Contact an administrator if you believe this is a mistake."
      : profile?.account_status === "disabled"
        ? "This account cannot access the marketplace. Contact an administrator if you need help."
        : profileIssue === "unavailable"
          ? "We couldn't check your current account permissions. Refresh this page or try again in a few minutes."
        : "We could not load the profile required for marketplace access. Contact support before trying again.";

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
          className="mt-8 flex size-12 items-center justify-center rounded-full bg-[#fff0f0] text-xl font-bold text-[#ba1a1a]"
          aria-hidden="true"
        >
          !
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-[-0.02em]">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-[#444653]">{description}</p>

        <form action={logout} className="mt-7">
          <button
            type="submit"
            className="inline-flex h-12 w-full items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#002576]"
          >
            Log Out
          </button>
        </form>
      </section>
    </main>
  );
}
