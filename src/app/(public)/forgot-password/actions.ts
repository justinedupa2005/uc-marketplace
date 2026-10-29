"use server";

import { z } from "zod";

import { getAppUrl } from "@/lib/auth/app-url";
import { createClient } from "@/lib/supabase/server";
import { reportOperationalEvent } from "@/lib/observability/events";

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
  "If an account exists for that email address, check your inbox for a password reset link. Wait before requesting another link.";

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
      reportOperationalEvent("email_request_failed", { operation: "recover", code: error.code, status: error.status });

      // Keep the response indistinguishable for registered and unregistered
      // addresses. Operational details remain server-side only.
      return { status: "success", message: GENERIC_SUCCESS_MESSAGE };
    }
  } catch {
    reportOperationalEvent("email_request_failed", { operation: "recover" });
    // Provider throttles/outages can depend on whether an account exists.
    // Valid email inputs always receive the same public response; never retry.
    return { status: "success", message: GENERIC_SUCCESS_MESSAGE };
  }

  return { status: "success", message: GENERIC_SUCCESS_MESSAGE };
}
