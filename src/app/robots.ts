import type { MetadataRoute } from "next";

// This is crawler guidance only; Vercel Authentication and application RLS
// enforce access. Non-production blocks everything, including the public home.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: process.env.APP_ENV === "production"
    ? ["/admin", "/auth", "/login", "/register", "/forgot-password", "/reset-password", "/account-status",
        "/marketplace", "/sell", "/my-listings", "/favorites", "/listing", "/messages", "/reservations",
        "/notifications", "/profile", "/users", "/verification"]
    : "/" } };
}
