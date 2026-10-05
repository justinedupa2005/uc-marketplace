import type { Metadata } from "next";

import { ChangePasswordForm } from "@/features/profiles/components/change-password-form";
import { getOwnProfile } from "@/features/profiles/server/queries";

import { ProfileShell } from "../_components/profile-shell";

export const metadata: Metadata = { title: "Change Password | UC Marketplace" };

export default async function ChangePasswordPage() {
  const { authorization } = await getOwnProfile("/profile/change-password");

  return (
    <ProfileShell authorization={authorization} title="Change Password" backHref="/profile">
      <section className="rounded-xl border border-[#c4c5d5] bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Change Password</h1>
        <p className="mb-6 mt-2 text-sm leading-6 text-[#444653]">Enter your current password and choose a new password for your account.</p>
        <ChangePasswordForm />
      </section>
    </ProfileShell>
  );
}
