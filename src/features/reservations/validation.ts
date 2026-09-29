import { z } from "zod";

export const RESERVATION_MESSAGE_MAX_LENGTH = 500;
export const MEETUP_LOCATION_NAME_MIN_LENGTH = 2;
export const MEETUP_LOCATION_NAME_MAX_LENGTH = 120;
export const MEETUP_LOCATION_DETAILS_MAX_LENGTH = 300;
export const MEETUP_NOTES_MAX_LENGTH = 500;
export const MEETUP_PAST_TOLERANCE_MS = 5 * 60 * 1_000;
export const MEETUP_MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1_000;

function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : value;
}

function optionalTrimmedString(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function uuidSchema(message: string) {
  return z.preprocess(trimString, z.string().uuid(message));
}

export const listingIdSchema = uuidSchema("Choose a valid listing.");
export const reservationIdSchema = uuidSchema("Choose a valid reservation.");

export const reservationMessageSchema = z.preprocess(
  optionalTrimmedString,
  z
    .string()
    .max(
      RESERVATION_MESSAGE_MAX_LENGTH,
      `Keep the reservation message within ${RESERVATION_MESSAGE_MAX_LENGTH} characters.`,
    )
    .nullable(),
);

export const requestReservationSchema = z.object({
  listingId: listingIdSchema,
  message: reservationMessageSchema,
});

const locationNameSchema = z.preprocess(
  trimString,
  z
    .string()
    .min(
      MEETUP_LOCATION_NAME_MIN_LENGTH,
      `Enter at least ${MEETUP_LOCATION_NAME_MIN_LENGTH} characters for the meetup location.`,
    )
    .max(
      MEETUP_LOCATION_NAME_MAX_LENGTH,
      `Keep the meetup location within ${MEETUP_LOCATION_NAME_MAX_LENGTH} characters.`,
    ),
);

const locationDetailsSchema = z.preprocess(
  optionalTrimmedString,
  z
    .string()
    .max(
      MEETUP_LOCATION_DETAILS_MAX_LENGTH,
      `Keep the location details within ${MEETUP_LOCATION_DETAILS_MAX_LENGTH} characters.`,
    )
    .nullable(),
);

const meetupNotesSchema = z.preprocess(
  optionalTrimmedString,
  z
    .string()
    .max(
      MEETUP_NOTES_MAX_LENGTH,
      `Keep the meetup notes within ${MEETUP_NOTES_MAX_LENGTH} characters.`,
    )
    .nullable(),
);

const meetupExpectedUpdatedAtSchema = z.preprocess(
  optionalTrimmedString,
  z
    .string()
    .datetime({
      offset: true,
      message: "Refresh before editing these meetup details.",
    })
    .nullable(),
);

export function createScheduledAtSchema(now = new Date()) {
  const nowMs = now.getTime();

  if (!Number.isFinite(nowMs)) {
    throw new TypeError("A valid current date is required.");
  }

  return z
    .preprocess(
      trimString,
      z.string().datetime({
        offset: true,
        message: "Choose a valid meetup date and time.",
      }),
    )
    .refine(
      (value) => Date.parse(value) >= nowMs - MEETUP_PAST_TOLERANCE_MS,
      "Choose a meetup time in the future.",
    )
    .refine(
      (value) => Date.parse(value) <= nowMs + MEETUP_MAX_SCHEDULE_AHEAD_MS,
      "Choose a meetup time within the next year.",
    )
    .transform((value) => new Date(value).toISOString());
}

export function createMeetupDetailsSchema(now = new Date()) {
  return z.object({
    reservationId: reservationIdSchema,
    locationName: locationNameSchema,
    locationDetails: locationDetailsSchema,
    scheduledAt: createScheduledAtSchema(now),
    notes: meetupNotesSchema,
    expectedUpdatedAt: meetupExpectedUpdatedAtSchema,
  });
}

export type ReservationRequestInput = z.input<typeof requestReservationSchema>;
export type ReservationRequest = z.output<typeof requestReservationSchema>;
export type MeetupDetailsInput = z.input<
  ReturnType<typeof createMeetupDetailsSchema>
>;
export type MeetupDetails = z.output<
  ReturnType<typeof createMeetupDetailsSchema>
>;
