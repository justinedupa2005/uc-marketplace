"use server";

import { randomUUID } from "node:crypto";
import { createClient as createAuthClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { hasMatchingListingImageSignature } from "@/features/listings/validation";
import { canEditProfileIdentity, canEditProfileYear, getAvatarFileError, isOwnedAvatarPath } from "@/features/profiles/rules";
import type { ProfileActionState } from "@/features/profiles/types";
import { changePasswordSchema, getProfileFieldErrors, profileDetailsSchema } from "@/features/profiles/validation";
import { parseAuthorizationProfile, requireActiveProfile, requireAuthenticatedProfile } from "@/lib/auth/authorization";
import type { AppSupabaseClient } from "@/lib/supabase/types";

function failure(message: string, fieldErrors?: Record<string, string[]>): ProfileActionState {
  return { status: "error", message, fieldErrors };
}

function refreshProfile(userId: string) {
  // Profile names and avatars also appear in listings and conversation headers.
  revalidatePath("/", "layout");
  revalidatePath(`/users/${userId}`);
}

async function readProfileForUpdate(supabase: AppSupabaseClient, userId: string) {
  return supabase.from("profiles")
    .select("role,verification_status,account_status,avatar_path,updated_at")
    .eq("id", userId).maybeSingle();
}

export async function updateProfile(_previous: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  try {
    const { supabase, user } = await requireActiveProfile("/profile/edit");
    const { data: current, error: readError } = await readProfileForUpdate(supabase, user.id);
    const authorization = parseAuthorizationProfile(current);
    if (readError || !current || !authorization) return failure("Your profile is unavailable. Refresh and try again.");
    const identityEditable = canEditProfileIdentity(authorization);
    const yearEditable = canEditProfileYear(authorization) && authorization.role === "student";
    if (!identityEditable && !yearEditable) return failure("Identity details cannot be changed while verification is pending. You can still change your profile photo.");
    if ((!identityEditable && (formData.has("fullName") || formData.has("course"))) ||
      (!yearEditable && formData.has("yearLevel"))) {
      return failure("Your verification status changed. Refresh before editing your profile.");
    }
    const parsed = profileDetailsSchema.safeParse({
      fullName: identityEditable ? formData.get("fullName") : undefined,
      course: identityEditable && authorization.role === "student" ? formData.get("course") : undefined,
      yearLevel: yearEditable ? formData.get("yearLevel") : undefined,
      updatedAt: formData.get("updatedAt"),
    });
    if (!parsed.success) return failure("Check your profile information and try again.", getProfileFieldErrors(parsed.error));
    const update: { full_name?: string; course?: string; year_level?: number } = {};
    if (identityEditable) update.full_name = parsed.data.fullName;
    if (identityEditable && authorization.role === "student") update.course = parsed.data.course;
    if (yearEditable) update.year_level = parsed.data.yearLevel;
    const { data, error } = await supabase.from("profiles").update(update)
      .eq("id", user.id).eq("updated_at", parsed.data.updatedAt).select("id,updated_at").maybeSingle();
    if (error) {
      console.warn("Profile update failed", { code: error.code });
      return failure(error.code === "42501" ? "Your account or verification status changed. Refresh before editing." : "Unable to update your profile. Please try again.");
    }
    if (!data) return failure("Your profile changed while you were editing. Refresh and review the latest information.");
    refreshProfile(user.id);
    return { status: "success", message: "Profile updated successfully.", updatedAt: data.updated_at };
  } catch (error) {
    unstable_rethrow(error);
    return failure("Unable to update your profile. Please try again.");
  }
}

async function removeUnusedAvatar(supabase: AppSupabaseClient, userId: string, path: string) {
  if (!isOwnedAvatarPath(userId, path)) return;
  try {
    // Check after the mutation; Storage also denies deletion of a referenced photo.
    const { data, error } = await supabase.from("profiles").select("avatar_path").eq("id", userId).maybeSingle();
    if (error || !data || data.avatar_path === path) return;
    const removed = await supabase.storage.from("avatars").remove([path]);
    if (removed.error) console.warn("Unused avatar cleanup failed");
  } catch {
    // Cleanup must not turn a successful profile change into a failed result.
    console.warn("Unused avatar cleanup unavailable");
  }
}

export async function uploadAvatar(_previous: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  let cleanup: { supabase: AppSupabaseClient; userId: string; path: string } | null = null;
  try {
    const { supabase, user } = await requireActiveProfile("/profile/edit");
    const file = formData.get("avatar");
    if (!(file instanceof File)) return failure("Please choose a profile photo.");
    const fileError = getAvatarFileError(file);
    if (fileError) return failure(fileError);
    if (!(await hasMatchingListingImageSignature(file))) return failure("The image contents do not match its file type. Choose a valid JPG, PNG, or WebP image.");
    const { data: current, error: readError } = await readProfileForUpdate(supabase, user.id);
    if (readError || !current || current.account_status !== "active") return failure("Your profile is unavailable. Refresh and try again.");
    const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    const newPath = `${user.id}/${randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(newPath, file, { contentType: file.type, cacheControl: "3600", upsert: false });
    if (uploadError) return failure("Unable to upload your profile photo. Please try again.");
    cleanup = { supabase, userId: user.id, path: newPath };
    let update = supabase.from("profiles").update({ avatar_path: newPath }).eq("id", user.id);
    update = current.avatar_path === null ? update.is("avatar_path", null) : update.eq("avatar_path", current.avatar_path);
    const { data, error } = await update.select("id").maybeSingle();
    if (error || !data) {
      await removeUnusedAvatar(supabase, user.id, newPath);
      return failure("Your photo could not be saved or changed in another session. Refresh and try again.");
    }
    cleanup = null;
    if (current.avatar_path) await removeUnusedAvatar(supabase, user.id, current.avatar_path);
    refreshProfile(user.id);
    return { status: "success", message: "Profile photo updated successfully." };
  } catch (error) {
    unstable_rethrow(error);
    if (cleanup) {
      try { await removeUnusedAvatar(cleanup.supabase, cleanup.userId, cleanup.path); } catch { /* Preserve a potentially committed photo if the service is unavailable. */ }
    }
    return failure("Unable to upload your profile photo. Please try again.");
  }
}

export async function removeAvatar(): Promise<ProfileActionState> {
  try {
    const { supabase, user } = await requireActiveProfile("/profile/edit");
    const { data: current, error: readError } = await readProfileForUpdate(supabase, user.id);
    if (readError || !current) return failure("Your profile is unavailable. Refresh and try again.");
    if (!current.avatar_path) return { status: "success", message: "Your profile already uses the default avatar." };
    const { data, error } = await supabase.from("profiles").update({ avatar_path: null })
      .eq("id", user.id).eq("avatar_path", current.avatar_path).select("id").maybeSingle();
    if (error || !data) return failure("Your photo changed or could not be removed. Refresh and try again.");
    await removeUnusedAvatar(supabase, user.id, current.avatar_path);
    refreshProfile(user.id);
    return { status: "success", message: "Profile photo removed." };
  } catch (error) {
    unstable_rethrow(error);
    return failure("Unable to remove your profile photo. Please try again.");
  }
}

export async function changePassword(_previous: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  try {
    const { supabase, user } = await requireAuthenticatedProfile("/profile/change-password");
    const code = formData.get("nonce");
    const parsed = changePasswordSchema.safeParse({
      currentPassword: formData.get("currentPassword"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
      nonce: typeof code === "string" && code.trim() ? code : undefined,
    });
    if (!parsed.success) return failure("Check your password details and try again.", getProfileFieldErrors(parsed.error));
    if (!user.email) return failure("Password changes are unavailable for this account. Use the account recovery flow.");
    // Some Auth deployments ignore current_password unless their setting is
    // enabled. Verify it through Auth independently without replacing the
    // current SSR cookies or retaining a second sign-in session.
    const verifier = createAuthClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    const confirmed = await verifier.auth.signInWithPassword({ email: user.email, password: parsed.data.currentPassword });
    if (confirmed.error || confirmed.data.user?.id !== user.id) {
      if (confirmed.data.session) await verifier.auth.signOut({ scope: "local" });
      return failure(confirmed.error?.code === "over_request_rate_limit" ? "Too many attempts. Please wait and try again." : "Your current password could not be confirmed. Check it and try again.", { currentPassword: ["Enter your current password."] });
    }
    const signedOut = await verifier.auth.signOut({ scope: "local" });
    if (signedOut.error) console.warn("Password confirmation session cleanup failed", { code: signedOut.error.code });
    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
      current_password: parsed.data.currentPassword,
      ...(parsed.data.nonce ? { nonce: parsed.data.nonce } : {}),
    });
    if (error) {
      switch (error.code) {
        case "reauthentication_needed":
        case "reauthentication_not_valid":
          return { status: "error", message: "Confirm this password change with a verification code. Send a code, then enter it below and try again.", requiresReauthentication: true };
        case "invalid_credentials":
        case "invalid_password":
        case "current_password_mismatch":
        case "current_password_required":
          return failure("Your current password is incorrect.", { currentPassword: ["Check your current password."] });
        case "same_password": return failure("Choose a password that is different from your current password.");
        case "weak_password": return failure("Choose a stronger password that meets every requirement.");
        case "over_request_rate_limit": return failure("Too many attempts. Please wait and try again.");
        case "session_not_found":
        case "session_expired":
        case "refresh_token_not_found": return failure("Your session has expired. Please log in again.");
        default: return failure("Unable to update your password. Please try again.");
      }
    }
    revalidatePath("/profile/change-password");
    return { status: "success", message: "Password updated successfully. You remain signed in on this device." };
  } catch (error) {
    unstable_rethrow(error);
    return failure("Unable to reach the password service. Please try again.");
  }
}

export async function requestPasswordReauthentication(): Promise<ProfileActionState> {
  try {
    const { supabase } = await requireAuthenticatedProfile("/profile/change-password");
    const { error } = await supabase.auth.reauthenticate();
    if (error) return failure(error.code === "over_request_rate_limit" ? "Please wait before requesting another code." : "Unable to send a verification code. Please try again, or log out and log in again.");
    return { status: "success", message: "Check your account email for the verification code.", requiresReauthentication: true };
  } catch (error) {
    unstable_rethrow(error);
    return failure("Unable to send a verification code. Please try again.");
  }
}
