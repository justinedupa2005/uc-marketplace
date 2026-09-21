"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const verificationCodeSchema = z.object({
  email: z
    .string({ error: "Enter a valid email address." })
    .trim()
    .email("Enter a valid email address.")
    .max(254, "Email address is too long.")
    .transform((email) => email.toLowerCase()),
  code: z
    .string({ error: "Enter the eight-digit code." })
    .trim()
    .regex(/^\d{8}$/, "Enter the eight-digit code."),
});

export type VerificationCodeState = { message: string | null };

export async function verifyRegistrationCode(
  _previousState: VerificationCodeState,
  formData: FormData,
): Promise<VerificationCodeState> {
  const result = verificationCodeSchema.safeParse({
    email: formData.get("email"),
    code: formData.get("code"),
  });

  if (!result.success) {
    return {
      message: result.error.issues[0]?.message ?? "Check your email and code.",
    };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      email: result.data.email,
      token: result.data.code,
      type: "email",
    });

    if (error) {
      if (
        error.code === "over_request_rate_limit" ||
        error.code === "over_email_send_rate_limit"
      ) {
        return { message: "Too many attempts. Please wait before trying again." };
      }

      return {
        message: "The code is invalid or expired. Request a new code and try again.",
      };
    }

    // OTP verification establishes a session. Registration finishes at Login.
    const { error: signOutError } = await supabase.auth.signOut({
      scope: "local",
    });

    if (signOutError) {
      console.error("Unable to end registration verification session", {
        code: signOutError.code,
        status: signOutError.status,
      });
      return {
        message: "Your email was verified, but we could not finish signing out. Please refresh and try logging in.",
      };
    }
  } catch {
    return {
      message: "Unable to reach the verification service. Please try again.",
    };
  }

  redirect("/login?confirmation=success");
}
