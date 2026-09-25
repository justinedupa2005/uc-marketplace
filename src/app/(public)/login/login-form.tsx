"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { FormNotification } from "@/components/form-notification";

import { login, type LoginState } from "./actions";

const initialLoginState: LoginState = {
  message: null,
};

type LoginFormProps = {
  nextPath: string;
};

export function LoginForm({ nextPath }: LoginFormProps) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [state, formAction, pending] = useActionState(
    login,
    initialLoginState,
  );

  return (
    <form action={formAction} className="mt-7 space-y-5">
      <input type="hidden" name="next" value={nextPath} />

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
          aria-describedby={state.message ? "login-error" : undefined}
          className="h-12 w-full rounded-md border border-[#c4c5d5] px-4 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]"
        />
      </label>

      <div>
        <label className="mb-2 block text-sm font-semibold" htmlFor="password">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={passwordVisible ? "text" : "password"}
            name="password"
            autoComplete="current-password"
            maxLength={256}
            required
            disabled={pending}
            aria-describedby={state.message ? "login-error" : undefined}
            className="h-12 w-full rounded-md border border-[#c4c5d5] py-2 pl-4 pr-14 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]"
          />
          <button
            type="button"
            onClick={() => setPasswordVisible((visible) => !visible)}
            aria-label={passwordVisible ? "Hide password" : "Show password"}
            aria-pressed={passwordVisible}
            aria-controls="password"
            disabled={pending}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-[#5b6070] hover:text-[#0038a8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8] disabled:cursor-wait"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
            >
              <path d="M2.25 12s3.5-6 9.75-6 9.75 6 9.75 6-3.5 6-9.75 6-9.75-6Z" />
              <circle cx="12" cy="12" r="2.5" />
              {passwordVisible && <path d="M3 3 21 21" />}
            </svg>
          </button>
        </div>
      </div>

      <div className="-mt-2 text-right">
        <Link
          href="/forgot-password"
          className="text-sm font-semibold text-[#0038a8] hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      {state.message && (
        <div id="login-error">
          <FormNotification variant="error">{state.message}</FormNotification>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-md bg-[#0038a8] text-sm font-semibold text-white transition-colors hover:bg-[#002576] disabled:cursor-wait disabled:bg-[#7183ad]"
      >
        {pending ? "Logging in..." : "Log In"}
      </button>
    </form>
  );
}
