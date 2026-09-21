"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  getValidatedUser,
  hasRecoveryMarker,
  RECOVERY_COOKIE_NAME,
} from "@/lib/auth/server";
import { resetPasswordSchema } from "@/lib/auth/validation";

export type ResetPasswordState = {
  message: string | null;
  status: "idle" | "error" | "password-updated";
};

function getPasswordUpdateError(code: string | undefined) {
  switch (code) {
    case "weak_password":
      return "Choose a stronger password that meets every requirement.";
    case "same_password":
      return "Choose a password that is different from your current password.";
    case "reauthentication_needed":
    case "reauthentication_not_valid":
      return "This password reset link is no longer valid. Request a new one.";
    case "session_not_found":
    case "session_expired":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
      return "This password reset link is invalid or has expired.";
    case "over_request_rate_limit":
      return "Too many attempts. Please wait and try again.";
    default:
      return "Your password could not be updated. Request a new reset link and try again.";
  }
}

export async function updatePassword(
  _previousState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const result = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!result.success) {
    return {
      status: "error",
      message:
        result.error.issues[0]?.message ??
        "Check your new password and try again.",
    };
  }

  let passwordUpdated = false;
  let invalidRecovery = false;

  try {
    const { supabase, user } = await getValidatedUser();

    if (!user || !(await hasRecoveryMarker(user.id))) {
      const cookieStore = await cookies();
      cookieStore.delete(RECOVERY_COOKIE_NAME);
      invalidRecovery = true;
    } else {
      const { error } = await supabase.auth.updateUser({
        password: result.data.password,
      });

      if (error) {
        return {
          status: "error",
          message: getPasswordUpdateError(error.code),
        };
      }

      passwordUpdated = true;

      const { error: signOutError } = await supabase.auth.signOut({
        scope: "local",
      });

      const cookieStore = await cookies();
      cookieStore.delete(RECOVERY_COOKIE_NAME);

      if (signOutError) {
        console.error("Password changed but local recovery sign-out reported an error", {
          code: signOutError.code,
          status: signOutError.status,
        });

        return {
          status: "password-updated",
          message:
            "Your password was updated, but we could not confirm sign-out. Use Log Out below before signing in again.",
        };
      }
    }
  } catch {
    if (passwordUpdated) {
      const cookieStore = await cookies();
      cookieStore.delete(RECOVERY_COOKIE_NAME);
      return {
        status: "password-updated",
        message:
          "Your password was updated, but we could not confirm sign-out. Use Log Out below before signing in again.",
      };
    }

    return {
      status: "error",
      message: "Unable to reach the password service. Please try again.",
    };
  }

  if (invalidRecovery) {
    redirect("/reset-password?error=invalid");
  }

  if (passwordUpdated) {
    redirect("/login?passwordUpdated=success");
  }

  return {
    status: "error",
    message: "Your password could not be updated. Please try again.",
  };
}
