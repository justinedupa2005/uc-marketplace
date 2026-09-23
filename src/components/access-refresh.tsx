"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const ACCESS_REFRESH_INTERVAL_MS = 60_000;

export function AccessRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => router.refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const interval = window.setInterval(refresh, ACCESS_REFRESH_INTERVAL_MS);

    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(interval);
    };
  }, [router]);

  return null;
}
