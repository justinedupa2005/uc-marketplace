"use server";

import { redirect } from "next/navigation";

import { getAppUrl } from "@/lib/auth/app-url";
import { usesCodeConfirmation } from "@/lib/auth/confirmation-mode";
import { registrationSchema } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

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
      return "Registration could not be completed. This email or student ID may already be associated with an account.";
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
    studentIdNumber: formData.get("studentIdNumber"),
    course: formData.get("course"),
    yearLevel: formData.get("yearLevel"),
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

  const {
    fullName,
    studentIdNumber,
    course,
    yearLevel,
    email,
    password,
  } = result.data;
  const codeMode = usesCodeConfirmation();
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          student_id_number: studentIdNumber,
          course,
          year_level: yearLevel,
        },
        ...(!codeMode && {
          emailRedirectTo: `${getAppUrl()}/auth/confirm`,
        }),
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

    // Email confirmation must be enabled in Supabase for code verification.
    // A session here means Auth accepted the signup without a code.
    if (data.session) {
      await supabase.auth.signOut({ scope: "local" });
      return {
        message:
          "Email verification is unavailable right now. Please contact support before signing in.",
      };
    }
  } catch {
    return {
      message: "Unable to reach the registration service. Please try again.",
    };
  }

  redirect("/register/check-email");
}
