export default function ReservationDetailsLoading() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-10 sm:px-6 md:pb-12">
      <div
        role="status"
        aria-label="Loading reservation details"
        className="mx-auto w-full max-w-5xl animate-pulse"
      >
        <span className="sr-only">Loading reservation details...</span>
        <div className="h-5 w-44 rounded bg-[#e1e2ea]" />
        <div className="mt-6 h-10 w-72 rounded bg-[#d9e3f7]" />
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="space-y-6">
            <div className="h-64 rounded-2xl bg-white shadow-sm" />
            <div className="h-44 rounded-2xl bg-white shadow-sm" />
            <div className="h-52 rounded-2xl bg-white shadow-sm" />
          </div>
          <div className="space-y-6">
            <div className="h-60 rounded-2xl bg-white shadow-sm" />
            <div className="h-64 rounded-2xl bg-white shadow-sm" />
          </div>
        </div>
      </div>
    </main>
  );
}
