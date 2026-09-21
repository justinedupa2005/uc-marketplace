import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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

export async function redirectAuthenticatedUser() {
  let authContext: Awaited<ReturnType<typeof getValidatedUser>>;

  try {
    authContext = await getValidatedUser();
  } catch {
    // A temporary Auth outage should not make public login/register pages fail.
    return;
  }

  if (!authContext.user) {
    return;
  }

  if (await hasRecoveryMarker(authContext.user.id)) {
    redirect("/reset-password");
  }

  let accountStatus: string | null = null;

  try {
    const { data: profile, error } = await authContext.supabase
      .from("profiles")
      .select("account_status")
      .eq("id", authContext.user.id)
      .maybeSingle();
    accountStatus = error ? null : (profile?.account_status ?? null);
  } catch {
    accountStatus = null;
  }

  redirect(
    accountStatus === "active"
      ? "/marketplace"
      : "/account-status",
  );
}
