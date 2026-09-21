"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getSafeNextPath } from "@/lib/auth/redirects";
import { RECOVERY_COOKIE_NAME } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(256),
});

export type LoginState = {
  message: string | null;
};

export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const result = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return { message: "Enter a valid email address and password." };
  }

  const destination = getSafeNextPath(formData.get("next"));
  let redirectTo = destination;
  let signedIn = false;
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null;

  try {
    supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword(result.data);

    if (error) {
      if (
        error.code === "over_request_rate_limit" ||
        error.code === "over_email_send_rate_limit"
      ) {
        return {
          message: "Too many login attempts. Please wait and try again.",
        };
      }

      // Keep authentication failures generic so the response does not reveal
      // whether an email address has an account or has been confirmed.
      return {
        message:
          "Unable to log in with those details. Check your credentials and account confirmation.",
      };
    }

    signedIn = true;

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      await supabase.auth.signOut({ scope: "local" });
      return {
        message: "Your login session could not be verified. Please try again.",
      };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("account_status, verification_status")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) {
      console.error("Unable to validate the login profile", {
        code: profileError?.code,
      });
      await supabase.auth.signOut({ scope: "local" });
      return {
        message:
          "Your account profile is not ready. Please contact support before trying again.",
      };
    }

    if (profile.account_status === "disabled") {
      await supabase.auth.signOut({ scope: "local" });
      return {
        message:
          "This account has been disabled. Contact an administrator if you believe this is a mistake.",
      };
    }

    if (profile.account_status === "suspended") {
      redirectTo = "/account-status";
    } else if (profile.account_status !== "active") {
      await supabase.auth.signOut({ scope: "local" });
      return {
        message: "This account is not available for marketplace access.",
      };
    }

    const cookieStore = await cookies();
    cookieStore.delete(RECOVERY_COOKIE_NAME);
  } catch {
    if (signedIn && supabase) {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // The next protected request still verifies the user and profile.
      }
    }

    return {
      message: "Unable to reach the login service. Please try again.",
    };
  }

  redirect(redirectTo);
}
