export type ReservationOperation =
  | "request"
  | "accept"
  | "reject"
  | "cancel"
  | "meetup"
  | "complete";

export type DatabaseErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const fallbackMessages: Record<ReservationOperation, string> = {
  request: "Unable to request this reservation. Please refresh and try again.",
  accept: "Unable to accept this reservation. Please refresh and try again.",
  reject: "Unable to reject this reservation. Please refresh and try again.",
  cancel: "Unable to cancel this reservation. Please refresh and try again.",
  meetup: "Unable to save meetup details. Please refresh and try again.",
  complete: "Unable to complete the sale. Please refresh and try again.",
};

const staleMessages: Record<ReservationOperation, string> = {
  request: "This listing is no longer available for reservation.",
  accept: "This reservation has already been processed or the item is no longer available.",
  reject: "This reservation has already been processed.",
  cancel: "This reservation can no longer be cancelled.",
  meetup: "Meetup details can only be changed for an accepted reservation.",
  complete: "This sale can no longer be completed. Refresh to see its current status.",
};

const invalidMessages: Record<ReservationOperation, string> = {
  request: "Check your reservation message and try again.",
  accept: "This reservation cannot be accepted in its current state.",
  reject: "This reservation cannot be rejected in its current state.",
  cancel: "This reservation cannot be cancelled in its current state.",
  meetup: "Check the meetup location, schedule, and notes, then try again.",
  complete: "This reservation is not ready to be completed.",
};

export function mapReservationError(
  operation: ReservationOperation,
  error: DatabaseErrorLike | null | undefined,
) {
  switch (error?.code) {
    case "23505":
      return operation === "request"
        ? "You already have an active reservation request for this item."
        : operation === "accept"
          ? "This item has already been reserved for another buyer."
          : fallbackMessages[operation];
    case "42501":
      return operation === "request"
        ? "A verified, active student account is required to request a reservation."
        : "You are not allowed to perform this reservation action.";
    case "22023":
    case "22P02":
    case "23514":
      return invalidMessages[operation];
    case "P0002":
      return staleMessages[operation];
    case "40001":
      return operation === "meetup"
        ? "Meetup details changed while this form was open. Close it and reopen the latest details before saving."
        : "This reservation changed while you were viewing it. Refresh and try again.";
    default:
      return fallbackMessages[operation];
  }
}
