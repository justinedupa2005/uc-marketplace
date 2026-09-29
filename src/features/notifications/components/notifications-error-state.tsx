"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function NotificationsErrorState({ onRetry }: { onRetry?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-2xl border border-[#c4c5d5] bg-white px-6 py-12 text-center shadow-sm">
      <h2 className="text-lg font-bold text-[#121c2a]">Unable to load notifications</h2>
      <p className="mt-2 text-sm leading-6 text-[#444653]">Please try again.</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => onRetry ? onRetry() : router.refresh())}
        className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8] hover:bg-[#e9effb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8] disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Loading..." : "Try again"}
      </button>
    </div>
  );
}
