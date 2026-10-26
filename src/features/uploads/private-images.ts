import type { SupabaseClient } from "@supabase/supabase-js";

// Both private image buckets enforce the same limit in Storage as well.
export const PRIVATE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRIVATE_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isOwnedPrivateImagePath(
  path: string, ownerId: string, parentId: string, kind: "listing" | "verification",
) {
  if (!uuid.test(ownerId) || !uuid.test(parentId)) return false;
  const parts = path.split("/");
  if (parts.length !== 3 || parts[0] !== ownerId || parts[1] !== parentId) return false;
  const match = /^(.*)\.(jpg|png|webp)$/.exec(parts[2]);
  return Boolean(match && (kind === "verification" ? match[1] === "student-id" : uuid.test(match[1])));
}

export function parsePrivateImagePaths(value: FormDataEntryValue | null, maximum = 5): string[] | null {
  if (typeof value !== "string" || value.length > 2500) return null;
  try {
    const paths: unknown = JSON.parse(value);
    return Array.isArray(paths) && paths.length > 0 && paths.length <= maximum &&
      paths.every((path) => typeof path === "string" && path.length <= 160) &&
      new Set(paths).size === paths.length ? paths : null;
  } catch { return null; }
}

export async function hasPrivateImageSignature(image: Blob) {
  const bytes = new Uint8Array(await image.slice(0, 12).arrayBuffer());
  if (image.type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (image.type === "image/png") return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  return image.type === "image/webp" && [0x52, 0x49, 0x46, 0x46].every((byte, index) => bytes[index] === byte) &&
    [0x57, 0x45, 0x42, 0x50].every((byte, index) => bytes[index + 8] === byte);
}

type PrivateBucket = Pick<ReturnType<SupabaseClient["storage"]["from"]>, "info" | "download">;

// Call only after authenticating, checking the resource's current permissions,
// and constraining the path to that resource. Use the session client, never a
// service key. File bytes stay between Storage and the server, not in an action
// request/response. Inspect metadata before downloading a bounded object.
export async function readPrivateImage(bucket: PrivateBucket, path: string): Promise<File | null> {
  try {
    const info = await bucket.info(path);
    if (info.error || !info.data || !Number.isSafeInteger(info.data.size) ||
      info.data.size! <= 0 || info.data.size! > PRIVATE_IMAGE_MAX_BYTES ||
      !Object.hasOwn(PRIVATE_IMAGE_EXTENSIONS, info.data.contentType ?? "")) return null;
    const type = info.data.contentType!;
    if (!path.endsWith(`.${PRIVATE_IMAGE_EXTENSIONS[type]}`)) return null;
    const result = await bucket.download(path);
    if (result.error || !result.data || result.data.size !== info.data.size || result.data.type !== type ||
      !(await hasPrivateImageSignature(result.data))) return null;
    return new File([result.data], `image.${PRIVATE_IMAGE_EXTENSIONS[type]}`, { type });
  } catch { return null; }
}
