import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import {
  RECOVERY_COOKIE_MAX_AGE_SECONDS,
  RECOVERY_COOKIE_NAME,
} from "@/lib/auth/server";
import {
  getRecoverySessionIdentity,
  hasRecoveryGrantSecret,
  issueRecoveryGrant,
  parseRecoveryCallback,
} from "@/lib/auth/recovery-grant";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const callback = parseRecoveryCallback(request.nextUrl.searchParams);
  const supabase = await createClient();
  let exchangeSucceeded = false;
  let exchangeUserId: string | null = null;
  let marker: string | null = null;

  try {
    if (callback?.kind === "token_hash" && hasRecoveryGrantSecret()) {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: callback.tokenHash,
        type: "recovery",
      });
      exchangeSucceeded = Boolean(!error && data.user && data.session);
      exchangeUserId = exchangeSucceeded ? data.user!.id : null;
    } else if (callback?.kind === "pkce" && hasRecoveryGrantSecret()) {
      const result = await supabase.auth.exchangeCodeForSession(
        callback.code,
        callback.flowId ? { flowId: callback.flowId } : undefined,
      );
      exchangeSucceeded = Boolean(!result.error && result.data.user && result.data.session);
      exchangeUserId = exchangeSucceeded ? result.data.user!.id : null;
    }
  } catch {
    exchangeSucceeded = false;
  }

  if (exchangeSucceeded && callback && exchangeUserId) {
    try {
      const { data, error } = await supabase.auth.getClaims();
      const result = await supabase.auth.getUser();
      const user = result.error ? null : result.data.user;
      const identity = !error && user?.id === exchangeUserId
        ? getRecoverySessionIdentity(data?.claims, user.id, callback.kind)
        : null;
      if (identity) {
        marker = issueRecoveryGrant(identity.userId, identity.sessionId);
      }
    } catch {
      marker = null;
    }
  }

  const cookieStore = await cookies();

  if (marker) {
    cookieStore.set(RECOVERY_COOKIE_NAME, marker, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: RECOVERY_COOKIE_MAX_AGE_SECONDS,
    });
  } else {
    if (exchangeSucceeded) {
      cookieStore.delete(RECOVERY_COOKIE_NAME);
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // The invalid-link screen remains safe even if Auth is unavailable.
      }
    }
  }

  // NextURL normalizes loopback hosts. A relative Location preserves the
  // browser's origin and its host-only Auth cookies without trusting headers.
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: marker ? "/reset-password" : "/reset-password?error=invalid" },
  });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export function HEAD() {
  return new NextResponse(null, { status: 405, headers: { Allow: "GET",
    "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow" } });
}
