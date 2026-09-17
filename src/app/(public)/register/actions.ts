"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const passwordSchema = z
  .string()
  .min(12, "Password must contain at least 12 characters.")
  .max(256, "Password is too long.")
  .regex(/[a-z]/, "Password must include a lowercase letter.")
  .regex(/[A-Z]/, "Password must include an uppercase letter.")
  .regex(/[0-9]/, "Password must include a number.")
  .regex(/[^A-Za-z0-9]/, "Password must include a symbol.");

const registrationSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter your full name.")
    .max(100, "Your name is too long."),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address.")
    .max(254, "Email address is too long.")
    .transform((email) => email.toLowerCase()),
  password: passwordSchema,
  confirmPassword: z.string().max(256, "Password confirmation is too long."),
}).refine(({ password, confirmPassword }) => password === confirmPassword, {
  message: "Passwords do not match.",
  path: ["confirmPassword"],
});

export type RegistrationState = {
  message: string | null;
};

function getRegistrationError(code: string | undefined) {
  switch (code) {
    case "user_already_exists":
    case "email_exists":
      return "Registration could not be completed. Check your details or try logging in.";
    case "weak_password":
      return "Choose a stronger password and try again.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many registration attempts. Please wait and try again.";
    case "email_address_not_authorized":
      return "Supabase cannot send a confirmation to this address with its default email service. Use the email connected to your Supabase organization for testing, or configure custom SMTP.";
    case "email_address_invalid":
      return "Enter a real email inbox. Example and test email domains are not supported.";
    case "captcha_failed":
      return "The security check failed. Refresh the page and try again.";
    case "email_provider_disabled":
    case "signup_disabled":
      return "New account registration is currently unavailable.";
    case "request_timeout":
      return "Supabase took too long to respond. Please try again.";
    case "validation_failed":
      return "Check your registration details and try again.";
    case "unexpected_failure":
      return "Supabase could not save the account. Check the project Auth logs for the database error.";
    default:
      return "Registration was unsuccessful. Please try again.";
  }
}

export async function register(
  _previousState: RegistrationState,
  formData: FormData,
): Promise<RegistrationState> {
  const result = registrationSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!result.success) {
    return {
      message:
        result.error.issues[0]?.message ??
        "Check your registration details and try again.",
    };
  }

  const { fullName, email, password } = result.data;
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  const supabase = await createClient();
  let requiresEmailConfirmation = true;

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        emailRedirectTo: `${appUrl}/auth/confirm`,
      },
    });

    if (error) {
      // Log only diagnostic metadata. Never log email addresses or passwords.
      console.error("Supabase registration failed", {
        code: error.code,
        status: error.status,
      });

      return { message: getRegistrationError(error.code) };
    }

    requiresEmailConfirmation = data.session === null;

    // When email confirmation is disabled, signUp creates a session. The
    // requested flow sends all new users to Login, so clear that session.
    if (data.session) {
      await supabase.auth.signOut();
    }
  } catch {
    return {
      message: "Unable to reach the registration service. Please try again.",
    };
  }

  redirect(
    requiresEmailConfirmation
      ? "/login?registered=check-email"
      : "/login?registered=ready",
  );
}
