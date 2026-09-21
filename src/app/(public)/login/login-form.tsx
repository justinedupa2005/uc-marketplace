"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormNotification } from "@/components/form-notification";

import { login, type LoginState } from "./actions";

const initialLoginState: LoginState = {
  message: null,
};

type LoginFormProps = {
  nextPath: string;
};

export function LoginForm({ nextPath }: LoginFormProps) {
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

      <label className="block" htmlFor="password">
        <span className="mb-2 block text-sm font-semibold">Password</span>
        <input
          id="password"
          type="password"
          name="password"
          autoComplete="current-password"
          maxLength={256}
          required
          disabled={pending}
          aria-describedby={state.message ? "login-error" : undefined}
          className="h-12 w-full rounded-md border border-[#c4c5d5] px-4 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]"
        />
      </label>

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
