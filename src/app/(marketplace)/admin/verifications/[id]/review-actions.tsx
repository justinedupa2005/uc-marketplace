"use client";

import { useActionState, useRef } from "react";

import { reviewVerification, type ReviewState } from "./actions";

const initialState: ReviewState = { message: null };

export function ReviewActions({ verificationId }: { verificationId: string }) {
  const approveDialog = useRef<HTMLDialogElement>(null);
  const rejectDialog = useRef<HTMLDialogElement>(null);
  const [approveState, approveAction, approving] = useActionState(reviewVerification, initialState);
  const [rejectState, rejectAction, rejecting] = useActionState(reviewVerification, initialState);

  return (
    <section aria-labelledby="review-actions-heading" className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
      <h2 id="review-actions-heading" className="text-xl font-bold">Review this request</h2>
      <p className="mt-2 text-sm leading-6 text-[#444653]">
        Check the submitted information against the private school ID before deciding.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => approveDialog.current?.showModal()}
          className="rounded-md bg-[#0038a8] px-5 py-3 text-sm font-semibold text-white hover:bg-[#002576]"
        >
          Approve verification
        </button>
        <button
          type="button"
          onClick={() => rejectDialog.current?.showModal()}
          className="rounded-md border border-[#ba1a1a] px-5 py-3 text-sm font-semibold text-[#ba1a1a] hover:bg-red-50"
        >
          Reject
        </button>
      </div>

      <dialog ref={approveDialog} aria-labelledby="approve-heading" className="m-auto w-[min(100%-2rem,28rem)] rounded-xl border border-[#c4c5d5] bg-white p-6 text-[#121c2a] shadow-xl backdrop:bg-black/50">
        <h3 id="approve-heading" className="text-xl font-bold">Approve this student?</h3>
        <p className="mt-3 text-sm leading-6 text-[#444653]">This will mark the student account as verified.</p>
        <form action={approveAction} className="mt-6">
          <input type="hidden" name="verificationId" value={verificationId} />
          <input type="hidden" name="decision" value="approved" />
          {approveState.message && <p role="alert" className="mb-4 text-sm text-[#ba1a1a]">{approveState.message}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => approveDialog.current?.close()} disabled={approving} className="rounded-md border border-[#c4c5d5] px-4 py-2 text-sm font-semibold">Cancel</button>
            <button type="submit" disabled={approving} className="rounded-md bg-[#0038a8] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {approving ? "Approving..." : "Approve"}
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={rejectDialog} aria-labelledby="reject-heading" className="m-auto w-[min(100%-2rem,30rem)] rounded-xl border border-[#c4c5d5] bg-white p-6 text-[#121c2a] shadow-xl backdrop:bg-black/50">
        <h3 id="reject-heading" className="text-xl font-bold">Reject verification</h3>
        <p className="mt-3 text-sm leading-6 text-[#444653]">Give a specific reason so the student knows what to correct.</p>
        <form action={rejectAction} className="mt-5 space-y-4">
          <input type="hidden" name="verificationId" value={verificationId} />
          <input type="hidden" name="decision" value="rejected" />
          <label className="block text-sm font-semibold" htmlFor="rejection-reason">Reason for rejection</label>
          <textarea
            id="rejection-reason"
            name="reason"
            rows={5}
            required
            minLength={5}
            maxLength={500}
            disabled={rejecting}
            className="w-full resize-y rounded-md border border-[#c4c5d5] p-3 text-sm outline-none focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15"
          />
          {rejectState.message && <p role="alert" className="text-sm text-[#ba1a1a]">{rejectState.message}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => rejectDialog.current?.close()} disabled={rejecting} className="rounded-md border border-[#c4c5d5] px-4 py-2 text-sm font-semibold">Cancel</button>
            <button type="submit" disabled={rejecting} className="rounded-md bg-[#ba1a1a] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {rejecting ? "Rejecting..." : "Reject verification"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
