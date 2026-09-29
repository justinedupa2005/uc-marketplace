import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NotificationsErrorState } from "@/features/notifications/components/notifications-error-state";
import { NotificationsInbox } from "@/features/notifications/components/notifications-inbox";
import { getNotificationPage, getNotificationsPageHref } from "@/features/notifications/rules";
import { getNotifications } from "@/features/notifications/server/queries";

export const metadata: Metadata = {
  title: "Notifications | UC Marketplace",
  description: "Your messages, reservations, meetups, and account updates.",
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const query = await searchParams;
  const page = getNotificationPage(query.page);
  const data = await getNotifications(page);

  if (!data.error && page > data.pageCount) {
    redirect(getNotificationsPageHref(data.pageCount));
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-10 text-[#121c2a] sm:px-6 md:pb-12">
      <section className="mx-auto w-full max-w-3xl" aria-labelledby="notifications-title">
        <h1 id="notifications-title" className="text-3xl font-bold tracking-[-0.02em] text-[#002576] sm:text-4xl">Notifications</h1>
        <p className="mt-2 text-base leading-6 text-[#444653]">Keep up with your messages, reservations, and account updates.</p>
        <div className="mt-8">
          {data.error ? <NotificationsErrorState /> : <NotificationsInbox {...data} />}
        </div>
      </section>
    </main>
  );
}
