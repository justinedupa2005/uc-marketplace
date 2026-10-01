"use client";

export default function AdminError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-8 text-red-900">
        <h1 className="text-xl font-bold">Moderation tools are temporarily unavailable</h1>
        <p className="mt-2 text-sm leading-6">Your review has not been changed. Please try again.</p>
        <button type="button" onClick={() => retry()} className="mt-5 min-h-11 rounded-md border border-red-300 px-4 text-sm font-semibold hover:bg-red-100">Try again</button>
      </div>
    </main>
  );
}
