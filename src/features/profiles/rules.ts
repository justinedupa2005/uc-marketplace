import type { AuthorizationProfile } from "@/lib/auth/authorization";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PUBLIC_PROFILE_PAGE_SIZE = 12;

export function canEditProfileIdentity(profile: AuthorizationProfile) {
  return profile.account_status === "active" &&
    (profile.role === "admin" || !["pending", "verified"].includes(profile.verification_status));
}

export function canEditProfileYear(profile: AuthorizationProfile) {
  return profile.account_status === "active" &&
    (profile.role === "admin" || profile.verification_status !== "pending");
}

export function getProfileInitials(name: string | null) {
  return name?.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "";
}

export function formatProfileJoined(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "Asia/Manila" }).format(date)
    : null;
}

export function getPublicProfilePage(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || !/^[1-9]\d*$/.test(first)) return 1;
  const parsed = Number(first);
  return Number.isSafeInteger(parsed) && parsed <= 1000 ? parsed : 1;
}

export function isOwnedAvatarPath(userId: string, path: string) {
  const [owner, file, ...rest] = path.split("/");
  return owner === userId && rest.length === 0 &&
    /^(?:avatar\.(?:jpe?g|png|webp)|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp))$/.test(file ?? "");
}

export function getAvatarFileError(file: { size: number; type: string }) {
  if (!(AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) return "Please choose a JPG, PNG, or WebP image.";
  if (file.size <= 0) return "Please choose a non-empty image.";
  if (file.size > MAX_AVATAR_BYTES) return "Profile photo must be 2 MB or smaller.";
  return null;
}
