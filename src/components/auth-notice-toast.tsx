"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type AuthNoticeKind = "logged-in" | "logged-out";

type ActiveNotice = {
  id: number;
  kind: AuthNoticeKind;
};

const messages: Record<AuthNoticeKind, string> = {
  "logged-in": "You have logged in successfully.",
  "logged-out": "You have been logged out securely.",
};

function isAuthNoticeKind(value: string | null): value is AuthNoticeKind {
  return value === "logged-in" || value === "logged-out";
}

export function AuthNoticeToast() {
  const searchParams = useSearchParams();
  const noticeKind = searchParams.get("authNotice");
  const nextNoticeId = useRef(0);
  const [activeNotice, setActiveNotice] = useState<ActiveNotice | null>(null);

  useEffect(() => {
    if (!isAuthNoticeKind(noticeKind)) {
      return;
    }

    nextNoticeId.current += 1;
    setActiveNotice({ id: nextNoticeId.current, kind: noticeKind });

    const cleanParams = new URLSearchParams(window.location.search);
    cleanParams.delete("authNotice");
    const cleanQuery = cleanParams.toString();
    const cleanUrl = `${window.location.pathname}${
      cleanQuery ? `?${cleanQuery}` : ""
    }${window.location.hash}`;

    window.history.replaceState(window.history.state, "", cleanUrl);
  }, [noticeKind]);

  useEffect(() => {
    if (!activeNotice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setActiveNotice((currentNotice) =>
        currentNotice?.id === activeNotice.id ? null : currentNotice,
      );
    }, 2800);

    return () => window.clearTimeout(timeout);
  }, [activeNotice]);

  if (!activeNotice) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-4 top-4 z-[100] flex justify-center sm:inset-x-auto sm:right-5 sm:top-5">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-900 shadow-[0_16px_45px_rgba(18,28,42,0.18)]"
      >
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 font-bold text-white"
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4"
          >
            <path d="m5 10 3 3 7-7" />
          </svg>
        </span>
        <span className="min-w-0 flex-1 font-medium">
          {messages[activeNotice.kind]}
        </span>
        <button
          type="button"
          onClick={() => setActiveNotice(null)}
          aria-label="Dismiss notification"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-lg leading-none text-[#5b6070] hover:bg-[#f2f3f8] hover:text-[#121c2a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            className="size-4"
          >
            <path d="m6 6 8 8M14 6l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
