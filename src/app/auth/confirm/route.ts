import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const requestedType = request.nextUrl.searchParams.get("type");
  const code = request.nextUrl.searchParams.get("code");
  const supabase = await createClient();
  let verified = false;

  const type: EmailOtpType | null =
    requestedType === "email" || requestedType === "signup"
      ? requestedType
      : null;

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    verified = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    verified = !error;
  }

  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = "/login";
  redirectTo.search = "";

  if (verified) {
    await supabase.auth.signOut();
    redirectTo.searchParams.set("confirmation", "success");
  } else {
    redirectTo.searchParams.set("confirmation", "failed");
  }

  return NextResponse.redirect(redirectTo);
}
