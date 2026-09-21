import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  getSafeNextPath,
  isProtectedPathname,
} from "@/lib/auth/redirects";

function redirectWithSessionCookies(
  request: NextRequest,
  supabaseResponse: NextResponse,
) {
  const loginUrl = request.nextUrl.clone();
  const intendedPath = getSafeNextPath(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", intendedPath);

  const response = NextResponse.redirect(loginUrl);

  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });

  for (const headerName of ["cache-control", "expires", "pragma"]) {
    const value = supabaseResponse.headers.get(headerName);

    if (value) {
      response.headers.set(headerName, value);
    }
  }

  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function nextWithRequestedPath(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  // The layout uses this only as a sanitized login destination when a live
  // user check rejects a session that passed the proxy's optimistic check.
  requestHeaders.set(
    "x-uc-marketplace-path",
    getSafeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`),
  );
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = nextWithRequestedPath(request);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );

          supabaseResponse = nextWithRequestedPath(request);

          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );

          Object.entries(headers).forEach(([name, value]) =>
            supabaseResponse.headers.set(name, value),
          );
        },
      },
    },
  );

  // Initializing auth here refreshes an expired session before Server
  // Components read it. Authorization is repeated close to protected data.
  let authenticated = false;

  try {
    const { data, error } = await supabase.auth.getClaims();
    authenticated = Boolean(!error && data?.claims?.sub);
  } catch {
    // Malformed or unrecoverable session cookies are treated as logged out.
    authenticated = false;
  }

  if (isProtectedPathname(request.nextUrl.pathname) && !authenticated) {
    return redirectWithSessionCookies(request, supabaseResponse);
  }

  return supabaseResponse;
}
