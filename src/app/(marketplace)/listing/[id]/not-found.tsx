import Link from "next/link";

export default function ListingNotFound() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[#f9f9ff] px-6 pb-28 md:pb-12">
      <section className="w-full max-w-lg rounded-2xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-[#0038a8]">Listing unavailable</p>
        <h1 className="mt-2 text-2xl font-bold">This listing could not be found</h1>
        <p className="mt-3 text-sm leading-6 text-[#444653]">
          It may have been removed, the link may be invalid, or your account may not have access to it.
        </p>
        <Link
          href="/marketplace"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576]"
        >
          Browse Marketplace
        </Link>
      </section>
    </main>
  );
}
