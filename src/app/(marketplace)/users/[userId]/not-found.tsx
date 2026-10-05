import Link from "next/link";

export default function PublicProfileNotFound() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[#f9f9ff] px-6 pb-28 md:pb-12">
      <section className="w-full max-w-lg rounded-2xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-[#121c2a]">Student profile unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-[#444653]">
          This profile could not be found or is not available in the marketplace.
        </p>
        <Link
          href="/marketplace"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
        >
          Browse Marketplace
        </Link>
      </section>
    </main>
  );
}
