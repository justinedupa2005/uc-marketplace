export default function ReservationsLoading() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-10 sm:px-6 md:pb-12">
      <section
        role="status"
        aria-label="Loading reservations"
        className="mx-auto w-full max-w-4xl animate-pulse"
      >
        <span className="sr-only">Loading reservations...</span>
        <div className="h-10 w-56 rounded bg-[#d9e3f7]" />
        <div className="mt-3 h-4 w-96 max-w-full rounded bg-[#e1e2ea]" />
        <div className="mt-8 h-12 rounded bg-[#e1e2ea]" />
        <div className="mt-8 space-y-5">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              aria-hidden="true"
              className="grid overflow-hidden rounded-2xl border border-[#e1e2ea] bg-white sm:grid-cols-[160px_1fr]"
            >
              <div className="min-h-44 bg-[#d9e3f7]" />
              <div className="p-5">
                <div className="h-5 w-2/3 rounded bg-[#d9e3f7]" />
                <div className="mt-3 h-5 w-28 rounded bg-[#e1e2ea]" />
                <div className="mt-5 h-10 w-48 rounded bg-[#f0f1f5]" />
                <div className="mt-5 h-10 rounded bg-[#f0f1f5]" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
