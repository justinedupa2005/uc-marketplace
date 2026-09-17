"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

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

  const supabase = await createClient();

  try {
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
  } catch {
    return {
      message: "Unable to reach the login service. Please try again.",
    };
  }

  redirect("/marketplace");
}
