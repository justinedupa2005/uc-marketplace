"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

export function ProfileReloadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button disabled={pending} onClick={() => startTransition(() => router.refresh())} className="min-h-11 px-5 text-sm">
      {pending ? "Loading profile..." : "Try Again"}
    </Button>
  );
}
