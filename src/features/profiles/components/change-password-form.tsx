"use client";

import { useActionState, useRef, useState } from "react";

import { NavigationLink } from "@/components/navigation-blocker";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { changePassword, requestPasswordReauthentication } from "@/features/profiles/actions";
import { INITIAL_PROFILE_ACTION_STATE, ProfileFeedback } from "@/features/profiles/components/profile-feedback";
import type { ProfileActionState } from "@/features/profiles/types";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordSchema } from "@/lib/auth/validation";

function PasswordField({
  name,
  label,
  autoComplete,
  error,
  requirements,
  isNew = false,
}: {
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  error?: string;
  requirements?: string;
  isNew?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = `profile-${name}`;
  const describedBy = [requirements, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold">{label}</label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={isNew ? PASSWORD_MIN_LENGTH : 1}
          maxLength={PASSWORD_MAX_LENGTH}
          invalid={Boolean(error)}
          aria-describedby={describedBy}
          className="pr-16"
        />
        <button
          type="button"
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-controls={id}
          aria-pressed={visible}
          onClick={() => setVisible((previous) => !previous)}
          className="absolute inset-y-0 right-0 min-w-14 rounded-r-md px-3 text-xs font-semibold text-[#002576] hover:bg-[#e6eeff] focus-visible:outline-2 focus-visible:outline-[#0038a8]"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function ReauthenticationRequest() {
  const [state, formAction, pending] = useActionState(requestPasswordReauthentication, INITIAL_PROFILE_ACTION_STATE);

  return (
    <div className="space-y-3 rounded-lg border border-[#c4c5d5] bg-[#f9f9ff] p-4">
      <p className="text-sm leading-6 text-[#444653]">Confirm this password change with the verification code sent to your account. Request a code, then enter it below.</p>
      <form action={formAction}>
        <Button type="submit" variant="secondary" disabled={pending} className="min-h-11 px-4 text-sm">{pending ? "Sending code..." : "Send Verification Code"}</Button>
      </form>
      <ProfileFeedback state={state} />
    </div>
  );
}

export function ChangePasswordForm() {
  const form = useRef<HTMLFormElement>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [needsReauthentication, setNeedsReauthentication] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (previousState: ProfileActionState, formData: FormData) => {
      const result = await changePassword(previousState, formData);
      if (result.requiresReauthentication) setNeedsReauthentication(true);
      if (result.status === "success") form.current?.reset();
      return result;
    },
    INITIAL_PROFILE_ACTION_STATE,
  );
  const errorFor = (name: string) => localErrors[name] ?? state.fieldErrors?.[name]?.[0];

  if (state.status === "success") {
    return (
      <div className="space-y-5">
        <ProfileFeedback state={state} />
        <NavigationLink href="/profile" className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#002576] px-5 text-sm font-semibold text-white hover:bg-[#001c5b]">Back to Profile</NavigationLink>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ProfileFeedback state={state} />
      {needsReauthentication && <ReauthenticationRequest />}
      <form
        ref={form}
        action={formAction}
        className="space-y-5"
        onSubmit={(event) => {
          const formData = new FormData(event.currentTarget);
          const password = String(formData.get("password") ?? "");
          const confirmation = String(formData.get("confirmPassword") ?? "");
          const result = passwordSchema.safeParse(password);
          const errors: Record<string, string> = {};
          if (!result.success) errors.password = result.error.issues[0]?.message ?? "Choose a valid password.";
          if (password !== confirmation) errors.confirmPassword = "Passwords do not match.";
          setLocalErrors(errors);
          if (Object.keys(errors).length) event.preventDefault();
        }}
      >
        <fieldset disabled={pending} className="space-y-5">
          <PasswordField name="currentPassword" label="Current password" autoComplete="current-password" error={errorFor("currentPassword")} />
          <PasswordField name="password" label="New password" autoComplete="new-password" error={errorFor("password")} requirements="profile-password-requirements" isNew />
          <p id="profile-password-requirements" className="text-xs leading-5 text-[#444653]">Use at least {PASSWORD_MIN_LENGTH} characters with uppercase and lowercase letters, a number, and a symbol. Your new password must differ from your current password.</p>
          <PasswordField name="confirmPassword" label="Confirm new password" autoComplete="new-password" error={errorFor("confirmPassword")} isNew />
          {needsReauthentication && (
            <div>
              <label htmlFor="profile-password-nonce" className="mb-2 block text-sm font-semibold">Verification code</label>
              <Input id="profile-password-nonce" name="nonce" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required invalid={Boolean(errorFor("nonce"))} aria-describedby={errorFor("nonce") ? "profile-password-nonce-error" : undefined} />
              <FieldError id="profile-password-nonce-error" message={errorFor("nonce")} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending} className="min-h-11 px-5 text-sm">{pending ? "Updating password..." : "Change Password"}</Button>
            <NavigationLink href="/profile" className="inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold text-[#002576] hover:bg-[#e6eeff]">Cancel</NavigationLink>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
