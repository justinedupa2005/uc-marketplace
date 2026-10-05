import { NavigationLink } from "@/components/navigation-blocker";
import { LogoutButton } from "@/features/profiles/components/logout-button";
import { ProfileReloadButton } from "@/features/profiles/components/profile-reload-button";

export function ProfileUnavailable() {
  return (
    <section className="overflow-hidden rounded-xl border border-[#c4c5d5] bg-white shadow-sm">
      <div className="space-y-5 p-7 text-center">
        <h1 className="text-2xl font-bold">Profile temporarily unavailable</h1>
        <p className="text-sm leading-6 text-[#444653]">We couldn&apos;t load your profile details. Please try again.</p>
        <ProfileReloadButton />
        <NavigationLink href="/profile/change-password" className="block text-sm font-semibold text-[#002576] underline underline-offset-4">Change Password</NavigationLink>
      </div>
      <div className="border-t border-[#c4c5d5]"><LogoutButton /></div>
    </section>
  );
}
