import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Pagination } from "@/components/pagination";
import { ProductCard } from "@/features/listings/components/product-card";
import { VerificationBadge } from "@/features/listings/components/seller-card";
import { ProfileAvatar } from "@/features/profiles/components/profile-avatar";
import {
  formatProfileJoined,
  getPublicProfilePage,
} from "@/features/profiles/rules";
import { getPublicProfile } from "@/features/profiles/server/queries";
import { COURSE_OPTIONS } from "@/lib/auth/options";

export const metadata: Metadata = {
  title: "Student Profile | UC Marketplace",
  description: "View a verified student's marketplace profile and active listings.",
};

function profileHref(userId: string, page: number) {
  return page > 1 ? `/users/${userId}?page=${page}` : `/users/${userId}`;
}

function ProfileLoadError({ href }: { href: string }) {
  return (
    <section
      role="alert"
      className="rounded-2xl border border-[#c4c5d5] bg-white px-6 py-10 text-center shadow-sm"
    >
      <h1 className="text-2xl font-bold">Profile temporarily unavailable</h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[#444653]">
        We couldn&apos;t load this student&apos;s profile right now. Please try again.
      </p>
      <a
        href={href}
        className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
      >
        Try again
      </a>
    </section>
  );
}

export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const [{ userId }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    notFound();
  }

  const requestedPage = getPublicProfilePage(query.page);
  const result = await getPublicProfile(userId, requestedPage);
  if (!result.error && !result.profile) notFound();
  if (!result.error && requestedPage > result.pageCount) {
    redirect(profileHref(userId, result.pageCount));
  }

  const profile = result.profile;
  const currentHref = profileHref(userId, requestedPage);
  const course = COURSE_OPTIONS.find((option) => option.value === profile?.course)?.label
    ?? profile?.course;
  const academicDetails = [course, profile?.yearLevel ? `Year ${profile.yearLevel}` : null]
    .filter(Boolean)
    .join(" \u00b7 ");
  const joined = profile ? formatProfileJoined(profile.createdAt) : null;

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-8 text-[#121c2a] sm:px-6 md:pb-12">
      <div className="mx-auto w-full max-w-[1200px]">
        <Link
          href="/marketplace"
          className="mb-6 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-[#0038a8] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
        >
          <span aria-hidden="true">&larr;</span>
          Back to Marketplace
        </Link>

        {!profile ? (
          <ProfileLoadError href={currentHref} />
        ) : (
          <>
            <section
              aria-labelledby="public-profile-name"
              className="overflow-hidden rounded-2xl border border-[#c4c5d5] bg-white shadow-sm"
            >
              <div aria-hidden="true" className="h-24 bg-[#e6eeff]" />
              <div className="-mt-12 flex flex-col items-center gap-5 px-6 pb-7 text-center sm:flex-row sm:items-end sm:text-left">
                <ProfileAvatar
                  avatarUrl={profile.avatarUrl}
                  fullName={profile.fullName}
                  size={96}
                  className="shrink-0 border-4 border-white shadow-sm"
                />
                <div className="min-w-0 flex-1 sm:pb-1">
                  <h1 id="public-profile-name" className="break-words text-2xl font-bold leading-8">
                    {profile.fullName?.trim() || "Name not provided"}
                  </h1>
                  {profile.isVerified && <div className="mt-2"><VerificationBadge /></div>}
                  {academicDetails && (
                    <p className="mt-3 text-sm leading-6 text-[#444653]">{academicDetails}</p>
                  )}
                  {joined && (
                    <p className="mt-1 text-sm leading-6 text-[#5b6070]">Joined {joined}</p>
                  )}
                </div>
              </div>
            </section>

            <section aria-labelledby="public-profile-listings" className="mt-8">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="public-profile-listings" className="text-xl font-bold text-[#002576]">
                  Listings by this student
                </h2>
                {!result.error && (
                  <p className="text-sm text-[#5b6070]">
                    {result.totalCount} active {result.totalCount === 1 ? "listing" : "listings"}
                  </p>
                )}
              </div>
              {result.error ? (
                <div
                  role="alert"
                  className="rounded-2xl border border-[#c4c5d5] bg-white px-6 py-10 text-center shadow-sm"
                >
                  <h3 className="text-lg font-bold">Listings temporarily unavailable</h3>
                  <p className="mt-2 text-sm leading-6 text-[#444653]">
                    We couldn&apos;t load this student&apos;s listings. Please try again.
                  </p>
                  <a
                    href={currentHref}
                    className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8] hover:bg-[#edf2ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
                  >
                    Try again
                  </a>
                </div>
              ) : result.listings.length === 0 ? (
                <div className="rounded-2xl border border-[#c4c5d5] bg-white px-6 py-10 text-center shadow-sm">
                  <h3 className="text-lg font-bold">No active listings</h3>
                  <p className="mt-2 text-sm leading-6 text-[#444653]">
                    This student has no available or reserved listings right now.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                    {result.listings.map((product) => (
                      <ProductCard key={product.id} product={product} returnTo={currentHref} />
                    ))}
                  </div>
                  <Pagination
                    currentPage={result.page}
                    totalPages={result.pageCount}
                    hrefForPage={(page) => profileHref(userId, page)}
                    ariaLabel="Student listing pages"
                  />
                </>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
