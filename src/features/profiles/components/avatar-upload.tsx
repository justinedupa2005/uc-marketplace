"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { removeAvatar, uploadAvatar } from "@/features/profiles/actions";
import { ProfileAvatar } from "@/features/profiles/components/profile-avatar";
import { INITIAL_PROFILE_ACTION_STATE, ProfileFeedback } from "@/features/profiles/components/profile-feedback";
import { getAvatarFileError } from "@/features/profiles/rules";
import type { ProfileActionState } from "@/features/profiles/types";

export function AvatarUpload({ avatarUrl, fullName }: { avatarUrl: string | null; fullName: string | null }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [hasFile, setHasFile] = useState(false);

  function clearSelection() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreview(null);
    setHasFile(false);
    setFileError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  const [uploadState, uploadAction, uploading] = useActionState(
    async (previousState: ProfileActionState, formData: FormData) => {
      const result = await uploadAvatar(previousState, formData);
      // Action forms reset file inputs after a completed request. Keep the
      // preview and submit state aligned with the input, including failures.
      clearSelection();
      return result;
    },
    INITIAL_PROFILE_ACTION_STATE,
  );
  const [removeState, removeAction, removing] = useActionState(removeAvatar, INITIAL_PROFILE_ACTION_STATE);
  const pending = uploading || removing;

  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
  }, []);

  return (
    <section className="space-y-5 rounded-xl border border-[#c4c5d5] bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-bold">Profile photo</h2>
        <p id="avatar-guidance" className="mt-2 text-sm leading-6 text-[#444653]">Choose a JPG, PNG, or WebP image, up to 2 MB. Use a separate profile photo, not your school ID or verification documents.</p>
      </div>
      <div className="flex items-center gap-4">
        <ProfileAvatar avatarUrl={preview ?? avatarUrl} fullName={fullName} size={88} />
        <p className="text-sm text-[#444653]">{preview ? "New photo preview" : avatarUrl ? "Current profile photo" : "No profile photo uploaded"}</p>
      </div>
      <ProfileFeedback state={uploadState} />
      <ProfileFeedback state={removeState} />
      <form action={uploadAction} className="space-y-4">
        <label htmlFor="profile-avatar-file" className="block text-sm font-semibold">Choose profile photo</label>
        <input
          ref={fileInput}
          id="profile-avatar-file"
          type="file"
          name="avatar"
          accept="image/jpeg,image/png,image/webp"
          required
          disabled={pending}
          aria-invalid={Boolean(fileError || uploadState.fieldErrors?.avatar) || undefined}
          aria-describedby={fileError || uploadState.fieldErrors?.avatar ? "avatar-guidance avatar-error" : "avatar-guidance"}
          className="block w-full rounded-md border border-[#c4c5d5] p-3 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-[#e6eeff] file:px-3 file:py-2 file:font-semibold file:text-[#002576] disabled:cursor-wait disabled:opacity-60"
          onChange={(event) => {
            const selectedFile = event.target.files?.[0];
            if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
            previewUrl.current = null;
            setPreview(null);
            setHasFile(false);
            setFileError(null);
            if (!selectedFile) return;
            const error = getAvatarFileError(selectedFile);
            if (error) {
              event.target.value = "";
              setFileError(error);
              return;
            }
            previewUrl.current = URL.createObjectURL(selectedFile);
            setPreview(previewUrl.current);
            setHasFile(true);
          }}
          onInvalid={() => setFileError("Please choose a profile photo.")}
        />
        <FieldError id="avatar-error" message={fileError ?? uploadState.fieldErrors?.avatar?.[0]} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={pending || !hasFile} className="min-h-11 px-5 text-sm">{uploading ? "Uploading photo..." : avatarUrl ? "Replace Photo" : "Save Photo"}</Button>
          {hasFile && <Button variant="ghost" disabled={pending} onClick={clearSelection} className="min-h-11 px-4 text-sm">Cancel</Button>}
        </div>
      </form>
      {avatarUrl && (
        <form action={removeAction} className="border-t border-[#c4c5d5] pt-4" onSubmit={() => clearSelection()}>
          <Button type="submit" variant="ghost" disabled={pending} className="min-h-11 px-3 text-sm text-[#ba1a1a]">{removing ? "Removing photo..." : "Remove Profile Photo"}</Button>
        </form>
      )}
    </section>
  );
}
