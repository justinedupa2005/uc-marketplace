import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/types";

const LISTING_IMAGE_URL_LIFETIME_SECONDS = 5 * 60;

export type ListingImageSigningResult = {
  urls: Map<string, string>;
  hasError: boolean;
};

export async function signListingImagePaths(
  supabase: AppSupabaseClient,
  paths: string[],
): Promise<ListingImageSigningResult> {
  const storagePaths = [...new Set(paths.filter(Boolean))];
  const urls = new Map<string, string>();

  if (storagePaths.length === 0) return { urls, hasError: false };

  const { data, error } = await supabase.storage
    .from("listing-images")
    .createSignedUrls(storagePaths, LISTING_IMAGE_URL_LIFETIME_SECONDS);

  if (error) {
    console.warn("Unable to create private listing image URLs");
    return { urls, hasError: true };
  }

  data.forEach((signedImage) => {
    if (signedImage.path && signedImage.signedUrl && !signedImage.error) {
      urls.set(signedImage.path, signedImage.signedUrl);
    }
  });

  return {
    urls,
    hasError: storagePaths.some((path) => !urls.has(path)),
  };
}
