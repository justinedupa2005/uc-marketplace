export default function NotificationsLoading() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-10 sm:px-6 md:pb-12">
      <section role="status" aria-label="Loading notifications" className="mx-auto w-full max-w-3xl motion-safe:animate-pulse">
        <span className="sr-only">Loading notifications...</span>
        <div aria-hidden="true">
          <div className="h-10 w-56 rounded bg-[#d9e3f7]" />
          <div className="mt-3 h-5 w-96 max-w-full rounded bg-[#e1e2ea]" />
          <div className="mb-5 mt-8 flex items-center justify-between gap-4">
            <div className="h-5 w-24 rounded bg-[#e1e2ea]" />
            <div className="h-11 w-36 rounded bg-[#e1e2ea]" />
          </div>
          <div className="divide-y divide-[#e1e2ea] overflow-hidden rounded-2xl border border-[#e1e2ea] bg-white">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex items-start gap-3 px-4 py-5 sm:gap-4 sm:px-6">
                <div className="size-10 shrink-0 rounded-xl bg-[#d9e3f7]" />
                <div className="min-w-0 flex-1">
                  <div className="h-6 w-2/3 rounded bg-[#d9e3f7]" />
                  <div className="mt-2 h-5 w-full rounded bg-[#e1e2ea]" />
                  <div className="mt-3 h-5 w-32 rounded bg-[#f0f1f5]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
