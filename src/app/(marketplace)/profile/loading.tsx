export default function ProfileLoading() {
  return (
    <main aria-busy="true" aria-label="Loading profile" className="mx-auto w-full max-w-2xl space-y-6 px-6 pb-28 pt-8">
      <p role="status" className="sr-only">Loading your profile...</p>
      <section aria-hidden="true" className="overflow-hidden rounded-xl border border-[#c4c5d5] bg-white">
        <div className="h-28 bg-[#e6eeff] motion-safe:animate-pulse" />
        <div className="-mt-16 flex flex-col items-center gap-4 p-6">
          <div className="size-24 rounded-full border-4 border-white bg-[#e6eeff] motion-safe:animate-pulse" />
          <div className="h-7 w-44 rounded bg-[#e6eeff] motion-safe:animate-pulse" />
          <div className="h-5 w-36 rounded bg-[#e6eeff] motion-safe:animate-pulse" />
          <div className="mt-2 grid w-full grid-cols-2 gap-6 border-t border-[#c4c5d5] pt-5">
            {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-12 rounded bg-[#e6eeff] motion-safe:animate-pulse" />)}
          </div>
        </div>
      </section>
      <div aria-hidden="true" className="h-60 rounded-xl border border-[#c4c5d5] bg-white motion-safe:animate-pulse" />
    </main>
  );
}
