import Link from "next/link";

export function FavoritesEmptyState() {
  return (
    <div className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
      <h2 className="text-lg font-bold">No favorites yet</h2>
      <p className="mt-2 text-sm leading-6 text-[#444653]">
        Save listings you&apos;re interested in and they&apos;ll appear here.
      </p>
      <Link
        href="/marketplace"
        className="mt-5 inline-flex min-h-11 items-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
      >
        Browse Marketplace
      </Link>
    </div>
  );
}
