"use client";

import { useActionState, useState } from "react";

import { FormNotification } from "@/components/form-notification";
import { COURSE_OPTIONS, YEAR_LEVEL_OPTIONS } from "@/lib/auth/options";

import { updateStudentInformation, type VerificationActionState } from "./actions";

type StudentInformationProps = {
  fullName: string | null;
  studentIdNumber: string | null;
  course: string | null;
  yearLevel: number | null;
  editable: boolean;
};

const initialState: VerificationActionState = { message: null };
const inputClass =
  "mt-1.5 h-11 w-full rounded-lg border border-[#c4c5d5] bg-white px-3 text-sm outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:bg-[#f2f3f8]";

export function StudentInformation({
  fullName,
  studentIdNumber,
  course,
  yearLevel,
  editable,
}: StudentInformationProps) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateStudentInformation,
    initialState,
  );
  const courseLabel = COURSE_OPTIONS.find((option) => option.value === course)?.label;
  const yearLabel = YEAR_LEVEL_OPTIONS.find(
    (option) => option.value === String(yearLevel),
  )?.label;

  return (
    <section className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#121c2a]">Student information</h2>
          <p className="mt-1 text-sm text-[#5b6070]">
            These details will be saved with your verification request.
          </p>
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
            disabled={pending}
            aria-expanded={editing}
            className="rounded-lg border border-[#0038a8] px-4 py-2 text-sm font-semibold text-[#0038a8] transition hover:bg-[#e6eeff] disabled:opacity-60"
          >
            {editing ? "Cancel editing" : "Edit information"}
          </button>
        )}
      </div>

      {editing && editable ? (
        <form action={formAction} className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-[#444653]">
            Full name
            <input
              name="fullName"
              defaultValue={fullName ?? ""}
              autoComplete="name"
              minLength={2}
              maxLength={100}
              required
              disabled={pending}
              className={inputClass}
            />
          </label>
          <label className="text-sm font-semibold text-[#444653]">
            Student ID number
            <input
              name="studentIdNumber"
              defaultValue={studentIdNumber ?? ""}
              minLength={4}
              maxLength={50}
              pattern="[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*"
              required
              disabled={pending}
              className={`${inputClass} uppercase`}
            />
          </label>
          <label className="text-sm font-semibold text-[#444653]">
            Course
            <select
              name="course"
              defaultValue={course ?? ""}
              required
              disabled={pending}
              className={inputClass}
            >
              <option value="" disabled>Select a course</option>
              {COURSE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-[#444653]">
            Year level
            <select
              name="yearLevel"
              defaultValue={yearLevel ? String(yearLevel) : ""}
              required
              disabled={pending}
              className={inputClass}
            >
              <option value="" disabled>Select a year level</option>
              {YEAR_LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {state.message && (
            <div className="sm:col-span-2" aria-live="polite">
              <FormNotification variant="error">{state.message}</FormNotification>
            </div>
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-[#0038a8] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#002576] disabled:cursor-wait disabled:bg-[#7183ad] sm:col-span-2 sm:justify-self-start"
          >
            {pending ? "Saving..." : "Save information"}
          </button>
        </form>
      ) : (
        <dl className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#5b6070]">Full name</dt>
            <dd className="mt-1 break-words text-sm font-medium">{fullName ?? "Not provided"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#5b6070]">Student ID number</dt>
            <dd className="mt-1 break-words text-sm font-medium">{studentIdNumber ?? "Not provided"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#5b6070]">Course</dt>
            <dd className="mt-1 break-words text-sm font-medium">{courseLabel ?? "Not provided"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[#5b6070]">Year level</dt>
            <dd className="mt-1 text-sm font-medium">{yearLabel ?? "Not provided"}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
