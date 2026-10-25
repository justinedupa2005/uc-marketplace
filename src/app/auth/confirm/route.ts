import { type NextRequest, NextResponse } from "next/server";

import { parseConfirmationCallback } from "@/lib/auth/confirmation-callback";
import { hasRecoveryAuthenticationMethod } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const callback = parseConfirmationCallback(request.nextUrl.searchParams);
  const supabase = await createClient();
  let verified = false;
  let sessionEstablished = false;
  let pendingEmailChange = false;
  let exchangeUserId: string | null = null;

  try {
    if (callback?.kind === "token_hash") {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: callback.tokenHash,
        type: callback.type,
      });
      pendingEmailChange = !error && callback.type === "email_change" && !data.session;
      verified = !error && Boolean(data.user && data.session);
      sessionEstablished = verified;
      exchangeUserId = verified ? data.user!.id : null;
    } else if (callback?.kind === "pkce") {
      const { data, error } = await supabase.auth.exchangeCodeForSession(callback.code,
        callback.flowId ? { flowId: callback.flowId } : undefined);
      verified = !error && Boolean(data.user && data.session);
      sessionEstablished = verified;
      exchangeUserId = verified ? data.user!.id : null;
    }

    if (verified) {
      const { data, error } = await supabase.auth.getClaims();
      verified = Boolean(
        !error &&
          data?.claims?.sub === exchangeUserId &&
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
    headers: { Location: `/login?confirmation=${pendingEmailChange ? "pending" : verified ? "success" : "failed"}` },
  });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

// Next otherwise implements HEAD by executing GET, consuming one-use tokens.
export function HEAD() {
  return new NextResponse(null, { status: 405, headers: { Allow: "GET",
    "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow" } });
}
