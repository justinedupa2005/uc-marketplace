"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { RECOVERY_COOKIE_NAME } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export async function logout() {
  let signedOut = false;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });

    if (error) {
      console.error("Unable to revoke the local Supabase session", {
        code: error.code,
        status: error.status,
      });
    } else {
      signedOut = true;
    }
  } catch {
    console.error("Unable to reach Supabase while signing out");
  }

  if (signedOut) {
    const cookieStore = await cookies();
    cookieStore.delete(RECOVERY_COOKIE_NAME);
  }

  redirect(signedOut ? "/login?loggedOut=true" : "/login?loggedOut=failed");
}
