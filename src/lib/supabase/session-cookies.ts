import { combineChunks, isChunkLike, stringFromBase64URL } from "@supabase/ssr";

type SessionCookie = { name: string; value: string };

/** Shape screening only. Cookie identity and tokens still require real Auth. */
function isUsableSession(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  return typeof session.access_token === "string" && session.access_token.trim().length > 0
    && typeof session.refresh_token === "string" && session.refresh_token.trim().length > 0
    && typeof session.expires_at === "number" && Number.isFinite(session.expires_at);
}

/**
 * auth-js's session shape check accepts an empty refresh_token, then its
 * detached INITIAL_SESSION subscriber can throw while loading that session.
 * Screen unusable cookies before the SDK reads them; never interpret their
 * user/role as authorization or discard a genuine, refreshable expired token.
 * Reuse SSR's own chunk matching/reassembly/decoder to avoid divergent formats.
 */
export async function filterSupabaseSessionCookies<T extends SessionCookie>(
  cookies: readonly T[],
  supabaseUrl: string,
) {
  const key = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  const sessionCookies = cookies.filter((cookie) => isChunkLike(cookie.name, key));
  if (!sessionCookies.length) return { cookies: [...cookies], removedCookieNames: [] as string[] };

  let valid = false;
  try {
    const combined = await combineChunks(key, (name) => cookies.find((cookie) => cookie.name === name)?.value);
    if (combined) {
      const decoded = combined.startsWith("base64-") ? stringFromBase64URL(combined.slice(7)) : combined;
      valid = isUsableSession(JSON.parse(decoded));
    }
  } catch {
    // Malformed input is absent, not an exception or a token-bearing log.
  }
  if (valid) return { cookies: [...cookies], removedCookieNames: [] as string[] };
  return {
    cookies: cookies.filter((cookie) => !isChunkLike(cookie.name, key)),
    removedCookieNames: sessionCookies.map((cookie) => cookie.name),
  };
}
