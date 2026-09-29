import type { ListingStatus } from "@/features/listings/rules";
import type {
  MeetupLifecycleStatus,
  ReservationLifecycleStatus,
} from "@/features/reservations/rules";

export type ReservationStatus = ReservationLifecycleStatus;
export type MeetupStatus = MeetupLifecycleStatus;

export type ReservationViewerRole = "buyer" | "seller";

export type ReservationStudent = {
  id: string;
  name: string;
  avatarUrl: string | null;
  isVerified: boolean;
};

export type ReservationListing = {
  id: string;
  title: string;
  price: string;
  status: ListingStatus;
  imageUrl: string | null;
  canView: boolean;
};

export type ReservationMeetup = {
  id: string;
  status: MeetupStatus;
  locationName: string;
  locationDetails: string | null;
  scheduledAt: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  completedAt: string | null;
};

export type ReservationSummary = {
  id: string;
  buyerId: string;
  sellerId: string;
  viewerRole: ReservationViewerRole;
  status: ReservationStatus;
  message: string | null;
  createdAt: string;
  updatedAt: string;
  respondedAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  conversationId: string | null;
  pendingRequestCount: number;
  listing: ReservationListing;
  otherStudent: ReservationStudent;
  meetup: ReservationMeetup | null;

  /**
   * Flat aliases retained for the existing reservation-card UI. New UI should
   * prefer the grouped listing and participant objects above.
   */
  listingId: string;
  listingTitle: string;
  listingPrice: string;
  imageUrl: string | null;
  otherStudentName: string;
  otherStudentAvatarUrl: string | null;
  otherStudentIsVerified: boolean;
  isIncoming: boolean;
  canViewListing: boolean;
};

export type ReservationDetails = ReservationSummary & {
  currentUserId: string;
  buyer: ReservationStudent;
  seller: ReservationStudent;
};
