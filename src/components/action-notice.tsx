"use client";

import { useEffect } from "react";

export function ActionNotice({
  message,
  variant,
  onDismiss,
}: {
  message: string | null;
  variant: "success" | "error";
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(onDismiss, 3000);
    return () => window.clearTimeout(timeout);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
      className={`fixed right-4 top-20 z-[70] max-w-sm rounded-lg border px-4 py-3 text-sm font-medium shadow-lg sm:right-6 ${
        variant === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-red-200 bg-red-50 text-red-800"
      }`}
    >
      {message}
    </div>
  );
}
