"use server";

import { z } from "zod";

import { getAppUrl } from "@/lib/auth/app-url";
import { createClient } from "@/lib/supabase/server";

const forgotPasswordSchema = z.object({
  email: z
    .string({ error: "Enter a valid email address." })
    .trim()
    .email("Enter a valid email address.")
    .max(254, "Email address is too long.")
    .transform((email) => email.toLowerCase()),
});

export type ForgotPasswordState = {
  status: "idle" | "error" | "success";
  message: string | null;
};

const GENERIC_SUCCESS_MESSAGE =
  "If an account exists for that email address, a password reset link has been sent.";

export async function requestPasswordReset(
  _previousState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const result = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!result.success) {
    return {
      status: "error",
      message:
        result.error.issues[0]?.message ?? "Enter a valid email address.",
    };
  }

  try {
    const appUrl = getAppUrl();
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(
      result.data.email,
      {
        redirectTo: `${appUrl}/auth/recovery`,
      },
    );

    if (error) {
      console.error("Supabase password reset request failed", {
        code: error.code,
        status: error.status,
      });

      if (
        error.code === "over_request_rate_limit" ||
        error.code === "over_email_send_rate_limit"
      ) {
        return {
          status: "error",
          message: "Too many requests. Please wait and try again later.",
        };
      }

      if (
        error.status === 0 ||
        error.code === "request_timeout" ||
        error.name === "AuthRetryableFetchError"
      ) {
        return {
          status: "error",
          message:
            "Unable to reach the password reset service. Please try again.",
        };
      }

      // Keep the response indistinguishable for registered and unregistered
      // addresses. Operational details remain server-side only.
      return { status: "success", message: GENERIC_SUCCESS_MESSAGE };
    }
  } catch {
    return {
      status: "error",
      message: "Unable to reach the password reset service. Please try again.",
    };
  }

  return { status: "success", message: GENERIC_SUCCESS_MESSAGE };
}
