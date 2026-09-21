"use client";

import { useActionState, useState } from "react";

import { logout } from "@/app/auth/actions";
import { FormNotification } from "@/components/form-notification";

import { updatePassword, type ResetPasswordState } from "./actions";

const initialResetPasswordState: ResetPasswordState = {
  message: null,
  status: "idle",
};

export function ResetPasswordForm() {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [state, formAction, pending] = useActionState(
    updatePassword,
    initialResetPasswordState,
  );

  if (state.status === "password-updated") {
    return (
      <div className="mt-7 space-y-5">
        <FormNotification variant="success">{state.message}</FormNotification>
        <form action={logout}>
          <button
            type="submit"
            className="h-12 w-full rounded-md bg-[#0038a8] text-sm font-semibold text-white transition-colors hover:bg-[#002576]"
          >
            Log Out
          </button>
        </form>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-7 space-y-4">
      <div>
        <label className="mb-2 block text-sm font-semibold" htmlFor="password">
          New password
        </label>
        <div className="relative">
          <input
            id="password"
            type={passwordVisible ? "text" : "password"}
            name="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={256}
            required
            disabled={pending}
            aria-describedby={
              state.message
                ? "reset-password-requirements reset-password-error"
                : "reset-password-requirements"
            }
            className="h-12 w-full rounded-md border border-[#c4c5d5] py-2 pl-4 pr-14 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]"
          />
          <button
            type="button"
            onClick={() => setPasswordVisible((visible) => !visible)}
            aria-label={passwordVisible ? "Hide new password" : "Show new password"}
            aria-pressed={passwordVisible}
            aria-controls="password"
            disabled={pending}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-[#5b6070] hover:text-[#0038a8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8] disabled:cursor-wait"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5">
              <path d="M2.25 12s3.5-6 9.75-6 9.75 6 9.75 6-3.5 6-9.75 6-9.75-6-9.75-6Z" />
              <circle cx="12" cy="12" r="2.5" />
              {passwordVisible && <path d="M3 3 21 21" />}
            </svg>
          </button>
        </div>
      </div>

      <p
        id="reset-password-requirements"
        className="text-xs leading-5 text-[#5b6070]"
      >
        Use at least 12 characters with uppercase, lowercase, a number, and a symbol.
      </p>

      <div>
        <label className="mb-2 block text-sm font-semibold" htmlFor="confirmPassword">
          Confirm new password
        </label>
        <div className="relative">
          <input
            id="confirmPassword"
            type={confirmPasswordVisible ? "text" : "password"}
            name="confirmPassword"
            autoComplete="new-password"
            minLength={12}
            maxLength={256}
            required
            disabled={pending}
            aria-describedby={state.message ? "reset-password-error" : undefined}
            className="h-12 w-full rounded-md border border-[#c4c5d5] py-2 pl-4 pr-14 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]"
          />
          <button
            type="button"
            onClick={() => setConfirmPasswordVisible((visible) => !visible)}
            aria-label={confirmPasswordVisible ? "Hide confirm new password" : "Show confirm new password"}
            aria-pressed={confirmPasswordVisible}
            aria-controls="confirmPassword"
            disabled={pending}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-[#5b6070] hover:text-[#0038a8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8] disabled:cursor-wait"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5">
              <path d="M2.25 12s3.5-6 9.75-6 9.75 6 9.75 6-3.5 6-9.75 6-9.75-6-9.75-6Z" />
              <circle cx="12" cy="12" r="2.5" />
              {confirmPasswordVisible && <path d="M3 3 21 21" />}
            </svg>
          </button>
        </div>
      </div>

      {state.message && (
        <div id="reset-password-error">
          <FormNotification variant="error">{state.message}</FormNotification>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 h-12 w-full rounded-md bg-[#0038a8] text-sm font-semibold text-white transition-colors hover:bg-[#002576] disabled:cursor-wait disabled:bg-[#7183ad]"
      >
        {pending ? "Updating password..." : "Update Password"}
      </button>
    </form>
  );
}
