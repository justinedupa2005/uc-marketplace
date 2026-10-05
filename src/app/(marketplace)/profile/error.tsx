"use client";

import { NavigationLink } from "@/components/navigation-blocker";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/features/profiles/components/logout-button";

export default function ProfileError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <section className="overflow-hidden rounded-xl border border-[#c4c5d5] bg-white shadow-sm">
        <div className="space-y-5 p-7 text-center">
          <h1 className="text-2xl font-bold">Profile temporarily unavailable</h1>
          <p className="text-sm leading-6 text-[#444653]">We couldn&apos;t load this page. Please try again.</p>
          <Button onClick={retry} className="min-h-11 px-5 text-sm">Try Again</Button>
          <NavigationLink href="/profile" className="block text-sm font-semibold text-[#002576] underline underline-offset-4">Back to Profile</NavigationLink>
        </div>
        <div className="border-t border-[#c4c5d5]"><LogoutButton /></div>
      </section>
    </main>
  );
}
