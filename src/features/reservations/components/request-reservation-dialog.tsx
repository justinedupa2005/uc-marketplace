"use client";

import Image from "next/image";
import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Textarea } from "@/components/ui/textarea";
import { VerificationBadge } from "@/features/listings/components/seller-card";
import { requestReservation } from "@/features/reservations/actions";
import { mapReservationError } from "@/features/reservations/errors";
import { RESERVATION_MESSAGE_MAX_LENGTH } from "@/features/reservations/validation";

type RequestedReservation = {
  id: string;
  status: "pending";
};

export function RequestReservationDialog({
  listingId,
  title,
  price,
  sellerName,
  sellerIsVerified,
  imageUrl,
  onRequested,
  onNotice,
}: {
  listingId: string;
  title: string;
  price: string;
  sellerName: string;
  sellerIsVerified: boolean;
  imageUrl: string | null;
  onRequested: (reservation: RequestedReservation) => void;
  onNotice: (message: string, variant: "success" | "error") => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState<{
    message: string;
    variant: "success" | "error";
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function closeDialog() {
    if (pending) return;
    dialogRef.current?.close();
    setFeedback(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await requestReservation(listingId, message);
        setFeedback(
          result.ok ? null : { message: result.message, variant: "error" },
        );
        onNotice(result.message, result.ok ? "success" : "error");

        if (result.ok && result.reservationId) {
          onRequested({ id: result.reservationId, status: "pending" });
          setMessage("");
          dialogRef.current?.close();
        }
      } catch (error) {
        unstable_rethrow(error);
        const message = mapReservationError("request", null);
        setFeedback({ message, variant: "error" });
        onNotice(message, "error");
      } finally {
        // The response can fail after the request reaches the database.
        // Refresh after every attempt to reflect its current status.
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="min-h-12 rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8] hover:bg-[#e9effb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
      >
        Request Reservation
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="request-reservation-title"
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-[#c4c5d5] bg-white p-0 text-[#121c2a] shadow-2xl backdrop:bg-[#121c2a]/45"
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
              <h2 id="request-reservation-title" className="text-xl font-bold">
                Request this item
              </h2>
              <p className="mt-1 text-sm leading-6 text-[#5b6070]">
                Ask the seller to hold it while you arrange an on-campus meetup.
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={closeDialog}
              aria-label="Close reservation dialog"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-xl hover:bg-[#f2f3f8] disabled:opacity-50"
            >
              &times;
            </button>
          </div>

          <div className="mt-5 flex gap-4 rounded-xl border border-[#d9e3f7] bg-[#f7f9ff] p-3">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-[#d9e3f7]">
              {imageUrl ? (
                <Image
                  src={imageUrl}
                  alt=""
                  fill
                  unoptimized
                  sizes="80px"
                  className="object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-xs text-[#747685]">
                  No image
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="line-clamp-2 font-bold">{title}</p>
              <p className="mt-1 font-bold text-[#002576]">{price}</p>
              <p className="mt-1 truncate text-xs text-[#5b6070]">
                Seller: {sellerName}
              </p>
              {sellerIsVerified && (
                <div className="mt-2">
                  <VerificationBadge />
                </div>
              )}
            </div>
          </div>

          <label htmlFor="reservation-message" className="mt-5 block text-sm font-semibold">
            Message to seller <span className="font-normal text-[#747685]">(optional)</span>
          </label>
          <Textarea
            id="reservation-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={RESERVATION_MESSAGE_MAX_LENGTH}
            rows={4}
            disabled={pending}
            placeholder="For example: I can meet near the library tomorrow afternoon."
            className="mt-2"
          />
          <p className="mt-1 text-right text-xs text-[#747685]">
            {message.length}/{RESERVATION_MESSAGE_MAX_LENGTH}
          </p>

          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            No payment is collected here. Confirm the item in person and use a
            public campus location for the exchange.
          </div>

          {feedback?.variant === "error" && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {feedback.message}
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Link
              href="/reservations?view=buying"
              className="inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-semibold text-[#0038a8] hover:bg-[#e9effb]"
            >
              View my reservations
            </Link>
            <div className="flex gap-3">
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
                {pending ? "Sending..." : "Send Request"}
              </button>
            </div>
          </div>
        </form>
      </dialog>

    </>
  );
}
