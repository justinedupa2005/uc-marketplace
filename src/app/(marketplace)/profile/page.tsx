import type { Metadata } from "next";
import Image from "next/image";

import { FormNotification } from "@/components/form-notification";
import { NavigationLink } from "@/components/navigation-blocker";
import { LogoutButton } from "@/features/profiles/components/logout-button";
import { ProfileAvatar } from "@/features/profiles/components/profile-avatar";
import { formatProfileJoined } from "@/features/profiles/rules";
import { getOwnProfile } from "@/features/profiles/server/queries";
import { isVerifiedActiveStudent } from "@/lib/auth/authorization";
import { COURSE_OPTIONS, YEAR_LEVEL_OPTIONS } from "@/lib/auth/options";

import { ProfileShell } from "./_components/profile-shell";
import { ProfileUnavailable } from "./_components/profile-unavailable";

export const metadata: Metadata = {
  title: "Profile | UC Marketplace",
  description: "View your profile and manage your UC Marketplace account.",
};

const verificationLabels = {
  unverified: "Unverified Student",
  pending: "Verification Pending",
  verified: "Verified Student",
  rejected: "Verification Needs Attention",
};

const accountLabels = { active: "Active", suspended: "Suspended", disabled: "Disabled" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ logout?: string | string[] }> }) {
  const [{ profile, error, authorization }, params] = await Promise.all([getOwnProfile(), searchParams]);
  const logoutFailed = params.logout === "failed" || (Array.isArray(params.logout) && params.logout[0] === "failed");
  if (error || !profile) {
    return <ProfileShell authorization={authorization} title="Profile"><ProfileUnavailable /></ProfileShell>;
  }

  const hasMarketplaceAccess = isVerifiedActiveStudent(authorization);
  const joined = formatProfileJoined(profile.createdAt);
  const course = COURSE_OPTIONS.find((option) => option.value === profile.course)?.label ?? profile.course;
  const year = YEAR_LEVEL_OPTIONS.find((option) => Number(option.value) === profile.yearLevel)?.label;
  const isStudent = profile.role === "student";
  const isActive = profile.accountStatus === "active";
  const isVerified = isStudent && profile.verificationStatus === "verified";
  const menuItems = [
    ...(profile.canEdit ? [{ label: "Edit Profile and Photo", icon: "account.svg", href: "/profile/edit" }] : []),
    { label: "Change Password", icon: "account.svg", href: "/profile/change-password" },
    ...(isActive ? [{
      label: isStudent
        ? profile.verificationStatus === "rejected" ? "Resubmit Verification" : profile.verificationStatus === "pending" ? "View Verification Status" : profile.verificationStatus === "verified" ? "Verification Details" : "Verify Account"
        : "Admin Dashboard",
      icon: "verified.svg",
      href: isStudent ? "/verification" : "/admin",
    }] : [{ label: "Account Status", icon: "account.svg", href: "/account-status" }]),
    ...(hasMarketplaceAccess ? [
      { label: "My Listings", icon: "purchases.svg", href: "/my-listings" },
      { label: "Reservations", icon: "clock.svg", href: "/reservations" },
      { label: "Favorites", icon: "nav-favorites.svg", href: "/favorites" },
      { label: "Messages", icon: "nav-messages.svg", href: "/messages" },
    ] : []),
    { label: "Notifications", icon: "notifications.svg", href: "/notifications" },
  ];

  return (
    <ProfileShell authorization={authorization} title="Profile">
      {logoutFailed && <FormNotification variant="error">We couldn&apos;t log you out. Please try again.</FormNotification>}
      {!isActive && (
        <FormNotification variant="error">
          Your account is {profile.accountStatus}. Marketplace activity and profile editing are unavailable. You can still change your password, view account notifications, or log out.
        </FormNotification>
      )}
      <section className="overflow-hidden rounded-xl border border-[#c4c5d5] bg-white shadow-sm">
        <div className="h-28 bg-[#0038a8]/10" />
        <div className="-mt-16 flex flex-col items-center px-6 pb-7 text-center">
          <ProfileAvatar avatarUrl={profile.avatarUrl} fullName={profile.fullName} className="border-4 border-white shadow-sm" />
          <h1 className="mt-4 text-2xl font-bold leading-8">{profile.fullName ?? "Your profile"}</h1>
          {!profile.fullName && <p className="mt-2 text-sm text-[#444653]">Full name not provided</p>}
          <span className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${isVerified ? "bg-[#e6eeff] text-[#002576]" : "bg-[#f2f3f8] text-[#444653]"}`}>
            {isVerified && <Image src="/assets/app/verified.svg" alt="" width={10} height={12} />}
            {isStudent ? verificationLabels[profile.verificationStatus] : "Administrator"}
          </span>
          <dl className="mt-6 grid w-full gap-5 border-t border-[#c4c5d5] pt-5 text-left sm:grid-cols-2">
            {isStudent && (
              <>
                <div><dt className="text-xs font-semibold text-[#444653]">Course</dt><dd className="mt-1 text-sm font-semibold">{course ?? "Course not provided"}</dd></div>
                <div><dt className="text-xs font-semibold text-[#444653]">Year level</dt><dd className="mt-1 text-sm font-semibold">{year ?? "Year level not provided"}</dd></div>
              </>
            )}
            <div><dt className="text-xs font-semibold text-[#444653]">Account status</dt><dd className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${isActive ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{accountLabels[profile.accountStatus]}</dd></div>
            <div><dt className="text-xs font-semibold text-[#444653]">Date joined</dt><dd className="mt-1 text-sm font-semibold">{joined ?? "Joined date unavailable"}</dd></div>
          </dl>
        </div>
      </section>
      <nav aria-label="Profile and account options" className="overflow-hidden rounded-xl border border-[#c4c5d5] bg-white shadow-sm">
        {menuItems.map((item) => (
          <NavigationLink key={item.href} href={item.href} className="flex min-h-[73px] items-center border-b border-[#c4c5d5] px-6 text-base transition hover:bg-[#f9f9ff] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0038a8]">
            <span className="mr-4 flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e6eeff]"><Image src={`/assets/app/${item.icon}`} alt="" width={20} height={20} /></span>
            <span className="flex-1">{item.label}</span>
            <Image src="/assets/app/chevron-right.svg" alt="" width={8} height={12} />
          </NavigationLink>
        ))}
        <LogoutButton />
      </nav>
    </ProfileShell>
  );
}
