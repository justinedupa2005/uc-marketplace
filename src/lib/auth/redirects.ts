const PROTECTED_ROUTE_ROOTS = [
  "/marketplace",
  "/favorites",
  "/reservations",
  "/sell",
  "/profile",
  "/messages",
  "/my-listings",
  "/listing",
  "/listings",
  "/notifications",
  "/verification",
  "/admin",
] as const;

function matchesRouteRoot(pathname: string, routeRoot: string) {
  return pathname === routeRoot || pathname.startsWith(`${routeRoot}/`);
}

export function isProtectedPathname(pathname: string) {
  return PROTECTED_ROUTE_ROOTS.some((routeRoot) =>
    matchesRouteRoot(pathname, routeRoot),
  );
}

export function getSafeNextPath(
  value: unknown,
  fallback = "/marketplace",
) {
  const rawPathname =
    typeof value === "string" ? value.split("?", 1)[0] : "";

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    /%(?:25)*(?:2f|5c)/i.test(rawPathname)
  ) {
    return fallback;
  }

  try {
    const baseUrl = new URL("https://uc-marketplace.invalid");
    const candidateUrl = new URL(value, baseUrl);

    if (
      candidateUrl.origin !== baseUrl.origin ||
      candidateUrl.hash ||
      !isProtectedPathname(candidateUrl.pathname)
    ) {
      return fallback;
    }

    return `${candidateUrl.pathname}${candidateUrl.search}`;
  } catch {
    return fallback;
  }
}
