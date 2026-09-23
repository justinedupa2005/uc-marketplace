import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const authSecurityHeaders = [
  {
    key: "Cache-Control",
    value: "private, no-store, max-age=0",
  },
  {
    key: "Content-Security-Policy",
    value: "base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  },
  {
    key: "Referrer-Policy",
    value: "no-referrer",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive",
  },
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // The verification form accepts a 5 MiB ID image plus multipart overhead.
      bodySizeLimit: "6mb",
    },
  },
  images: {
    remotePatterns: supabaseUrl
      ? [
          {
            protocol: "https",
            hostname: new URL(supabaseUrl).hostname,
            pathname: "/storage/v1/object/sign/listing-images/**",
          },
        ]
      : [],
  },
  async headers() {
    return [
      "/login",
      "/register",
      "/register/check-email",
      "/register/resend-confirmation",
      "/forgot-password",
      "/reset-password",
      "/account-status",
      "/verification",
      "/admin/:path*",
      "/auth/confirm",
      "/auth/recovery",
    ].map((source) => ({ source, headers: authSecurityHeaders }));
  },
};

export default nextConfig;
