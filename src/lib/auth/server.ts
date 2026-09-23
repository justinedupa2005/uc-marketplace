import "server-only";

import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

export const RECOVERY_COOKIE_NAME = "uc-marketplace-recovery";
export const RECOVERY_COOKIE_MAX_AGE_SECONDS = 15 * 60;

export function hasRecoveryAuthenticationMethod(claims: unknown) {
  if (!claims || typeof claims !== "object") {
    return false;
  }

  const amr = (claims as { amr?: unknown }).amr;

  if (!Array.isArray(amr)) {
    return false;
  }

  return amr.some((entry) => {
    if (typeof entry === "string") {
      return entry === "recovery";
    }

    return (
      entry !== null &&
      typeof entry === "object" &&
      "method" in entry &&
      (entry as { method?: unknown }).method === "recovery"
    );
  });
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

    return Boolean(
      !error &&
        claims?.sub === userId &&
        typeof claims.session_id === "string" &&
        marker === `${userId}:${claims.session_id}` &&
        hasRecoveryAuthenticationMethod(claims),
    );
  } catch {
    return false;
  }
}
