export default function MyListingsLoading() {
  return (
    <main className="min-h-[calc(100vh-4rem)] animate-pulse bg-[#f9f9ff] px-6 pb-28 pt-10 md:pb-12">
      <div className="mx-auto max-w-[1200px]">
        <div className="h-10 w-48 rounded bg-[#d9e3f7]" />
        <div className="mt-3 h-5 w-72 rounded bg-[#e1e2ea]" />
        <div className="mt-8 flex gap-2">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-10 w-28 rounded-full bg-[#e1e2ea]" />)}
        </div>
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-80 rounded-2xl bg-white shadow-sm" />)}
        </div>
      </div>
    </main>
  );
}
