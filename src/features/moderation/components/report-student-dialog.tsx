"use client";

import { unstable_rethrow } from "next/navigation";
import { useCallback, useRef, useState, useTransition, type FormEvent } from "react";

import { ActionNotice } from "@/components/action-notice";
import { submitStudentReport } from "@/features/moderation/actions";

const reasons = [
  ["scam", "Scam or fraud"],
  ["harassment", "Harassment"],
  ["abusive_behavior", "Abusive behavior"],
  ["impersonation", "Impersonation"],
  ["unsafe_meetup", "Unsafe meetup"],
  ["spam", "Spam"],
  ["other", "Other"],
] as const;

export function ReportStudentDialog({
  studentId,
  studentName,
}: {
  studentId: string;
  studentName: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [feedback, setFeedback] = useState<{
    message: string;
    variant: "success" | "error";
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const dismissFeedback = useCallback(() => setFeedback(null), []);

  function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await submitStudentReport(studentId, reason, details);
        setFeedback({
          message: result.message,
          variant: result.ok ? "success" : "error",
        });

        if (result.ok) {
          dialogRef.current?.close();
          setReason("");
          setDetails("");
        }
      } catch (error) {
        unstable_rethrow(error);
        setFeedback({
          message: "Unable to submit this report. Please try again.",
          variant: "error",
        });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFeedback(null);
          dialogRef.current?.showModal();
        }}
        className="min-h-11 rounded-md px-3 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
      >
        Report Student
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="report-student-title"
        aria-describedby="report-student-description"
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onClose={() => {
          setReason("");
          setDetails("");
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-[#c4c5d5] bg-white p-0 text-[#121c2a] shadow-2xl backdrop:bg-[#121c2a]/45"
      >
        <form onSubmit={submitReport} className="p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="report-student-title" className="text-xl font-bold">
                Report student
              </h2>
              <p
                id="report-student-description"
                className="mt-1 text-sm leading-6 text-[#5b6070]"
              >
                Tell marketplace moderators about your experience with {studentName}.
                Reports are private; please avoid adding sensitive information.
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => dialogRef.current?.close()}
              aria-label="Close student report dialog"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-xl hover:bg-[#f2f3f8] disabled:cursor-wait disabled:opacity-60"
            >
              &times;
            </button>
          </div>

          <label
            htmlFor="student-report-reason"
            className="mt-6 block text-sm font-semibold"
          >
            Reason
          </label>
          <select
            id="student-report-reason"
            required
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setFeedback(null);
            }}
            disabled={pending}
            className="mt-2 h-12 w-full rounded-md border border-[#c4c5d5] bg-white px-3 outline-none focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15"
          >
            <option value="">Select a reason</option>
            {reasons.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <label
            htmlFor="student-report-details"
            className="mt-5 block text-sm font-semibold"
          >
            Additional details {reason === "other" ? "(required)" : "(optional)"}
          </label>
          <textarea
            id="student-report-details"
            value={details}
            onChange={(event) => {
              setDetails(event.target.value);
              setFeedback(null);
            }}
            required={reason === "other"}
            minLength={reason === "other" ? 10 : undefined}
            maxLength={1000}
            disabled={pending}
            rows={4}
            className="mt-2 w-full resize-y rounded-md border border-[#c4c5d5] bg-white p-3 outline-none focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15"
          />

          {feedback?.variant === "error" && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {feedback.message}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => dialogRef.current?.close()}
              className="min-h-11 rounded-md px-4 text-sm font-semibold text-[#444653] hover:bg-[#f2f3f8] disabled:cursor-wait disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !reason}
              className="min-h-11 rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576] disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? "Submitting…" : "Submit Report"}
            </button>
          </div>
        </form>
      </dialog>

      <ActionNotice
        message={feedback?.variant === "success" ? feedback.message : null}
        variant="success"
        onDismiss={dismissFeedback}
      />
    </>
  );
}
