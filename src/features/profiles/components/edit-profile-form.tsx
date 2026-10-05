"use client";

import { useActionState, useState } from "react";

import { NavigationLink } from "@/components/navigation-blocker";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { updateProfile } from "@/features/profiles/actions";
import { INITIAL_PROFILE_ACTION_STATE, ProfileFeedback } from "@/features/profiles/components/profile-feedback";
import type { OwnProfile, ProfileActionState } from "@/features/profiles/types";
import { COURSE_OPTIONS, YEAR_LEVEL_OPTIONS } from "@/lib/auth/options";

export function EditProfileForm({ profile }: { profile: OwnProfile }) {
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(profile.updatedAt);
  const [state, formAction, pending] = useActionState(
    async (previousState: ProfileActionState, formData: FormData) => {
      const result = await updateProfile(previousState, formData);
      if (result.status === "success" && result.updatedAt) setExpectedUpdatedAt(result.updatedAt);
      return result;
    },
    INITIAL_PROFILE_ACTION_STATE,
  );
  const [fullName, setFullName] = useState(profile.fullName ?? "");
  const [course, setCourse] = useState(profile.course ?? "");
  const [yearLevel, setYearLevel] = useState(profile.yearLevel?.toString() ?? "");
  const canSave = profile.canEditIdentity || profile.canEditYear;
  const courseLabel = COURSE_OPTIONS.find((option) => option.value === profile.course)?.label ?? profile.course;
  const yearLabel = YEAR_LEVEL_OPTIONS.find((option) => Number(option.value) === profile.yearLevel)?.label;

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="updatedAt" value={expectedUpdatedAt} />
      <ProfileFeedback state={state} />
      {profile.role === "student" && !profile.canEditIdentity && (
        <p className="rounded-lg bg-[#e6eeff] p-4 text-sm leading-6 text-[#002576]">
          {profile.verificationStatus === "pending"
            ? "Your name, course, and year level are locked while your verification is being reviewed. You can still change your profile photo."
            : "Your name and course are linked to your verified student identity. You can update your year level and profile photo."}
        </p>
      )}
      <fieldset disabled={pending} className="space-y-5">
        <div>
          {profile.canEditIdentity
            ? <label htmlFor="profile-full-name" className="mb-2 block text-sm font-semibold">Full name</label>
            : <span className="mb-2 block text-sm font-semibold">Full name</span>}
          {profile.canEditIdentity ? (
            <Input
              id="profile-full-name"
              name="fullName"
              autoComplete="name"
              minLength={2}
              maxLength={100}
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              invalid={Boolean(state.fieldErrors?.fullName)}
              aria-describedby={state.fieldErrors?.fullName ? "profile-full-name-error" : undefined}
            />
          ) : <p id="profile-full-name" className="rounded-md border border-[#c4c5d5] bg-[#f2f3f8] px-4 py-3 text-[#444653]">{profile.fullName ?? "Name not provided"}</p>}
          <FieldError id="profile-full-name-error" message={state.fieldErrors?.fullName?.[0]} />
        </div>
        {profile.role === "student" && (
          <>
            <div>
              {profile.canEditIdentity
                ? <label htmlFor="profile-course" className="mb-2 block text-sm font-semibold">Course</label>
                : <span className="mb-2 block text-sm font-semibold">Course</span>}
              {profile.canEditIdentity ? (
                <Select
                  id="profile-course"
                  name="course"
                  required
                  value={course}
                  onChange={(event) => setCourse(event.target.value)}
                  invalid={Boolean(state.fieldErrors?.course)}
                  aria-describedby={state.fieldErrors?.course ? "profile-course-error" : undefined}
                >
                  <option value="" disabled>Select your course</option>
                  {COURSE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              ) : <p id="profile-course" className="rounded-md border border-[#c4c5d5] bg-[#f2f3f8] px-4 py-3 text-[#444653]">{courseLabel ?? "Course not provided"}</p>}
              <FieldError id="profile-course-error" message={state.fieldErrors?.course?.[0]} />
            </div>
            <div>
              {profile.canEditYear
                ? <label htmlFor="profile-year-level" className="mb-2 block text-sm font-semibold">Year level</label>
                : <span className="mb-2 block text-sm font-semibold">Year level</span>}
              {profile.canEditYear ? (
                <Select
                  id="profile-year-level"
                  name="yearLevel"
                  required
                  value={yearLevel}
                  onChange={(event) => setYearLevel(event.target.value)}
                  invalid={Boolean(state.fieldErrors?.yearLevel)}
                  aria-describedby={state.fieldErrors?.yearLevel ? "profile-year-level-error" : undefined}
                >
                  <option value="" disabled>Select your year level</option>
                  {YEAR_LEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              ) : <p id="profile-year-level" className="rounded-md border border-[#c4c5d5] bg-[#f2f3f8] px-4 py-3 text-[#444653]">{yearLabel ?? "Year level not provided"}</p>}
              <FieldError id="profile-year-level-error" message={state.fieldErrors?.yearLevel?.[0]} />
            </div>
          </>
        )}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {canSave && <Button type="submit" disabled={pending} className="min-h-11 px-5 text-sm">{pending ? "Saving..." : "Save Profile"}</Button>}
          <NavigationLink href="/profile" className="inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold text-[#002576] hover:bg-[#e6eeff]">Back to Profile</NavigationLink>
        </div>
      </fieldset>
    </form>
  );
}
