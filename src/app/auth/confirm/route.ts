import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { hasRecoveryAuthenticationMethod } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const requestedType = request.nextUrl.searchParams.get("type");
  const code = request.nextUrl.searchParams.get("code");
  const supabase = await createClient();
  let verified = false;
  let sessionEstablished = false;

  const type: EmailOtpType | null =
    requestedType === "email" || requestedType === "signup"
      ? requestedType
      : null;

  try {
    if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });
      verified = !error;
      sessionEstablished = !error;
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      verified = !error;
      sessionEstablished = !error;
    }

    if (verified) {
      const { data, error } = await supabase.auth.getClaims();
      verified = Boolean(
        !error &&
          data?.claims?.sub &&
          !hasRecoveryAuthenticationMethod(data.claims),
      );
    }
  } catch {
    verified = false;
  }

  if (sessionEstablished) {
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        verified = false;
      }
    } catch {
      verified = false;
    }
  }

  // Keep host-only cookies on the original browser origin; NextURL can
  // normalize 127.0.0.1 to localhost even for a same-origin callback.
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: `/login?confirmation=${verified ? "success" : "failed"}` },
  });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
