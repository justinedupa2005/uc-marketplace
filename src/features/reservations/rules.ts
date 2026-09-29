export const RESERVATION_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "cancelled",
  "completed",
] as const;

export const MEETUP_STATUSES = [
  "proposed",
  "scheduled",
  "cancelled",
  "completed",
] as const;

export type ReservationLifecycleStatus =
  (typeof RESERVATION_STATUSES)[number];
export type MeetupLifecycleStatus = (typeof MEETUP_STATUSES)[number];
export type ReservationParticipantRole = "buyer" | "seller" | "other";

export const reservationStatusLabels: Record<
  ReservationLifecycleStatus,
  string
> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
  completed: "Completed",
};

export const meetupStatusLabels: Record<MeetupLifecycleStatus, string> = {
  proposed: "Proposed",
  scheduled: "Scheduled",
  cancelled: "Cancelled",
  completed: "Completed",
};

export function isReservationStatus(
  value: string,
): value is ReservationLifecycleStatus {
  return RESERVATION_STATUSES.some((status) => status === value);
}

export function isMeetupStatus(value: string): value is MeetupLifecycleStatus {
  return MEETUP_STATUSES.some((status) => status === value);
}

export function getReservationStatusLabel(value: string) {
  return isReservationStatus(value) ? reservationStatusLabels[value] : "Unknown";
}

export function getMeetupStatusLabel(value: string) {
  return isMeetupStatus(value) ? meetupStatusLabels[value] : "Unknown";
}

export function isReservationParticipant(role: string) {
  return role === "buyer" || role === "seller";
}

export function canRespondToReservation(
  role: string,
  status: string,
) {
  return role === "seller" && status === "pending";
}

export function canAcceptReservation(role: string, status: string) {
  return canRespondToReservation(role, status);
}

export function canRejectReservation(role: string, status: string) {
  return canRespondToReservation(role, status);
}

export function canCancelReservation(role: string, status: string) {
  if (role === "buyer") {
    return status === "pending" || status === "accepted";
  }

  return role === "seller" && status === "accepted";
}

export function canManageMeetup(
  role: string,
  reservationStatus: string,
  meetupStatus: string | null = null,
) {
  return (
    isReservationParticipant(role) &&
    reservationStatus === "accepted" &&
    (meetupStatus === null ||
      meetupStatus === "proposed" ||
      meetupStatus === "scheduled")
  );
}

export function canCompleteReservationSale(
  role: string,
  reservationStatus: string,
  listingStatus: string,
) {
  return (
    role === "seller" &&
    reservationStatus === "accepted" &&
    listingStatus === "reserved"
  );
}

export type ReservationCapabilities = {
  canView: boolean;
  canMessage: boolean;
  canAccept: boolean;
  canReject: boolean;
  canCancel: boolean;
  canManageMeetup: boolean;
  canCompleteSale: boolean;
};

export function getReservationCapabilities({
  role,
  reservationStatus,
  listingStatus,
  meetupStatus = null,
}: {
  role: string;
  reservationStatus: string;
  listingStatus: string;
  meetupStatus?: string | null;
}): ReservationCapabilities {
  const hasKnownContext =
    isReservationStatus(reservationStatus) &&
    ["available", "reserved", "sold", "removed"].includes(listingStatus) &&
    (meetupStatus === null || isMeetupStatus(meetupStatus));
  const participant = isReservationParticipant(role) && hasKnownContext;

  return {
    canView: participant,
    canMessage: participant,
    canAccept: hasKnownContext && canAcceptReservation(role, reservationStatus),
    canReject: hasKnownContext && canRejectReservation(role, reservationStatus),
    canCancel: hasKnownContext && canCancelReservation(role, reservationStatus),
    canManageMeetup:
      hasKnownContext &&
      canManageMeetup(role, reservationStatus, meetupStatus),
    canCompleteSale:
      hasKnownContext &&
      canCompleteReservationSale(role, reservationStatus, listingStatus),
  };
}
