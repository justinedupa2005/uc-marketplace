export default function ConversationLoading() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-3 pb-24 pt-4 sm:px-6 sm:pt-6 md:pb-8">
      <section
        role="status"
        aria-label="Loading conversation"
        className="mx-auto flex h-[calc(100dvh-9rem)] min-h-[34rem] max-h-[58rem] w-full max-w-4xl animate-pulse flex-col overflow-hidden rounded-2xl border border-[#c4c5d5] bg-white md:h-[calc(100dvh-7rem)]"
      >
        <span className="sr-only">Loading conversation…</span>
        <header className="border-b border-[#e1e2ea] px-4 py-4 sm:px-6">
          <div className="h-5 w-28 rounded bg-[#e1e2ea]" />
          <div className="mt-4 flex items-center gap-3">
            <div className="size-14 rounded-full bg-[#d9e3f7]" />
            <div>
              <div className="h-5 w-40 rounded bg-[#d9e3f7]" />
              <div className="mt-2 h-4 w-28 rounded bg-[#e1e2ea]" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#e1e2ea] bg-[#f7f9ff] p-3">
            <div className="size-20 rounded-xl bg-[#d9e3f7]" />
            <div className="flex-1">
              <div className="h-3 w-24 rounded bg-[#e1e2ea]" />
              <div className="mt-3 h-4 w-52 max-w-full rounded bg-[#d9e3f7]" />
              <div className="mt-3 h-4 w-32 rounded bg-[#e1e2ea]" />
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-4 bg-[#f9faff] px-4 py-6 sm:px-6">
          <div className="h-16 w-2/3 rounded-2xl rounded-bl-md bg-white shadow-sm" />
          <div className="ml-auto h-20 w-3/5 rounded-2xl rounded-br-md bg-[#d9e3f7]" />
          <div className="h-16 w-1/2 rounded-2xl rounded-bl-md bg-white shadow-sm" />
        </div>
        <div className="border-t border-[#e1e2ea] p-4">
          <div className="h-14 rounded-xl bg-[#f0f1f5]" />
        </div>
      </section>
    </main>
  );
}
