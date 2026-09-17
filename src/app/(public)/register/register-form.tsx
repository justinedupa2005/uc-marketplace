"use client";

import { useActionState } from "react";

import { FormNotification } from "@/components/form-notification";

import { register, type RegistrationState } from "./actions";

const initialRegistrationState: RegistrationState = {
  message: null,
};

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(
    register,
    initialRegistrationState,
  );

  return (
    <form action={formAction} className="mt-7 space-y-4">
      <label className="block" htmlFor="fullName">
        <span className="mb-2 block text-sm font-semibold">Full name</span>
        <input
          id="fullName"
          type="text"
          name="fullName"
          autoComplete="name"
          minLength={2}
          maxLength={100}
          required
          disabled={pending}
          aria-describedby={state.message ? "registration-error" : undefined}
          className="h-12 w-full rounded-md border border-[#c4c5d5] px-4 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]"
        />
      </label>

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
          disabled={pending}
          aria-describedby={state.message ? "registration-error" : undefined}
          className="h-12 w-full rounded-md border border-[#c4c5d5] px-4 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]"
        />
      </label>

      <label className="block" htmlFor="password">
        <span className="mb-2 block text-sm font-semibold">Password</span>
        <input
          id="password"
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
          disabled={pending}
          aria-describedby={
            state.message
              ? "password-requirements registration-error"
              : "password-requirements"
          }
          className="h-12 w-full rounded-md border border-[#c4c5d5] px-4 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]"
        />
      </label>

      <p id="password-requirements" className="text-xs leading-5 text-[#5b6070]">
        Use at least 12 characters with uppercase, lowercase, number, and symbol.
      </p>

      <label className="block" htmlFor="confirmPassword">
        <span className="mb-2 block text-sm font-semibold">Confirm password</span>
        <input
          id="confirmPassword"
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
          disabled={pending}
          aria-describedby={state.message ? "registration-error" : undefined}
          className="h-12 w-full rounded-md border border-[#c4c5d5] px-4 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]"
        />
      </label>

      {state.message && (
        <div id="registration-error">
          <FormNotification variant="error">{state.message}</FormNotification>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 h-12 w-full rounded-md bg-[#0038a8] text-sm font-semibold text-white transition-colors hover:bg-[#002576] disabled:cursor-wait disabled:bg-[#7183ad]"
      >
        {pending ? "Creating account..." : "Register"}
      </button>
    </form>
  );
}
