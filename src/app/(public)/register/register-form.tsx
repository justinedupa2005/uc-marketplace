"use client";

import { useActionState, useState } from "react";

import { FormNotification } from "@/components/form-notification";
import { COURSE_OPTIONS, YEAR_LEVEL_OPTIONS } from "@/lib/auth/options";

import { register, type RegistrationState } from "./actions";

const initialRegistrationState: RegistrationState = {
  message: null,
};

export function RegisterForm() {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
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

      <label className="block" htmlFor="studentIdNumber">
        <span className="mb-2 block text-sm font-semibold">Student ID number</span>
        <input
          id="studentIdNumber"
          type="text"
          name="studentIdNumber"
          autoComplete="off"
          inputMode="text"
          minLength={4}
          maxLength={50}
          pattern="[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*"
          placeholder="12345678"
          required
          disabled={pending}
          aria-describedby={state.message ? "registration-error" : undefined}
          className="h-12 w-full rounded-md border border-[#c4c5d5] px-4 uppercase outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]"
        />
      </label>

      <label className="block" htmlFor="course">
        <span className="mb-2 block text-sm font-semibold">Course</span>
        <select
          id="course"
          name="course"
          defaultValue=""
          required
          disabled={pending}
          aria-describedby={state.message ? "registration-error" : undefined}
          className="h-12 w-full rounded-md border border-[#c4c5d5] bg-white px-4 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]"
        >
          <option value="" disabled>
            Select your course
          </option>
          {COURSE_OPTIONS.map((course) => (
            <option key={course.value} value={course.value}>
              {course.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block" htmlFor="yearLevel">
        <span className="mb-2 block text-sm font-semibold">Year level</span>
        <select
          id="yearLevel"
          name="yearLevel"
          defaultValue=""
          required
          disabled={pending}
          aria-describedby={state.message ? "registration-error" : undefined}
          className="h-12 w-full rounded-md border border-[#c4c5d5] bg-white px-4 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]"
        >
          <option value="" disabled>
            Select your year level
          </option>
          {YEAR_LEVEL_OPTIONS.map((yearLevel) => (
            <option key={yearLevel.value} value={yearLevel.value}>
              {yearLevel.label}
            </option>
          ))}
        </select>
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

      <div>
        <label className="mb-2 block text-sm font-semibold" htmlFor="password">
          Password
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
                ? "password-requirements registration-error"
                : "password-requirements"
            }
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
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5">
              <path d="M2.25 12s3.5-6 9.75-6 9.75 6 9.75 6-3.5 6-9.75 6-9.75-6-9.75-6Z" />
              <circle cx="12" cy="12" r="2.5" />
              {passwordVisible && <path d="M3 3 21 21" />}
            </svg>
          </button>
        </div>
      </div>

      <p id="password-requirements" className="text-xs leading-5 text-[#5b6070]">
        Use at least 12 characters with uppercase, lowercase, a number, and a symbol.
      </p>

      <div>
        <label className="mb-2 block text-sm font-semibold" htmlFor="confirmPassword">
          Confirm password
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
            aria-describedby={state.message ? "registration-error" : undefined}
            className="h-12 w-full rounded-md border border-[#c4c5d5] py-2 pl-4 pr-14 outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]"
          />
          <button
            type="button"
            onClick={() => setConfirmPasswordVisible((visible) => !visible)}
            aria-label={confirmPasswordVisible ? "Hide confirm password" : "Show confirm password"}
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
