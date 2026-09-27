export default function MessagesLoading() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-10 text-[#121c2a] sm:px-6 md:pb-12">
      <section className="mx-auto w-full max-w-4xl">
        <header>
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#002576]">
            Messages
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#444653]">
            Continue conversations with buyers and sellers about marketplace
            listings.
          </p>
        </header>

        <div
          role="status"
          aria-label="Loading conversations"
          className="mt-8 overflow-hidden rounded-2xl border border-[#c4c5d5] bg-white shadow-[0_12px_40px_rgba(0,37,118,0.06)]"
        >
          <span className="sr-only">Loading your messages…</span>
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              aria-hidden="true"
              className="flex min-h-28 animate-pulse items-center gap-4 border-b border-[#e1e2ea] px-4 py-4 last:border-0 sm:px-5"
            >
              <div className="size-16 shrink-0 rounded-xl bg-[#d9e3f7]" />
              <div className="min-w-0 flex-1">
                <div className="h-4 w-36 rounded bg-[#d9e3f7]" />
                <div className="mt-3 h-3 w-48 max-w-[80%] rounded bg-[#e1e2ea]" />
                <div className="mt-3 h-3 w-64 max-w-full rounded bg-[#f0f1f5]" />
              </div>
              <div className="h-3 w-12 shrink-0 rounded bg-[#e1e2ea]" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
