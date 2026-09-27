import "server-only";

import { formatListingPrice } from "@/features/listings/formatters";
import { isListingStatus } from "@/features/listings/rules";
import { signListingImagePaths } from "@/features/listings/server/media";
import {
  MESSAGE_PAGE_SIZE,
  type ConversationMessage,
} from "@/features/messages/utils";
import type {
  ConversationDetails,
  ConversationSummary,
} from "@/features/messages/types";
import { getAvatarUrl } from "@/features/profiles/server/avatar-url";
import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

type MessagingSupabase = Awaited<
  ReturnType<typeof requireVerifiedActiveStudent>
>["supabase"];

type ConversationSummaryRow = {
  conversation_id: string;
  listing_id: string;
  other_user_id: string;
  other_user_name: string | null;
  other_user_avatar_path: string | null;
  other_user_is_verified: boolean;
  listing_title: string | null;
  listing_status: string;
  listing_price: number | string | null;
  listing_image_path: string | null;
  last_message_body: string | null;
  last_message_at: string | null;
  unread_count: number | string;
  created_at: string;
  updated_at: string;
  can_send: boolean;
};

type MessageRow = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

function getSafeDisplayName(value: string | null) {
  const name = value?.trim();
  return name || "Former user";
}

function getSafeUnreadCount(value: number | string) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

async function mapSummaries(
  supabase: MessagingSupabase,
  rows: ConversationSummaryRow[],
) {
  const { urls } = await signListingImagePaths(
    supabase,
    rows.flatMap((row) =>
      isListingStatus(row.listing_status) &&
      row.listing_status !== "removed" &&
      row.listing_image_path
        ? [row.listing_image_path]
        : [],
    ),
  );

  return rows.map((row): ConversationSummary => {
    const listingStatus = isListingStatus(row.listing_status)
      ? row.listing_status
      : "removed";
    const listingUnavailable = listingStatus === "removed";

    return {
      id: row.conversation_id,
      listingId: row.listing_id,
      listingTitle: listingUnavailable
        ? "Listing unavailable"
        : (row.listing_title?.trim() || "Listing unavailable"),
      listingStatus,
      listingPrice:
        listingUnavailable || row.listing_price === null
          ? null
          : formatListingPrice(row.listing_price),
      listingImageUrl: !listingUnavailable && row.listing_image_path
        ? (urls.get(row.listing_image_path) ?? null)
        : null,
      otherStudentId: row.other_user_id,
      otherStudentName: getSafeDisplayName(row.other_user_name),
      otherStudentAvatarUrl: getAvatarUrl(
        supabase,
        row.other_user_id,
        row.other_user_avatar_path,
      ),
      otherStudentIsVerified: Boolean(row.other_user_is_verified),
      lastMessageBody: row.last_message_body,
      lastMessageAt: row.last_message_at,
      unreadCount: getSafeUnreadCount(row.unread_count),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      canSend: Boolean(row.can_send),
    };
  });
}

export async function getConversations(): Promise<{
  conversations: ConversationSummary[];
  error: boolean;
}> {
  const { supabase } = await requireVerifiedActiveStudent("/messages");
  const { data, error } = await supabase.rpc(
    "get_my_conversation_summaries",
    {},
  );

  if (error) {
    console.warn("Unable to load conversation summaries", { code: error.code });
    return { conversations: [], error: true };
  }

  const conversations = await mapSummaries(
    supabase,
    (data ?? []) as ConversationSummaryRow[],
  );

  conversations.sort(
    (first, second) =>
      new Date(second.updatedAt).getTime() -
        new Date(first.updatedAt).getTime() ||
      second.id.localeCompare(first.id),
  );

  return { conversations, error: false };
}

export async function getConversationDetails(
  conversationId: string,
): Promise<{
  conversation: ConversationDetails | null;
  error: "not_found" | "unavailable" | null;
}> {
  const { supabase, user } = await requireVerifiedActiveStudent(
    `/messages/${conversationId}`,
  );
  const [summaryResult, messageResult] = await Promise.all([
    supabase
      .rpc("get_my_conversation_summaries", {
        p_conversation_id: conversationId,
      })
      .maybeSingle(),
    supabase
      .from("messages")
      .select("id, sender_id, body, created_at, read_at", { count: "exact" })
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MESSAGE_PAGE_SIZE),
  ]);

  if (summaryResult.error) {
    console.warn("Unable to load conversation", {
      code: summaryResult.error.code,
    });
    return { conversation: null, error: "unavailable" };
  }
  if (!summaryResult.data) {
    return { conversation: null, error: "not_found" };
  }
  if (messageResult.error) {
    console.warn("Unable to load conversation messages", {
      code: messageResult.error.code,
    });
    return { conversation: null, error: "unavailable" };
  }

  const [summary] = await mapSummaries(
    supabase,
    [summaryResult.data as ConversationSummaryRow],
  );
  if (!summary) return { conversation: null, error: "not_found" };

  const messages = ((messageResult.data ?? []) as MessageRow[])
    .map(
      (message): ConversationMessage => ({
        id: message.id,
        senderId: message.sender_id,
        body: message.body,
        createdAt: message.created_at,
        readAt: message.read_at,
      }),
    )
    .reverse();

  return {
    conversation: {
      ...summary,
      currentUserId: user.id,
      messages,
      hasOlderMessages: (messageResult.count ?? 0) > messages.length,
      canViewListing:
        summary.listingStatus === "available" ||
        summary.listingStatus === "reserved",
    },
    error: null,
  };
}
