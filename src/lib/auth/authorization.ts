import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { isAuthServiceUnavailable } from "@/lib/auth/errors";
import { getSafeNextPath } from "@/lib/auth/redirects";
import { getValidatedUser, hasRecoveryMarker } from "@/lib/auth/server";

export type AccountRole = "student" | "admin";
export type VerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "rejected";
export type AccountStatus = "active" | "suspended" | "disabled";

export type AuthorizationProfile = {
  role: AccountRole;
  verification_status: VerificationStatus;
  account_status: AccountStatus;
};

export type ProfileAccessIssue = "missing" | "invalid" | "unavailable";

type ValidatedAuth = Awaited<ReturnType<typeof getValidatedUser>>;

export type AuthorizedAccessContext = {
  supabase: ValidatedAuth["supabase"];
  user: NonNullable<ValidatedAuth["user"]>;
  profile: AuthorizationProfile;
};

const accountRoles = new Set<string>(["student", "admin"]);
const verificationStatuses = new Set<string>([
  "unverified",
  "pending",
  "verified",
  "rejected",
]);
const accountStatuses = new Set<string>([
  "active",
  "suspended",
  "disabled",
]);

function matchesRouteRoot(pathname: string, root: string) {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function parseAuthorizationProfile(
  value: unknown,
): AuthorizationProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const profile = value as Record<string, unknown>;

  if (
    typeof profile.role !== "string" ||
    !accountRoles.has(profile.role) ||
    typeof profile.verification_status !== "string" ||
    !verificationStatuses.has(profile.verification_status) ||
    typeof profile.account_status !== "string" ||
    !accountStatuses.has(profile.account_status)
  ) {
    return null;
  }

  return {
    role: profile.role as AccountRole,
    verification_status: profile.verification_status as VerificationStatus,
    account_status: profile.account_status as AccountStatus,
  };
}

export function isActiveAdmin(profile: AuthorizationProfile | null) {
  return profile?.role === "admin" && profile.account_status === "active";
}

export function isVerifiedActiveStudent(
  profile: AuthorizationProfile | null,
) {
  return (
    profile?.role === "student" &&
    profile.verification_status === "verified" &&
    profile.account_status === "active"
  );
}

export function needsStudentVerification(
  profile: AuthorizationProfile | null,
) {
  return (
    profile?.role === "student" &&
    profile.account_status === "active" &&
    profile.verification_status !== "verified"
  );
}

export function getAuthorizedDestination(
  profile: AuthorizationProfile | null,
  requestedPath?: string | null,
) {
  if (!profile || profile.account_status !== "active") {
    return "/account-status";
  }

  const candidate = requestedPath
    ? getSafeNextPath(requestedPath, "")
    : "";
  const pathname = candidate.split("?", 1)[0];

  if (profile.role === "admin") {
    return candidate &&
      (matchesRouteRoot(pathname, "/admin") ||
        matchesRouteRoot(pathname, "/profile"))
      ? candidate
      : "/admin/verifications";
  }

  if (profile.verification_status !== "verified") {
    return candidate &&
      (matchesRouteRoot(pathname, "/profile") ||
        matchesRouteRoot(pathname, "/verification"))
      ? candidate
      : "/verification";
  }

  return candidate && !matchesRouteRoot(pathname, "/admin")
    ? candidate
    : "/marketplace";
}

export const getCurrentAccessContext = cache(async () => {
  const auth = await getValidatedUser();

  if (!auth.user) {
    return {
      ...auth,
      profile: null,
      profileIssue: null as ProfileAccessIssue | null,
    };
  }

  try {
    const { data, error } = await auth.supabase
      .from("profiles")
      .select("role, verification_status, account_status")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (error) {
      return {
        ...auth,
        profile: null,
        profileIssue: "unavailable" as const,
      };
    }

    const profile = parseAuthorizationProfile(data);

    return {
      ...auth,
      profile,
      profileIssue: profile
        ? null
        : data
          ? ("invalid" as const)
          : ("missing" as const),
    };
  } catch {
    return {
      ...auth,
      profile: null,
      profileIssue: "unavailable" as const,
    };
  }
});

function getLoginPath(nextPath: string, authUnavailable = false) {
  const safeNextPath = getSafeNextPath(nextPath);
  const params = new URLSearchParams({ next: safeNextPath });

  if (authUnavailable) {
    params.set("auth", "unavailable");
  }

  return `/login?${params.toString()}`;
}

function toAuthorizedContext(
  access: Awaited<ReturnType<typeof getCurrentAccessContext>>,
): AuthorizedAccessContext {
  return {
    supabase: access.supabase,
    user: access.user!,
    profile: access.profile!,
  };
}

export async function requireActiveProfile(nextPath = "/profile") {
  let access: Awaited<ReturnType<typeof getCurrentAccessContext>>;

  try {
    access = await getCurrentAccessContext();
  } catch (error) {
    redirect(getLoginPath(nextPath, isAuthServiceUnavailable(error)));
  }

  if (!access.user) {
    redirect(
      getLoginPath(nextPath, isAuthServiceUnavailable(access.error)),
    );
  }

  if (await hasRecoveryMarker(access.user.id)) {
    redirect("/reset-password");
  }

  if (!access.profile || access.profile.account_status !== "active") {
    redirect("/account-status");
  }

  return toAuthorizedContext(access);
}

export async function requireActiveStudent(nextPath = "/verification") {
  const access = await requireActiveProfile(nextPath);

  if (access.profile.role !== "student") {
    redirect(getAuthorizedDestination(access.profile));
  }

  return access;
}

export async function requireVerifiedActiveStudent(
  nextPath = "/marketplace",
) {
  const access = await requireActiveStudent(nextPath);

  if (!isVerifiedActiveStudent(access.profile)) {
    redirect("/verification");
  }

  return access;
}

export async function getActiveAdmin() {
  let access: Awaited<ReturnType<typeof getCurrentAccessContext>>;

  try {
    access = await getCurrentAccessContext();
  } catch {
    return null;
  }

  if (
    !access.user ||
    !isActiveAdmin(access.profile) ||
    (await hasRecoveryMarker(access.user.id))
  ) {
    return null;
  }

  return toAuthorizedContext(access);
}

export async function requireActiveAdmin(nextPath = "/admin/verifications") {
  const access = await requireActiveProfile(nextPath);

  if (!isActiveAdmin(access.profile)) {
    redirect(getAuthorizedDestination(access.profile));
  }

  return access;
}

export async function redirectAuthenticatedUser() {
  let access: Awaited<ReturnType<typeof getCurrentAccessContext>>;

  try {
    access = await getCurrentAccessContext();
  } catch {
    // A temporary Auth outage should not make public auth pages fail.
    return;
  }

  if (!access.user) {
    return;
  }

  if (await hasRecoveryMarker(access.user.id)) {
    redirect("/reset-password");
  }

  redirect(getAuthorizedDestination(access.profile));
}
