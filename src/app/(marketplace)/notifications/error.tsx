"use client";

import { NotificationsErrorState } from "@/features/notifications/components/notifications-error-state";

export default function NotificationsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-10 sm:px-6 md:pb-12">
      <section className="mx-auto w-full max-w-3xl">
        <h1 className="mb-8 text-3xl font-bold tracking-[-0.02em] text-[#002576] sm:text-4xl">Notifications</h1>
        <NotificationsErrorState onRetry={retry} />
      </section>
    </main>
  );
}
