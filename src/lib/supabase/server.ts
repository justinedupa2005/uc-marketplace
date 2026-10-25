import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/types/database";
import { filterSupabaseSessionCookies } from "@/lib/supabase/session-cookies";
import { authCookieOptions } from "@/lib/supabase/cookie-options";

export async function createClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const screened = await filterSupabaseSessionCookies(cookieStore.getAll(), supabaseUrl);
  if (screened.removedCookieNames.length) {
    try {
      screened.removedCookieNames.forEach((name) => cookieStore.set(name, "", { path: "/", maxAge: 0, sameSite: "lax" }));
    } catch {
      // Read-only Server Components still hide unusable cookies from the SDK;
      // the writable proxy clears these same exact cookie names for the browser.
    }
  }

  return createServerClient<Database>(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: authCookieOptions(),
      cookies: {
        async getAll() {
          return (await filterSupabaseSessionCookies(cookieStore.getAll(), supabaseUrl)).cookies;
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot write cookies. A proxy will refresh
            // authentication sessions before protected pages are rendered.
          }
        },
      },
    },
  );
}
