import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import {
  hasRecoveryAuthenticationMethod,
  RECOVERY_COOKIE_MAX_AGE_SECONDS,
  RECOVERY_COOKIE_NAME,
} from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

function isSafeOpaqueValue(value: string | null, maximumLength: number) {
  return Boolean(value && value.length <= maximumLength && !/[\u0000-\u001f\u007f]/.test(value));
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const requestedType = request.nextUrl.searchParams.get("type");
  const flowId = request.nextUrl.searchParams.get("sb_flow_id");
  const supabase = await createClient();
  let verifiedRecovery = false;
  let exchangeSucceeded = false;

  try {
    if (
      requestedType === "recovery" &&
      isSafeOpaqueValue(tokenHash, 4096)
    ) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash!,
        type: "recovery",
      });
      exchangeSucceeded = !error;
    } else if (isSafeOpaqueValue(code, 4096)) {
      const validFlowId =
        flowId && /^[A-Za-z0-9_-]{1,200}$/.test(flowId) ? flowId : null;
      const result = await supabase.auth.exchangeCodeForSession(
        code!,
        validFlowId ? { flowId: validFlowId } : undefined,
      );

      exchangeSucceeded = !result.error;
    }
  } catch {
    exchangeSucceeded = false;
  }

  let sessionId: string | null = null;

  if (exchangeSucceeded) {
    try {
      const { data, error } = await supabase.auth.getClaims();
      const claims = data?.claims;
      verifiedRecovery = Boolean(
        !error &&
          claims &&
          hasRecoveryAuthenticationMethod(claims),
      );
      sessionId =
        typeof claims?.session_id === "string" ? claims.session_id : null;
    } catch {
      verifiedRecovery = false;
    }
  }

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;

  if (exchangeSucceeded) {
    try {
      const result = await supabase.auth.getUser();
      user = result.error ? null : result.data.user;
    } catch {
      user = null;
    }
  }

  const cookieStore = await cookies();
  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = "/reset-password";
  redirectTo.search = "";

  if (verifiedRecovery && sessionId && user) {
    cookieStore.set(RECOVERY_COOKIE_NAME, `${user.id}:${sessionId}`, {
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

    redirectTo.searchParams.set("error", "invalid");
  }

  const response = NextResponse.redirect(redirectTo);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
