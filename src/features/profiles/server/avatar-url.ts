import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/types";
import { isOwnedAvatarPath } from "@/features/profiles/rules";

export function getAvatarUrl(
  supabase: AppSupabaseClient,
  profileId: string,
  avatarPath: string | null,
) {
  if (!avatarPath || !isOwnedAvatarPath(profileId, avatarPath)) return null;

  return supabase.storage.from("avatars").getPublicUrl(avatarPath).data.publicUrl;
}
