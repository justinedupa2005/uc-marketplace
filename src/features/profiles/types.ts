import type { AccountRole, AccountStatus, AuthorizationProfile, VerificationStatus } from "@/lib/auth/authorization";
import type { MarketplaceProduct } from "@/features/listings/types";

export type OwnProfile = {
  id: string;
  fullName: string | null;
  course: string | null;
  yearLevel: number | null;
  avatarUrl: string | null;
  role: AccountRole;
  verificationStatus: VerificationStatus;
  accountStatus: AccountStatus;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canEditIdentity: boolean;
  canEditYear: boolean;
};

export type OwnProfileResult = {
  profile: OwnProfile | null;
  error: boolean;
  authorization: AuthorizationProfile;
};

export type PublicProfile = {
  id: string;
  fullName: string | null;
  course: string | null;
  yearLevel: number | null;
  avatarUrl: string | null;
  createdAt: string;
  isVerified: boolean;
};

export type PublicProfileResult = {
  profile: PublicProfile | null;
  listings: MarketplaceProduct[];
  totalCount: number;
  page: number;
  pageCount: number;
  error: boolean;
};

export type ProfileActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
  requiresReauthentication?: boolean;
  updatedAt?: string;
};
