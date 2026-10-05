"use client";

import Image from "next/image";
import { useFormStatus } from "react-dom";

import { logout } from "@/features/auth/actions";

function LogoutSubmit() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex min-h-[73px] w-full items-center px-6 text-left text-base font-semibold text-[#ba1a1a] transition hover:bg-[#ba1a1a]/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0038a8] disabled:cursor-wait disabled:opacity-60"
    >
      <span className="mr-4 flex size-10 shrink-0 items-center justify-center rounded-full bg-[#ba1a1a]/10">
        <Image src="/assets/app/logout.svg" alt="" width={18} height={18} />
      </span>
      {pending ? "Logging out..." : "Log Out"}
    </button>
  );
}

export function LogoutButton() {
  return (
    <form action={logout}>
      <LogoutSubmit />
    </form>
  );
}
