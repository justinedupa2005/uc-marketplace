import type { Metadata } from "next";
import Link from "next/link";

import { getConversations } from "@/lib/marketplace-interactions";

export const metadata: Metadata = {
  title: "Messages | UC Marketplace",
  description: "Student marketplace conversations.",
};

export default async function MessagesPage() {
  const { conversations, error } = await getConversations();
  const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-10 text-[#121c2a] sm:px-6 md:pb-12">
      <section className="mx-auto w-full max-w-3xl">
        <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#002576]">Messages</h1>
        <p className="mt-2 text-sm text-[#444653]">Conversations about marketplace listings.</p>

        {error ? (
          <div className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-bold">Messages temporarily unavailable</h2>
            <Link href="/messages" className="mt-5 inline-flex min-h-11 items-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8]">Try Again</Link>
          </div>
        ) : conversations.length > 0 ? (
          <ul className="mt-8 overflow-hidden rounded-xl border border-[#c4c5d5] bg-white shadow-sm">
            {conversations.map((conversation) => (
              <li key={conversation.id} className="border-b border-[#e1e2ea] last:border-0">
                <Link href={`/messages/${conversation.id}`} className="flex min-h-24 items-center justify-between gap-4 px-5 py-4 hover:bg-[#f4f7ff]">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{conversation.otherStudentName}</p>
                    <p className="mt-1 truncate text-sm text-[#444653]">{conversation.listingTitle}</p>
                    <p className="mt-1 text-xs capitalize text-[#747685]">{conversation.listingStatus}</p>
                  </div>
                  <time dateTime={conversation.updatedAt} className="shrink-0 text-xs text-[#747685]">{dateFormatter.format(new Date(conversation.updatedAt))}</time>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-bold">No conversations yet</h2>
            <p className="mt-2 text-sm leading-6 text-[#444653]">Open a listing and choose Message Seller to start one.</p>
            <Link href="/marketplace" className="mt-5 inline-flex min-h-11 items-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white">Browse Marketplace</Link>
          </div>
        )}
      </section>
    </main>
  );
}
