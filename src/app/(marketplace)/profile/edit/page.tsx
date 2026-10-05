import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AvatarUpload } from "@/features/profiles/components/avatar-upload";
import { EditProfileForm } from "@/features/profiles/components/edit-profile-form";
import { getOwnProfile } from "@/features/profiles/server/queries";

import { ProfileShell } from "../_components/profile-shell";
import { ProfileUnavailable } from "../_components/profile-unavailable";

export const metadata: Metadata = { title: "Edit Profile | UC Marketplace" };

export default async function EditProfilePage() {
  const { profile, error, authorization } = await getOwnProfile("/profile/edit");
  if (error || !profile) return <ProfileShell authorization={authorization} title="Edit Profile" backHref="/profile"><ProfileUnavailable /></ProfileShell>;
  if (!profile.canEdit) redirect("/profile");

  return (
    <ProfileShell authorization={authorization} title="Edit Profile" backHref="/profile">
      <section className="rounded-xl border border-[#c4c5d5] bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Edit Profile</h1>
        <p className="mb-6 mt-2 text-sm leading-6 text-[#444653]">Keep your profile information up to date.</p>
        <EditProfileForm profile={profile} />
      </section>
      <AvatarUpload avatarUrl={profile.avatarUrl} fullName={profile.fullName} />
    </ProfileShell>
  );
}
