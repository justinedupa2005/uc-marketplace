// Shared by SSR, session refresh and the browser Realtime client. Browser Auth
// must read its session, so HttpOnly is deliberately not enabled for SDK cookies.
// The separate application recovery-grant cookie remains HttpOnly.
export function authCookieOptions(appUrl = process.env.NEXT_PUBLIC_APP_URL) {
  return {
    path: "/",
    sameSite: "lax" as const,
    secure: new URL(appUrl ?? "http://localhost:3000").protocol === "https:",
  };
}
