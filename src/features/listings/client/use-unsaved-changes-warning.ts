"use client";

import { useEffect } from "react";

import { useNavigationBlocker } from "@/components/navigation-blocker";

export function useUnsavedChangesWarning(enabled: boolean) {
  const { setIsBlocked } = useNavigationBlocker();

  useEffect(() => {
    setIsBlocked(enabled);
    return () => setIsBlocked(false);
  }, [enabled, setIsBlocked]);

  useEffect(() => {
    if (!enabled) return;

    function preventAccidentalExit(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", preventAccidentalExit);
    return () =>
      window.removeEventListener("beforeunload", preventAccidentalExit);
  }, [enabled]);
}
