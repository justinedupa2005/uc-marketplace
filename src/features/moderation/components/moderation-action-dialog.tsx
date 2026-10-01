"use client";

import { useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";

import {
  moderateListing,
  moderateUser,
  reviewReport,
} from "@/features/moderation/actions";

type ModerationResult = { ok: boolean; message: string };

function ModerationActionDialog({
  triggerLabel,
  title,
  description,
  confirmLabel,
  fieldLabel,
  danger = false,
  onConfirm,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  fieldLabel: string;
  danger?: boolean;
  onConfirm: (note: string) => Promise<ModerationResult>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<ModerationResult | null>(null);
  const [pending, startTransition] = useTransition();
  const headingId = title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    startTransition(async () => {
      try {
        const result = await onConfirm(note.trim());
        setFeedback(result);
        if (result.ok) {
          setNote("");
          dialog.current?.close();
        }
      } catch (error) {
        unstable_rethrow(error);
        setFeedback({ ok: false, message: "Unable to complete this action. Please try again." });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFeedback(null);
          dialog.current?.showModal();
        }}
        className={`inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold ${
          danger
            ? "border-[#ba1a1a] text-[#ba1a1a] hover:bg-red-50"
            : "border-[#0038a8] text-[#0038a8] hover:bg-[#e9effb]"
        }`}
      >
        {triggerLabel}
      </button>

      {feedback?.ok && (
        <p role="status" className="text-sm font-medium text-green-800">{feedback.message}</p>
      )}

      <dialog
        ref={dialog}
        aria-labelledby={headingId}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-[#c4c5d5] bg-white p-0 text-[#121c2a] shadow-2xl backdrop:bg-[#121c2a]/45"
      >
        <form onSubmit={submit} className="space-y-5 p-6 sm:p-7">
          <div>
            <h2 id={headingId} className="text-xl font-bold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-[#444653]">{description}</p>
          </div>
          <div>
            <label htmlFor={`${headingId}-note`} className="block text-sm font-semibold">{fieldLabel}</label>
            <textarea
              id={`${headingId}-note`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              required
              minLength={10}
              maxLength={500}
              rows={4}
              disabled={pending}
              className="mt-2 w-full resize-y rounded-md border border-[#c4c5d5] p-3 text-sm outline-none focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:opacity-60"
            />
            <p className="mt-1 text-xs text-[#444653]">10–500 characters. Kept in the private moderation record.</p>
          </div>
          {feedback && !feedback.ok && <p role="alert" className="text-sm text-[#ba1a1a]">{feedback.message}</p>}
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              disabled={pending}
              className="inline-flex min-h-11 items-center rounded-md border border-[#c4c5d5] px-4 text-sm font-semibold hover:bg-[#f2f3f8]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || note.trim().length < 10}
              className={`inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60 ${
                danger ? "bg-[#ba1a1a] hover:bg-red-800" : "bg-[#0038a8] hover:bg-[#002576]"
              }`}
            >
              {pending ? "Saving…" : confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function UserModerationControls({
  userId,
  accountStatus,
}: {
  userId: string;
  accountStatus: string;
}) {
  if (accountStatus !== "active" && accountStatus !== "suspended" && accountStatus !== "disabled") {
    return <p className="text-sm text-[#444653]">No status action is available for this account.</p>;
  }

  const suspending = accountStatus === "active";

  return (
    <ModerationActionDialog
      triggerLabel={suspending ? "Suspend account" : "Reactivate account"}
      title={suspending ? "Suspend this account?" : "Reactivate this account?"}
      description={suspending
        ? "The student will lose marketplace access. Existing records are retained for moderation and support."
        : "The student will regain access based on their current verification status."}
      confirmLabel={suspending ? "Suspend account" : "Reactivate account"}
      fieldLabel={suspending ? "Reason for suspension" : "Reason for reactivation"}
      danger={suspending}
      onConfirm={(reason) => moderateUser(userId, suspending ? "suspended" : "active", reason)}
    />
  );
}

export function ListingModerationControls({
  listingId,
  status,
}: {
  listingId: string;
  status: string;
}) {
  if (status === "removed") {
    return <p className="text-sm text-[#444653]">This listing has already been removed.</p>;
  }

  return (
    <ModerationActionDialog
      triggerLabel="Remove listing"
      title="Remove this listing?"
      description="This will take the item out of marketplace browsing and prevent further transactions. Check the item and any linked reports first."
      confirmLabel="Remove listing"
      fieldLabel="Reason for removal"
      danger
      onConfirm={(reason) => moderateListing(listingId, reason)}
    />
  );
}

export function ReportModerationControls({
  kind,
  reportId,
  status,
}: {
  kind: "listing" | "student";
  reportId: string;
  status: string;
}) {
  if (status !== "pending" && status !== "reviewing") {
    return <p className="text-sm text-[#444653]">This report has already been closed.</p>;
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      <ModerationActionDialog
        triggerLabel="Resolve report"
        title="Resolve this report?"
        description="Use this after reviewing the evidence and taking any needed account or listing action. Resolving a report does not remove content or suspend an account by itself."
        confirmLabel="Resolve report"
        fieldLabel="Private resolution note"
        onConfirm={(note) => reviewReport(kind, reportId, "resolved", note)}
      />
      <ModerationActionDialog
        triggerLabel="Dismiss report"
        title="Dismiss this report?"
        description="Use this when the report does not justify further moderation action. The decision and note remain in the audit record."
        confirmLabel="Dismiss report"
        fieldLabel="Private dismissal note"
        onConfirm={(note) => reviewReport(kind, reportId, "dismissed", note)}
      />
    </div>
  );
}
