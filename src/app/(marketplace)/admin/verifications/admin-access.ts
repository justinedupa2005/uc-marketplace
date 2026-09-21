import "server-only";

import { redirect } from "next/navigation";

import { getValidatedUser } from "@/lib/auth/server";

export async function getActiveAdmin() {
  const auth = await getValidatedUser();

  if (!auth.user) {
    return null;
  }

  const { data: profile, error } = await auth.supabase
    .from("profiles")
    .select("role, account_status")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (error || profile?.role !== "admin" || profile.account_status !== "active") {
    return null;
  }

  return auth;
}

export async function requireActiveAdmin() {
  const auth = await getActiveAdmin();

  if (!auth) {
    redirect("/marketplace");
  }

  return auth;
}

export const VERIFICATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
