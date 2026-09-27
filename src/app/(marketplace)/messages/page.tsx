import type { Metadata } from "next";
import Link from "next/link";

import { ConversationListItem } from "@/features/messages/components/conversation-list-item";
import { getConversations } from "@/features/messages/server/queries";

export const metadata: Metadata = {
  title: "Messages | UC Marketplace",
  description: "Student marketplace conversations.",
};

export default async function MessagesPage() {
  const { conversations, error } = await getConversations();

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-5 pb-28 pt-10 text-[#121c2a] sm:px-6 md:pb-12">
      <section className="mx-auto w-full max-w-4xl">
        <header>
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#002576]">
            Messages
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#444653]">
            Continue conversations with buyers and sellers about marketplace
            listings.
          </p>
        </header>

        {error ? (
          <section className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
            <div
              className="mx-auto flex size-11 items-center justify-center rounded-full bg-red-50 text-lg font-bold text-red-700"
              aria-hidden="true"
            >
              !
            </div>
            <h2 className="mt-4 text-lg font-bold">
              Unable to load your messages
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#444653]">
              Please try again. Your conversations and messages are still safe.
            </p>
            <Link
              href="/messages"
              className="mt-5 inline-flex min-h-11 items-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8] hover:bg-[#e9effb]"
            >
              Try Again
            </Link>
          </section>
        ) : conversations.length > 0 ? (
          <ul
            aria-label="Your marketplace conversations"
            className="mt-8 overflow-hidden rounded-2xl border border-[#c4c5d5] bg-white shadow-[0_12px_40px_rgba(0,37,118,0.06)]"
          >
            {conversations.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
              />
            ))}
          </ul>
        ) : (
          <section className="mt-8 rounded-2xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm sm:p-10">
            <div
              className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#e6eeff] text-[#002576]"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.8 4v-4.35A2.5 2.5 0 0 1 4 13.5v-8Z" />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-bold">No messages yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#444653]">
              When you contact a seller or someone messages you about your
              listing, the conversation will appear here.
            </p>
            <Link
              href="/marketplace"
              className="mt-6 inline-flex min-h-11 items-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576]"
            >
              Browse Marketplace
            </Link>
          </section>
        )}
      </section>
    </main>
  );
}
