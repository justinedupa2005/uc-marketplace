export default function ListingDetailsLoading() {
  return (
    <main className="min-h-[calc(100vh-4rem)] animate-pulse bg-[#f9f9ff] px-5 pb-28 pt-10 sm:px-6 md:pb-12">
      <div className="mx-auto max-w-[1100px]">
        <div className="h-10 w-44 rounded-md bg-[#e1e2ea]" />
        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="aspect-square rounded-2xl bg-[#d9e3f7] sm:aspect-[4/3]" />
          <div className="rounded-2xl border border-[#e1e2ea] bg-white p-7">
            <div className="h-6 w-32 rounded bg-[#e1e2ea]" />
            <div className="mt-6 h-10 w-4/5 rounded bg-[#e1e2ea]" />
            <div className="mt-4 h-9 w-40 rounded bg-[#d9e3f7]" />
            <div className="mt-8 h-24 rounded bg-[#f2f3f8]" />
            <div className="mt-6 h-32 rounded bg-[#f2f3f8]" />
          </div>
        </div>
      </div>
    </main>
  );
}
