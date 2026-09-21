import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { logout } from "@/app/auth/actions";
import { getValidatedUser, hasRecoveryMarker } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Account Status | UC Exchange",
  description: "Review your UC Exchange account access status.",
};

export default async function AccountStatusPage() {
  const { supabase, user } = await getValidatedUser();

  if (!user) {
    redirect("/login");
  }

  if (await hasRecoveryMarker(user.id)) {
    redirect("/reset-password");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (!error && profile?.account_status === "active") {
    redirect("/marketplace");
  }

  const title =
    profile?.account_status === "suspended"
      ? "Your account is suspended"
      : profile?.account_status === "disabled"
        ? "Your account is disabled"
        : "Your account profile is unavailable";

  const description =
    profile?.account_status === "suspended"
      ? "Marketplace actions are unavailable while your account is suspended. Contact an administrator if you believe this is a mistake."
      : profile?.account_status === "disabled"
        ? "This account cannot access the marketplace. Contact an administrator if you need help."
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
