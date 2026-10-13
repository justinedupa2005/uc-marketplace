import { expect, test } from "@playwright/test";

const fixtureId = "00000000-0000-4000-8000-000000000015";
const protectedRoutes = [
  "/marketplace", "/sell", "/favorites", "/my-listings", "/messages",
  `/messages/${fixtureId}`, "/reservations", `/reservations/${fixtureId}`,
  "/profile", "/profile/edit", "/profile/change-password", "/notifications",
  "/verification", `/users/${fixtureId}`, `/listing/${fixtureId}`,
  `/listing/${fixtureId}/edit`, "/admin", "/admin/users", `/admin/users/${fixtureId}`,
  "/admin/listings", `/admin/listings/${fixtureId}`, "/admin/reports",
  `/admin/reports/listing/${fixtureId}`, "/admin/verifications",
  `/admin/verifications/${fixtureId}`, "/account-status",
];

for (const route of protectedRoutes) {
  test(`anonymous direct navigation cannot open ${route}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(route);
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.locator("input[type=file], [role=log], [aria-label='Your notifications']")).toHaveCount(0);
    expect(pageErrors, "Protected navigation must not crash or hydrate private data").toEqual([]);
  });
}

test("private verification evidence refuses anonymous HTTP access", async ({ request }) => {
  const response = await request.get(`/admin/verifications/${fixtureId}/document`, { maxRedirects: 0 });
  expect([401, 403, 307, 308]).toContain(response.status());
  expect(response.headers()["content-type"] ?? "").not.toMatch(/^image\//);
  expect(response.headers()["cache-control"] ?? "").toContain("no-store");
});

test("corrupt and unusable expired session cookies do not restore private access", async ({ page, context, baseURL }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const supabaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  expect(supabaseURL, "The same public Supabase URL as the tested build is required").toBeTruthy();
  const project = new URL(supabaseURL!).hostname.split(".")[0];
  const cookieName = `sb-${project}-auth-token`;
  const expiredSession = {
    access_token: "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.invalid-signature",
    // No usable refresh credential. Actual expired-session refresh/revocation
    // is exercised against isolated Auth, not the configured hosted project.
    refresh_token: "",
    token_type: "bearer",
    expires_at: 1,
    expires_in: 0,
    user: { id: fixtureId },
  };
  const encodedExpired = `base64-${Buffer.from(JSON.stringify(expiredSession)).toString("base64url")}`;
  const malformedCookies = [
    [{ name: cookieName, value: "not-a-valid-session" }],
    [{ name: cookieName, value: encodedExpired }],
    [{ name: cookieName, value: `base64-${Buffer.from(JSON.stringify({ ...expiredSession, refresh_token: null })).toString("base64url")}` }],
    // SSR auth cookies may be chunked; sanitizing only the single-cookie case
    // would leave the same malformed session available under .0/.1 names.
    [
      { name: `${cookieName}.0`, value: encodedExpired.slice(0, Math.ceil(encodedExpired.length / 2)) },
      { name: `${cookieName}.1`, value: encodedExpired.slice(Math.ceil(encodedExpired.length / 2)) },
    ],
  ];
  for (const cookies of malformedCookies) {
    await context.clearCookies();
    await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL!, httpOnly: false, sameSite: "Lax" as const })));
    for (const route of ["/profile", "/messages", "/favorites", "/reservations", "/my-listings", "/admin"]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
      await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    }
    await expect.poll(async () => (await context.cookies()).filter((cookie) =>
      cookie.name === cookieName || cookie.name.startsWith(`${cookieName}.`),
    ), { message: "Malformed session cookies must be cleared instead of retried on every navigation" }).toHaveLength(0);
  }
  expect(pageErrors, "Malformed sessions must not produce uncaught browser errors").toEqual([]);
});

test("private routes carry cache prevention and search exclusion headers", async ({ request }) => {
  for (const route of ["/profile", "/profile/edit", `/users/${fixtureId}`, "/messages", "/reservations", "/notifications", "/admin/reports"]) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect([307, 308]).toContain(response.status());
    expect(response.headers()["cache-control"] ?? "").toContain("no-store");
    expect(response.headers()["x-robots-tag"] ?? "").toContain("noindex");
  }
});

test("login return paths cannot become external navigation", async ({ page }) => {
  for (const next of ["https://example.invalid/private", "//example.invalid/private", "/\\example.invalid/private"]) {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await expect(page.locator("input[name=next]")).toHaveValue("/marketplace");
  }
});

for (const width of [375, 390, 430, 1280, 1440, 1920]) {
  test(`public account forms remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/login", "/register", "/forgot-password"]) {
      await page.goto(route);
      await expect(page.locator("h1")).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(dimensions.scroll, `${route} must not overflow horizontally`).toBeLessThanOrEqual(dimensions.viewport + 1);
      for (const field of await page.locator("input:not([type=hidden]), select").all()) {
        await expect(field).toHaveAccessibleName(/.+/);
      }
      for (const button of await page.getByRole("button").all()) {
        await expect(button).toHaveAccessibleName(/.+/);
      }
    }
  });
}

test("login controls support keyboard and password visibility without submitting", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/login");
  const email = page.getByLabel("Email address");
  const password = page.getByLabel("Password", { exact: true });
  await email.focus();
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Show password" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(password).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "password");
  await page.keyboard.press("Shift+Tab");
  await expect(password).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(email).toBeFocused();
  expect(pageErrors).toEqual([]);
});
