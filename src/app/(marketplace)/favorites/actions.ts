"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

const favoriteRequestSchema = z.object({
  listingId: z.string().uuid(),
  shouldFavorite: z.boolean(),
});

export type FavoriteActionResult = {
  ok: boolean;
  message: string;
  isFavorited?: boolean;
};

function invalidRequest(message: string): FavoriteActionResult {
  return { ok: false, message };
}

export async function setListingFavorite(
  listingId: string,
  shouldFavorite: boolean,
): Promise<FavoriteActionResult> {
  const parsed = favoriteRequestSchema.safeParse({
    listingId,
    shouldFavorite,
  });

  if (!parsed.success) {
    return invalidRequest("This favorite request is invalid. Refresh and try again.");
  }

  const { supabase } = await requireVerifiedActiveStudent(
    `/listing/${parsed.data.listingId}`,
  );
  const { data, error } = await supabase.rpc("set_listing_favorite", {
    p_listing_id: parsed.data.listingId,
    p_should_favorite: parsed.data.shouldFavorite,
  });

  if (
    error ||
    typeof data !== "boolean" ||
    data !== parsed.data.shouldFavorite
  ) {
    console.warn("Favorite action failed", {
      code: error?.code ?? "unexpected-result",
    });
    return invalidRequest(
      parsed.data.shouldFavorite
        ? "Unable to save this listing. Please try again."
        : "Unable to remove this favorite. Please try again.",
    );
  }

  revalidatePath("/favorites");
  revalidatePath("/marketplace");
  revalidatePath(`/listing/${parsed.data.listingId}`);

  return {
    ok: true,
    isFavorited: data,
    message: data ? "Saved to your favorites." : "Removed from your favorites.",
  };
}
