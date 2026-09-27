import Link from "next/link";

import { ListingStatusBadge } from "@/components/listing-badges";
import { ListingThumbnail } from "@/components/messages/listing-thumbnail";
import { MessageTime } from "@/components/messages/message-time";
import { ParticipantAvatar } from "@/components/messages/participant-avatar";
import type { ConversationSummary } from "@/lib/messages";

function VerifiedMark() {
  return (
    <span
      title="Verified student"
      aria-label="Verified student"
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-[#e6eeff] text-[#002576]"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-3" fill="currentColor">
        <path d="M10 1.5 12 3l2.5-.1.7 2.4 2.1 1.4-.9 2.3.9 2.3-2.1 1.4-.7 2.4L12 15l-2 1.5L8 15l-2.5.1-.7-2.4-2.1-1.4.9-2.3-.9-2.3 2.1-1.4.7-2.4L8 3l2-1.5Zm3.2 5.8-1.1-1.1-3 3-1.3-1.3L6.7 9l2.4 2.4 4.1-4.1Z" />
      </svg>
    </span>
  );
}

export function ConversationListItem({
  conversation,
}: {
  conversation: ConversationSummary;
}) {
  const activityAt =
    conversation.lastMessageAt ?? conversation.updatedAt ?? conversation.createdAt;

  return (
    <li className="border-b border-[#e1e2ea] last:border-0">
      <Link
        href={`/messages/${conversation.id}`}
        className="group flex min-h-28 items-center gap-4 px-4 py-4 outline-none transition-colors hover:bg-[#f4f7ff] focus-visible:bg-[#f4f7ff] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0038a8] sm:px-5"
      >
        <div className="relative shrink-0 pb-1 pr-2">
          <ListingThumbnail
            imageUrl={conversation.listingImageUrl}
            size="md"
          />
          <div className="absolute bottom-0 right-0 rounded-full bg-white p-0.5 shadow-sm">
            <ParticipantAvatar
              name={conversation.otherStudentName}
              avatarUrl={conversation.otherStudentAvatarUrl}
              size="sm"
            />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate font-bold text-[#121c2a]">
              {conversation.otherStudentName}
            </p>
            {conversation.otherStudentIsVerified && <VerifiedMark />}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-medium text-[#444653]">
              {conversation.listingTitle}
            </p>
            <span className="hidden shrink-0 sm:inline-flex">
              <ListingStatusBadge status={conversation.listingStatus} />
            </span>
          </div>
          <p
            className={`mt-2 truncate text-sm ${
              conversation.unreadCount > 0
                ? "font-semibold text-[#121c2a]"
                : "text-[#747685]"
            }`}
          >
            {conversation.lastMessageBody ?? "No messages yet — say hello."}
          </p>
        </div>

        <div className="flex min-w-14 shrink-0 flex-col items-end self-stretch py-1">
          <MessageTime
            value={activityAt}
            variant="relative"
            className={`text-xs ${
              conversation.unreadCount > 0
                ? "font-semibold text-[#002576]"
                : "text-[#747685]"
            }`}
          />
          {conversation.unreadCount > 0 && (
            <span
              aria-label={`${conversation.unreadCount} unread ${
                conversation.unreadCount === 1 ? "message" : "messages"
              }`}
              className="mt-auto inline-flex min-w-6 items-center justify-center rounded-full bg-[#0038a8] px-1.5 py-0.5 text-xs font-bold text-white"
            >
              {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
