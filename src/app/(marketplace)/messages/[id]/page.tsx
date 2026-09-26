import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { getConversationDetails } from "@/lib/marketplace-interactions";

import { MessageComposer } from "./message-composer";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const result = await getConversationDetails(id);
  if (result.error === "not_found") notFound();
  if (result.error || !result.conversation) throw new Error("Unable to load conversation.");
  const { conversation } = result;
  const formatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-4 pb-28 pt-6 text-[#121c2a] sm:px-6 md:pb-12">
      <section className="mx-auto flex min-h-[70vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[#c4c5d5] bg-white shadow-sm">
        <header className="border-b border-[#e1e2ea] px-5 py-4">
          <Link href="/messages" className="text-sm font-semibold text-[#0038a8] hover:underline">← All messages</Link>
          <div className="mt-3 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold">{conversation.otherStudentName}</h1>
              <p className="mt-1 truncate text-sm text-[#444653]">{conversation.listingTitle}</p>
            </div>
            {conversation.canViewListing && (
              <Link href={`/listing/${conversation.listingId}`} className="shrink-0 rounded-md border border-[#0038a8] px-3 py-2 text-xs font-semibold text-[#0038a8]">View Item</Link>
            )}
          </div>
        </header>

        <div aria-label="Conversation messages" className="flex-1 space-y-4 overflow-y-auto bg-[#f9faff] p-5">
          {conversation.messages.length > 0 ? conversation.messages.map((message) => (
            <article key={message.id} className={`flex ${message.isMine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${message.isMine ? "bg-[#0038a8] text-white" : "border border-[#e1e2ea] bg-white"}`}>
                <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
                <time dateTime={message.createdAt} className={`mt-1 block text-[11px] ${message.isMine ? "text-white/75" : "text-[#747685]"}`}>{formatter.format(new Date(message.createdAt))}</time>
              </div>
            </article>
          )) : (
            <p className="py-12 text-center text-sm text-[#747685]">No messages yet. Say hello and ask about the item.</p>
          )}
        </div>

        {conversation.canSend ? (
          <MessageComposer conversationId={conversation.id} />
        ) : (
          <p className="border-t border-[#e1e2ea] bg-red-50 px-5 py-4 text-sm text-red-800">This conversation is read-only because the listing was removed.</p>
        )}
      </section>
    </main>
  );
}
