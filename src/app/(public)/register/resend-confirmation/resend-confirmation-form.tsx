"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormNotification } from "@/components/form-notification";

import {
  resendConfirmation,
  type ResendConfirmationState,
} from "./actions";

const initialState: ResendConfirmationState = {
  status: "idle",
  message: null,
};

export function ResendConfirmationForm({ codeMode }: { codeMode: boolean }) {
  const [state, formAction, pending] = useActionState(
    resendConfirmation,
    initialState,
  );
  const submitted = state.status === "success";

  return (
    <form action={formAction} className="mt-7 space-y-5">
      <label className="block" htmlFor="email">
        <span className="mb-2 block text-sm font-semibold">Email address</span>
        <input
          id="email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          required
          disabled={pending || submitted}
          aria-describedby={state.message ? "resend-confirmation-message" : undefined}
          className="h-12 w-full rounded-md border border-[#c4c5d5] px-4 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-not-allowed disabled:bg-[#f2f3f8]"
        />
      </label>

      {state.message && (
        <div id="resend-confirmation-message">
          <FormNotification
            variant={state.status === "success" ? "success" : "error"}
          >
            {state.message}
          </FormNotification>
        </div>
      )}

      {submitted && codeMode && (
        <Link
          href="/register/check-email"
          className="inline-flex h-12 w-full items-center justify-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8] transition-colors hover:bg-[#e6eeff]"
        >
          Enter confirmation code
        </Link>
      )}

      <button
        type="submit"
        disabled={pending || submitted}
        className="h-12 w-full rounded-md bg-[#0038a8] text-sm font-semibold text-white transition-colors hover:bg-[#002576] disabled:cursor-not-allowed disabled:bg-[#7183ad]"
      >
        {pending
          ? `Sending confirmation ${codeMode ? "code" : "link"}...`
          : submitted
            ? `Confirmation ${codeMode ? "code" : "link"} requested`
            : `Resend Confirmation ${codeMode ? "Code" : "Link"}`}
      </button>
    </form>
  );
}
