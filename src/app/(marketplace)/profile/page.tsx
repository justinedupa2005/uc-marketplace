import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { logout } from "@/app/auth/actions";
import { AppHeader } from "@/components/app-header";
import {
  getAuthorizedDestination,
  isVerifiedActiveStudent,
  requireActiveProfile,
} from "@/lib/auth/authorization";
import { COURSE_OPTIONS } from "@/lib/auth/options";

export const metadata: Metadata = {
  title: "Profile | UC Marketplace",
  description: "View your UC Marketplace profile and account options.",
};

const menuItems = [
  { label: "My Purchases", icon: "purchases.svg", href: "#purchases" },
  { label: "Reservations", icon: "clock.svg", href: "/reservations" },
  { label: "Account Settings", icon: "account.svg", href: "#settings" },
  { label: "Notification Preferences", icon: "notifications.svg", href: "#notifications" },
  { label: "Help Center", icon: "help.svg", href: "#help" },
];

function getYearLevelLabel(yearLevel: number | null) {
  if (!yearLevel) {
    return null;
  }

  const suffix =
    yearLevel === 1 ? "st" : yearLevel === 2 ? "nd" : yearLevel === 3 ? "rd" : "th";
  return `${yearLevel}${suffix} Year`;
}

const verificationLabels: Record<string, string> = {
  unverified: "Unverified Student",
  pending: "Verification Pending",
  verified: "Verified Student",
  rejected: "Verification Needs Attention",
};

export default async function ProfilePage() {
  const { supabase, user, profile: authorizationProfile } =
    await requireActiveProfile("/profile");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, course, year_level")
    .eq("id", user.id)
    .maybeSingle();
  const hasMarketplaceAccess = isVerifiedActiveStudent(authorizationProfile);

  if (profileError || !profile) {
    return (
      <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
        {!hasMarketplaceAccess && (
          <AppHeader
            variant="back"
            title="Profile"
            backHref={getAuthorizedDestination(authorizationProfile)}
            showLogout
            showMarketplaceNavigation={false}
          />
        )}
        <main className="mx-auto w-full max-w-2xl px-6 py-12">
          <section className="rounded-xl border border-[#c4c5d5] bg-white p-7 text-center shadow-sm">
            <h1 className="text-2xl font-bold">Profile temporarily unavailable</h1>
            <p className="mt-3 text-sm leading-6 text-[#444653]">
              We couldn&apos;t load your profile details right now. Please refresh
              the page or try again later.
            </p>
            <Link
              href="/profile"
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576]"
            >
              Try Again
            </Link>
          </section>
        </main>
      </div>
    );
  }

  const fullName =
    typeof profile?.full_name === "string"
      ? profile.full_name
      : "UC Student";
  const initials = fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const course = COURSE_OPTIONS.find(
    (courseOption) => courseOption.value === profile?.course,
  )?.label;
  const yearLevel = getYearLevelLabel(profile?.year_level ?? null);
  const academicDetails =
    course && yearLevel
      ? `${course} - ${yearLevel}`
      : course ?? yearLevel ?? "Student details not completed";
  const verificationStatus = authorizationProfile.verification_status;
  const verificationLabel =
    authorizationProfile.role === "admin"
      ? "Administrator"
      : (verificationLabels[verificationStatus] ?? "Verification Unavailable");
  const isVerified = verificationStatus === "verified";
  const verificationMenuLabel =
    verificationStatus === "pending"
      ? "Verification Pending"
      : verificationStatus === "rejected"
        ? "Resubmit Verification"
        : verificationStatus === "verified"
          ? "Verification Status"
          : "Verify Account";
  const primaryAccountItem =
    authorizationProfile.role === "admin"
      ? {
          label: "Review Verifications",
          icon: "account.svg",
          href: "/admin/verifications",
        }
      : {
          label: verificationMenuLabel,
          icon: "account.svg",
          href: "/verification",
        };
  const accountMenuItems = hasMarketplaceAccess
    ? [primaryAccountItem, ...menuItems]
    : [primaryAccountItem];

  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      {!hasMarketplaceAccess && (
        <AppHeader
          variant="back"
          title="Profile"
          backHref={getAuthorizedDestination(authorizationProfile)}
          showLogout
          showMarketplaceNavigation={false}
        />
      )}

      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 pb-28 pt-8 md:pb-12">
        <section className="overflow-hidden rounded-xl border border-[#c4c5d5] bg-white shadow-sm">
          <div className="h-32 bg-[#0038a8]/10" />
          <div className="-mt-24 flex flex-col items-center px-6 pb-7 text-center">
            <div
              className="flex size-24 items-center justify-center rounded-full border-4 border-white bg-[#e6eeff] text-3xl font-bold text-[#002576] shadow-sm"
              aria-hidden="true"
            >
              {initials}
            </div>
            <h1 className="mt-5 text-2xl font-bold leading-8">{fullName}</h1>
            <span
              className={`mt-1 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold tracking-[0.05em] ${
                isVerified
                  ? "bg-[#e6eeff] text-[#002576]"
                  : "bg-[#f2f3f8] text-[#444653]"
              }`}
            >
              {isVerified && (
                <Image src="/assets/app/verified.svg" alt="" width={10} height={12} />
              )}
              {verificationLabel}
            </span>
            <p className="mt-3 text-base leading-6 text-[#444653]">
              {academicDetails}
            </p>

            <dl className="mt-6 flex w-full max-w-sm items-center justify-center border-t border-[#c4c5d5] pt-4">
              <div className="flex-1 px-4">
                <dd className="text-xl font-bold leading-7 text-[#002576]">—</dd>
                <dt className="text-sm leading-5 text-[#444653]">Items Sold</dt>
              </div>
              <div className="h-10 w-px bg-[#c4c5d5]" />
              <div className="flex-1 px-4">
                <dd className="text-base font-bold leading-7 text-[#002576]">
                  —
                </dd>
                <dt className="text-sm leading-5 text-[#444653]">Reviews</dt>
              </div>
            </dl>
          </div>
        </section>

        <nav aria-label="Profile settings" className="overflow-hidden rounded-xl border border-[#c4c5d5] bg-white shadow-sm">
          {accountMenuItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="flex min-h-[73px] items-center border-b border-[#c4c5d5] px-6 text-lg transition last:border-b-0 hover:bg-[#f9f9ff]"
            >
              <span className="mr-4 flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e6eeff]">
                <Image src={`/assets/app/${item.icon}`} alt="" width={20} height={20} />
              </span>
              <span className="flex-1">{item.label}</span>
              <Image src="/assets/app/chevron-right.svg" alt="" width={8} height={12} />
            </Link>
          ))}
          <form action={logout}>
            <button
              type="submit"
              className="flex min-h-[73px] w-full items-center px-6 text-left text-lg font-semibold text-[#ba1a1a] transition hover:bg-[#ba1a1a]/5"
            >
              <span className="mr-4 flex size-10 shrink-0 items-center justify-center rounded-full bg-[#ba1a1a]/10">
                <Image src="/assets/app/logout.svg" alt="" width={18} height={18} />
              </span>
              Logout
            </button>
          </form>
        </nav>
      </main>
    </div>
  );
}
