function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-[#dfe5f1] ${className}`} />;
}

export default function SellLoading() {
  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      <main
        role="status"
        aria-busy="true"
        className="mx-auto w-full max-w-3xl px-5 pb-28 pt-7 sm:px-6 sm:pt-10 md:pb-14"
      >
        <span className="sr-only">Loading the selling form...</span>

        <div aria-hidden="true" className="motion-safe:animate-pulse">
          <SkeletonLine className="h-4 w-36" />
          <SkeletonLine className="mt-3 h-10 w-56 sm:w-72" />
          <SkeletonLine className="mt-4 h-5 w-full max-w-xl" />
          <SkeletonLine className="mt-2 h-5 w-4/5 max-w-lg" />

          <div className="mt-8 space-y-7">
            {[0, 1, 2, 3].map((section) => (
              <section
                key={section}
                className="rounded-xl border border-[#c4c5d5]/60 bg-white p-5 shadow-sm sm:p-7"
              >
                <SkeletonLine className="h-3 w-16" />
                <SkeletonLine className="mt-3 h-7 w-52" />
                <SkeletonLine className="mt-3 h-4 w-3/4" />
                <div className="mt-5 border-t border-[#e1e2ea] pt-6">
                  <SkeletonLine
                    className={section === 0 ? "h-44 w-full" : "h-12 w-full"}
                  />
                  {section === 1 && (
                    <>
                      <SkeletonLine className="mt-5 h-12 w-full" />
                      <SkeletonLine className="mt-5 h-32 w-full" />
                    </>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
