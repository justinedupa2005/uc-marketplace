"use server";

import { z } from "zod";

import { getAppUrl } from "@/lib/auth/app-url";
import { usesCodeConfirmation } from "@/lib/auth/confirmation-mode";
import { createClient } from "@/lib/supabase/server";

const emailSchema = z
  .string({ error: "Enter a valid email address." })
  .trim()
  .email("Enter a valid email address.")
  .max(254, "Email address is too long.")
  .transform((email) => email.toLowerCase());

export type ResendConfirmationState = {
  status: "idle" | "error" | "success";
  message: string | null;
};

export async function resendConfirmation(
  _previousState: ResendConfirmationState,
  formData: FormData,
): Promise<ResendConfirmationState> {
  const result = emailSchema.safeParse(formData.get("email"));

  if (!result.success) {
    return {
      status: "error",
      message: result.error.issues[0]?.message ?? "Enter a valid email address.",
    };
  }

  const codeMode = usesCodeConfirmation();
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: result.data,
      ...(!codeMode && {
        options: { emailRedirectTo: `${getAppUrl()}/auth/confirm` },
      }),
    });

    if (
      error?.code === "over_email_send_rate_limit" ||
      error?.code === "over_request_rate_limit"
    ) {
      return {
        status: "error",
        message: "Too many requests. Please wait before trying again.",
      };
    }

    if (error?.code === "email_address_not_authorized") {
      return {
        status: "error",
        message:
          "This Supabase project's default email service can only send to organization-member addresses. Use one of those addresses for testing, or configure custom SMTP for student emails.",
      };
    }

    if (error?.code === "email_address_invalid") {
      return {
        status: "error",
        message: "Enter a real email inbox that can receive messages.",
      };
    }

    if (error?.code === "email_provider_disabled") {
      return {
        status: "error",
        message: "Confirmation emails are not available right now.",
      };
    }

    if (
      error &&
      (error.status === 0 ||
        error.code === "request_timeout" ||
        error.name === "AuthRetryableFetchError")
    ) {
      return {
        status: "error",
        message: "Unable to reach the confirmation service. Please try again.",
      };
    }

    if (error) {
      console.error("Supabase confirmation resend failed", {
        code: error.code,
        status: error.status,
      });
    }
  } catch {
    return {
      status: "error",
      message: "Unable to reach the confirmation service. Please try again.",
    };
  }

  // Do not reveal whether an email address exists or has already confirmed.
  return {
    status: "success",
    message: `If this address belongs to an unconfirmed account, a new confirmation ${codeMode ? "code" : "link"} has been sent.`,
  };
}
