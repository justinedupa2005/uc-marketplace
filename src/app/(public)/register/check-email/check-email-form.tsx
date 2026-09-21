"use client";

import { useActionState } from "react";

import { FormNotification } from "@/components/form-notification";

import { verifyRegistrationCode, type VerificationCodeState } from "./actions";

const initialState: VerificationCodeState = { message: null };

export function CheckEmailForm() {
  const [state, formAction, pending] = useActionState(
    verifyRegistrationCode,
    initialState,
  );

  return (
    <form action={formAction} className="mt-7 space-y-5">
      <label className="block" htmlFor="email">
        <span className="mb-2 block text-sm font-semibold">Email address</span>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          required
          disabled={pending}
          aria-describedby={state.message ? "verification-code-message" : undefined}
          className="h-12 w-full rounded-md border border-[#c4c5d5] px-4 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-not-allowed disabled:bg-[#f2f3f8]"
        />
      </label>

      <label className="block" htmlFor="code">
        <span className="mb-2 block text-sm font-semibold">Verification code</span>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{8}"
          minLength={8}
          maxLength={8}
          placeholder="00000000"
          required
          disabled={pending}
          aria-describedby={state.message ? "verification-code-message" : undefined}
          className="h-12 w-full rounded-md border border-[#c4c5d5] px-4 tracking-[0.2em] outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-not-allowed disabled:bg-[#f2f3f8]"
        />
      </label>

      {state.message && (
        <div id="verification-code-message">
          <FormNotification variant="error">{state.message}</FormNotification>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-md bg-[#0038a8] text-sm font-semibold text-white transition-colors hover:bg-[#002576] disabled:cursor-not-allowed disabled:bg-[#7183ad]"
      >
        {pending ? "Verifying..." : "Verify Email"}
      </button>
    </form>
  );
}
