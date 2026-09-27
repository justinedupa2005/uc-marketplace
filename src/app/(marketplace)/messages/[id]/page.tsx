import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ListingStatusBadge } from "@/components/listing-badges";
import { ConversationThread } from "@/components/messages/conversation-thread";
import { ListingThumbnail } from "@/components/messages/listing-thumbnail";
import { ParticipantAvatar } from "@/components/messages/participant-avatar";
import { VerificationBadge } from "@/components/seller-card";
import { getConversationDetails } from "@/lib/messages";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const result = await getConversationDetails(id);
  if (result.error === "not_found") notFound();
  if (result.error || !result.conversation) {
    throw new Error("Unable to load conversation.");
  }

  const { conversation } = result;
  const readOnlyMessage =
    conversation.listingStatus === "removed"
      ? "This conversation is read-only because the listing is no longer available."
      : "Messaging is unavailable because this conversation is no longer eligible for new messages.";

  const listingReference = (
    <div className="flex min-w-0 items-center gap-3">
      <ListingThumbnail
        imageUrl={conversation.listingImageUrl}
        size="lg"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#747685]">
          About this listing
        </p>
        <p className="mt-1 truncate text-sm font-bold text-[#121c2a] sm:text-base">
          {conversation.listingTitle}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {conversation.listingPrice && (
            <span className="text-sm font-bold text-[#002576]">
              {conversation.listingPrice}
            </span>
          )}
          <ListingStatusBadge status={conversation.listingStatus} />
        </div>
      </div>
    </div>
  );

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-3 pb-24 pt-4 text-[#121c2a] sm:px-6 sm:pt-6 md:pb-8">
      <section className="mx-auto flex h-[calc(100dvh-9rem)] min-h-[34rem] max-h-[58rem] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#c4c5d5] bg-white shadow-[0_16px_50px_rgba(0,37,118,0.08)] md:h-[calc(100dvh-7rem)]">
        <header className="border-b border-[#e1e2ea] bg-white px-4 py-4 sm:px-6">
          <Link
            href="/messages"
            className="inline-flex min-h-9 items-center text-sm font-semibold text-[#0038a8] hover:underline"
          >
            ← All messages
          </Link>

          <div className="mt-2 flex items-center gap-3">
            <ParticipantAvatar
              name={conversation.otherStudentName}
              avatarUrl={conversation.otherStudentAvatarUrl}
              size="lg"
            />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold">
                {conversation.otherStudentName}
              </h1>
              {conversation.otherStudentIsVerified && (
                <div className="mt-1.5">
                  <VerificationBadge />
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-[#d9e3f7] bg-[#f7f9ff] p-3">
            {conversation.canViewListing ? (
              <Link
                href={`/listing/${conversation.listingId}`}
                className="block rounded-lg outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[#0038a8]"
              >
                {listingReference}
              </Link>
            ) : (
              listingReference
            )}
          </div>
        </header>

        <ConversationThread
          key={conversation.id}
          conversationId={conversation.id}
          currentUserId={conversation.currentUserId}
          otherStudentName={conversation.otherStudentName}
          otherStudentAvatarUrl={conversation.otherStudentAvatarUrl}
          initialMessages={conversation.messages}
          hasOlderMessages={conversation.hasOlderMessages}
          canSend={conversation.canSend}
          readOnlyMessage={readOnlyMessage}
        />
      </section>
    </main>
  );
}
