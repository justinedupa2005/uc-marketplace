export type ReservationStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "completed";

export type ReservationSummary = {
  id: string;
  listingId: string;
  listingTitle: string;
  imageUrl: string | null;
  otherStudentName: string;
  status: ReservationStatus;
  createdAt: string;
  isIncoming: boolean;
  canViewListing: boolean;
};
