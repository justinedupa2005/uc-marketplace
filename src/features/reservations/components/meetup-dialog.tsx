"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { ActionNotice } from "@/components/action-notice";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveMeetup } from "@/features/reservations/actions";
import { useReservationNotice } from "@/features/reservations/components/reservation-feedback-provider";
import { mapReservationError } from "@/features/reservations/errors";
import type { ReservationMeetup } from "@/features/reservations/types";
import {
  MEETUP_LOCATION_DETAILS_MAX_LENGTH,
  MEETUP_LOCATION_NAME_MAX_LENGTH,
  MEETUP_NOTES_MAX_LENGTH,
} from "@/features/reservations/validation";

function toManilaDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function MeetupDialog({
  reservationId,
  meetup,
  compact = false,
  disabled = false,
}: {
  reservationId: string;
  meetup: ReservationMeetup | null;
  compact?: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [locationName, setLocationName] = useState(meetup?.locationName ?? "");
  const [locationDetails, setLocationDetails] = useState(
    meetup?.locationDetails ?? "",
  );
  const [scheduledAt, setScheduledAt] = useState(
    toManilaDateTime(meetup?.scheduledAt ?? null),
  );
  const [notes, setNotes] = useState(meetup?.notes ?? "");
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(meetup?.updatedAt ?? null);
  const [feedback, setFeedback] = useState<{
    message: string;
    variant: "success" | "error";
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const { notice, showNotice, dismissNotice } = useReservationNotice();

  function openDialog() {
    if (pending || disabled) return;
    setLocationName(meetup?.locationName ?? "");
    setLocationDetails(meetup?.locationDetails ?? "");
    setScheduledAt(toManilaDateTime(meetup?.scheduledAt ?? null));
    setNotes(meetup?.notes ?? "");
    // Keep the version of the details loaded into this form even if a route
    // refresh brings in a newer meetup while the participant is editing.
    setExpectedUpdatedAt(meetup?.updatedAt ?? null);
    setFeedback(null);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (pending) return;
    dialogRef.current?.close();
    setFeedback(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsedDate = new Date(`${scheduledAt}:00+08:00`);
    if (Number.isNaN(parsedDate.getTime())) {
      setFeedback({ message: "Choose a valid meetup date and time.", variant: "error" });
      return;
    }

    startTransition(async () => {
      try {
        const result = await saveMeetup(
          reservationId,
          locationName,
          locationDetails,
          parsedDate.toISOString(),
          notes,
          expectedUpdatedAt,
        );
        setFeedback(result.ok ? null : { message: result.message, variant: "error" });
        showNotice(result.message, result.ok ? "success" : "error");
        if (result.ok) {
          dialogRef.current?.close();
        }
      } catch (error) {
        unstable_rethrow(error);
        const message = mapReservationError("meetup", null);
        setFeedback({ message, variant: "error" });
        showNotice(message, "error");
      } finally {
        // Refresh either way so a cancelled reservation or a newer meetup
        // from the other participant becomes visible after this attempt.
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending || disabled}
        onClick={openDialog}
        className={`rounded-md border border-[#0038a8] font-semibold text-[#0038a8] hover:bg-[#e9effb] disabled:cursor-wait disabled:opacity-60 ${compact ? "min-h-9 px-3 text-xs" : "min-h-11 px-4 text-sm"}`}
      >
        {meetup ? "Edit Meetup" : "Arrange Meetup"}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={`meetup-title-${reservationId}`}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-[#c4c5d5] bg-white p-0 text-[#121c2a] shadow-2xl backdrop:bg-[#121c2a]/45"
        onCancel={(event) => {
          if (pending) {
            event.preventDefault();
          } else {
            setFeedback(null);
          }
        }}
      >
        <form onSubmit={submit} className="p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id={`meetup-title-${reservationId}`} className="text-xl font-bold">
                {meetup ? "Edit meetup" : "Arrange a meetup"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[#5b6070]">
                Both participants will see the latest location and schedule.
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={closeDialog}
              aria-label="Close meetup dialog"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-xl hover:bg-[#f2f3f8] disabled:opacity-50"
            >
              &times;
            </button>
          </div>

          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
            Meet in a public UC campus area such as the library entrance,
            student center, or a staffed lobby. You never need to share a home
            address.
          </div>

          <label htmlFor={`meetup-location-${reservationId}`} className="mt-5 block text-sm font-semibold">
            Public campus location
          </label>
          <Input
            id={`meetup-location-${reservationId}`}
            required
            minLength={2}
            maxLength={MEETUP_LOCATION_NAME_MAX_LENGTH}
            value={locationName}
            onChange={(event) => setLocationName(event.target.value)}
            disabled={pending}
            placeholder="UC Library entrance"
            className="mt-2"
          />

          <label htmlFor={`meetup-details-${reservationId}`} className="mt-5 block text-sm font-semibold">
            Meeting point details <span className="font-normal text-[#747685]">(optional)</span>
          </label>
          <Input
            id={`meetup-details-${reservationId}`}
            maxLength={MEETUP_LOCATION_DETAILS_MAX_LENGTH}
            value={locationDetails}
            onChange={(event) => setLocationDetails(event.target.value)}
            disabled={pending}
            placeholder="Beside the guard desk"
            className="mt-2"
          />

          <label htmlFor={`meetup-time-${reservationId}`} className="mt-5 block text-sm font-semibold">
            Date and time
          </label>
          <Input
            id={`meetup-time-${reservationId}`}
            type="datetime-local"
            required
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
            disabled={pending}
            className="mt-2"
          />
          <p className="mt-2 text-xs leading-5 text-[#747685]">
            Enter Philippine time (UTC+8). It is saved with its timezone.
          </p>

          <label htmlFor={`meetup-notes-${reservationId}`} className="mt-5 block text-sm font-semibold">
            Notes <span className="font-normal text-[#747685]">(optional)</span>
          </label>
          <Textarea
            id={`meetup-notes-${reservationId}`}
            rows={3}
            maxLength={MEETUP_NOTES_MAX_LENGTH}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={pending}
            placeholder="How to recognize each other or what to bring"
            className="mt-2"
          />

          {feedback?.variant === "error" && (
            <FieldError className="mt-4">{feedback.message}</FieldError>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={closeDialog}
              className="min-h-11 rounded-md px-4 text-sm font-semibold text-[#444653] hover:bg-[#f2f3f8] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576] disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? "Saving..." : "Save Meetup"}
            </button>
          </div>
        </form>
      </dialog>

      <ActionNotice
        message={notice?.message ?? null}
        variant={notice?.variant ?? "success"}
        onDismiss={dismissNotice}
      />
    </>
  );
}
