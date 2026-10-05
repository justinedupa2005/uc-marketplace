"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function LogoutSubmit({ children, className }: { children: ReactNode; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" aria-label={pending ? "Logging out" : "Log out"} disabled={pending} className={`${className} disabled:cursor-wait disabled:opacity-60`}>
      {pending ? "Logging out..." : children}
    </button>
  );
}
