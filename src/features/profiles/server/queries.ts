import "server-only";

import { z } from "zod";
import { getFavoriteListingIds, listingCardSelection, mapListingCards, type ListingCardRow } from "@/features/listings/server/card-mapper";
import { canEditProfileIdentity, canEditProfileYear, getPublicProfilePage, PUBLIC_PROFILE_PAGE_SIZE } from "@/features/profiles/rules";
import { getAvatarUrl } from "@/features/profiles/server/avatar-url";
import type { OwnProfileResult, PublicProfileResult } from "@/features/profiles/types";
import { parseAuthorizationProfile, requireAuthenticatedProfile, requireVerifiedActiveStudent } from "@/lib/auth/authorization";

export async function getOwnProfile(nextPath = "/profile"): Promise<OwnProfileResult> {
  const { supabase, user, profile: authorization } = await requireAuthenticatedProfile(nextPath);
  const { data, error } = await supabase.from("profiles")
    .select("id,full_name,course,year_level,avatar_path,role,verification_status,account_status,created_at,updated_at")
    .eq("id", user.id).maybeSingle();
  const currentAuthorization = parseAuthorizationProfile(data);
  if (error || !data || !currentAuthorization) {
    console.warn("Unable to load own profile", { code: error?.code });
    return { profile: null, error: true, authorization };
  }
  return {
    profile: {
      id: data.id,
      fullName: data.full_name?.trim() || null,
      course: data.course,
      yearLevel: data.year_level,
      avatarUrl: getAvatarUrl(supabase, data.id, data.avatar_path),
      role: currentAuthorization.role,
      verificationStatus: currentAuthorization.verification_status,
      accountStatus: currentAuthorization.account_status,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      canEdit: currentAuthorization.account_status === "active",
      canEditIdentity: canEditProfileIdentity(currentAuthorization),
      canEditYear: canEditProfileYear(currentAuthorization),
    },
    error: false,
    authorization: currentAuthorization,
  };
}

function emptyPublicProfile(page: number, error = false): PublicProfileResult {
  return { profile: null, listings: [], totalCount: 0, page, pageCount: 1, error };
}

export async function getPublicProfile(userId: string, page = 1): Promise<PublicProfileResult> {
  const validId = z.string().uuid().safeParse(userId).success;
  const { supabase, user } = await requireVerifiedActiveStudent(validId ? `/users/${userId}` : "/marketplace");
  const requestedPage = getPublicProfilePage(String(page));
  if (!validId) return emptyPublicProfile(requestedPage);
  // Query the fixed safe projection, never another student's private profile.
  const { data: seller, error: profileError } = await supabase.from("marketplace_profiles")
    .select("id,full_name,course,year_level,avatar_path,verification_status,created_at")
    .eq("id", userId).maybeSingle();
  if (profileError) {
    console.warn("Unable to load marketplace profile", { code: profileError.code });
    return emptyPublicProfile(requestedPage, true);
  }
  if (!seller?.id) return emptyPublicProfile(requestedPage);
  const { data, count, error } = await supabase.from("listings")
    .select(listingCardSelection, { count: "exact" })
    .eq("seller_id", userId).in("status", ["available", "reserved"])
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range((requestedPage - 1) * PUBLIC_PROFILE_PAGE_SIZE, requestedPage * PUBLIC_PROFILE_PAGE_SIZE - 1);
  if (error) {
    console.warn("Unable to load public profile listings", { code: error.code });
    return emptyPublicProfile(requestedPage, true);
  }
  const rows = (data ?? []) as unknown as ListingCardRow[];
  const favorites = await getFavoriteListingIds(supabase, user.id, rows.map((listing) => listing.id));
  if (favorites.hasError) return emptyPublicProfile(requestedPage, true);
  return {
    profile: {
      id: seller.id,
      fullName: seller.full_name?.trim() || null,
      course: seller.course,
      yearLevel: seller.year_level,
      avatarUrl: getAvatarUrl(supabase, seller.id, seller.avatar_path),
      createdAt: seller.created_at!,
      isVerified: seller.verification_status === "verified",
    },
    listings: await mapListingCards(supabase, rows, favorites.ids, user.id),
    totalCount: count ?? 0,
    page: requestedPage,
    pageCount: Math.min(1000, Math.max(1, Math.ceil((count ?? 0) / PUBLIC_PROFILE_PAGE_SIZE))),
    error: false,
  };
}
