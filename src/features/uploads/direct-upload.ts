"use client";

import { createClient } from "@/lib/supabase/client";
import { hasPrivateImageSignature, PRIVATE_IMAGE_EXTENSIONS, PRIVATE_IMAGE_MAX_BYTES } from "./private-images";

export async function validateDirectImages(files: File[], maximum = 5) {
  try {
    if (!files.length || files.length > maximum) return false;
    for (const file of files) {
      if (file.size <= 0 || file.size > PRIVATE_IMAGE_MAX_BYTES ||
        !Object.hasOwn(PRIVATE_IMAGE_EXTENSIONS, file.type) || !(await hasPrivateImageSignature(file))) return false;
    }
    return true;
  } catch { return false; }
}

export async function uploadPrivateImages(
  bucket: "listing-images" | "student-verifications", paths: string[], files: File[],
) {
  const storage = createClient().storage.from(bucket);
  const attempted: string[] = [];
  try {
    if (paths.length !== files.length) return false;
    for (const [index, file] of files.entries()) {
      // Include an attempted path even if Storage accepted it but its response
      // was lost. Never overwrite an existing object or use a privileged key.
      attempted.push(paths[index]);
      const { error } = await storage.upload(paths[index], file, {
        contentType: file.type, cacheControl: bucket === "student-verifications" ? "0" : "3600", upsert: false,
      });
      if (error) throw new Error("Upload unavailable");
    }
    return true;
  } catch {
    // No finalize action has been dispatched yet. RLS independently refuses
    // deletion if a concurrent submission already references an object.
    for (const path of attempted) {
      try { await storage.remove([path]); } catch { /* Keep scoped leftovers for retry/cleanup. */ }
    }
    return false;
  }
}
