import "server-only";

import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import {
  hasAuthenticationMethod,
  RECOVERY_GRANT_MAX_AGE_SECONDS,
  verifyRecoveryGrant,
} from "@/lib/auth/recovery-grant";

export const RECOVERY_COOKIE_NAME = "uc-marketplace-recovery";
export const RECOVERY_COOKIE_MAX_AGE_SECONDS = RECOVERY_GRANT_MAX_AGE_SECONDS;

export function hasRecoveryAuthenticationMethod(claims: unknown) {
  return hasAuthenticationMethod(claims, "recovery");
}

export async function getValidatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return {
    supabase,
    user: error ? null : user,
    error,
  };
}

export async function hasRecoveryMarker(userId: string) {
  const cookieStore = await cookies();
  const marker = cookieStore.get(RECOVERY_COOKIE_NAME)?.value;

  if (!marker) {
    return false;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;

    if (error || claims?.sub !== userId || typeof claims.session_id !== "string") return false;
    // Only a signed, time-bounded grant can establish app recovery provenance.
    // Neither an OTP nor a legacy recovery session can recreate a plain cookie.
    return verifyRecoveryGrant(marker, userId, claims.session_id)
      && (hasAuthenticationMethod(claims, "otp") || hasRecoveryAuthenticationMethod(claims));
  } catch {
    return false;
  }
}
