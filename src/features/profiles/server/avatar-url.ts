import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/types";

export function getAvatarUrl(
  supabase: AppSupabaseClient,
  profileId: string,
  avatarPath: string | null,
) {
  if (!avatarPath || !avatarPath.startsWith(`${profileId}/`)) return null;

  return supabase.storage.from("avatars").getPublicUrl(avatarPath).data.publicUrl;
}
