import type { ListingStatus } from "@/features/listings/rules";
import type { ConversationMessage } from "@/features/messages/utils";

export type ConversationSummary = {
  id: string;
  listingId: string;
  listingTitle: string;
  listingStatus: ListingStatus;
  listingPrice: string | null;
  listingImageUrl: string | null;
  otherStudentId: string;
  otherStudentName: string;
  otherStudentAvatarUrl: string | null;
  otherStudentIsVerified: boolean;
  lastMessageBody: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
  canSend: boolean;
};

export type ConversationDetails = ConversationSummary & {
  currentUserId: string;
  messages: ConversationMessage[];
  hasOlderMessages: boolean;
  canViewListing: boolean;
};
