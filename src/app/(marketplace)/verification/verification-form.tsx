"use client";

import Image from "next/image";
import { useActionState, useEffect, useState } from "react";

import { FormNotification } from "@/components/form-notification";

import { submitStudentVerification, type VerificationActionState } from "./actions";
import { isSupportedSchoolIdImage } from "./validation";

const initialState: VerificationActionState = { message: null };

export function VerificationForm() {
  const [state, formAction, pending] = useActionState(
    submitStudentVerification,
    initialState,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;

    if (!file || !isSupportedSchoolIdImage(file)) {
      event.currentTarget.value = "";
      setSelectedFile(null);
      setPreviewUrl(null);
      setFileError("Choose a JPEG, PNG, or WebP image no larger than 5 MB.");
      return;
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setFileError(null);
  }

  return (
    <form action={formAction} id="verification-form" className="space-y-5">
      <section className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-xl font-bold">School ID</h2>
        <p className="mt-2 text-sm leading-6 text-[#444653]">
          Upload a clear photo of your own UC Main school ID. JPEG, PNG, or WebP;
          maximum 5 MB.
        </p>

        <label
          htmlFor="school-id-image"
          className="mt-5 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#b7c5df] bg-[#f9faff] px-5 text-center transition hover:border-[#0038a8] hover:bg-[#e6eeff]"
        >
          <Image src="/assets/app/upload-camera.svg" alt="" width={36} height={34} />
          <span className="mt-3 text-sm font-semibold text-[#002576]">
            {selectedFile ? "Change image" : "Choose image"}
          </span>
          <span className="mt-1 max-w-full truncate text-xs text-[#5b6070]">
            {selectedFile?.name ?? "No file selected"}
          </span>
        </label>
        <input
          id="school-id-image"
          type="file"
          name="schoolId"
          accept="image/jpeg,image/png,image/webp"
          required
          disabled={pending}
          onChange={chooseFile}
          aria-describedby={fileError ? "school-id-error" : undefined}
          className="sr-only"
        />
        {fileError && (
          <p id="school-id-error" role="alert" className="mt-3 text-sm text-[#ba1a1a]">
            {fileError}
          </p>
        )}

        {previewUrl && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold">School ID preview</h3>
            <div className="relative mt-3 h-64 overflow-hidden rounded-lg border border-[#c4c5d5] bg-[#f2f3f8] sm:h-80">
              <Image
                src={previewUrl}
                alt="Preview of your selected school ID"
                fill
                sizes="(max-width: 640px) 100vw, 640px"
                unoptimized
                className="object-contain"
              />
            </div>
          </div>
        )}

        <div className="mt-6 rounded-lg bg-[#f2f5fc] p-4 text-sm text-[#444653]">
          <h3 className="font-semibold text-[#121c2a]">Before submitting</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 leading-6">
            <li>Make sure the entire school ID is visible.</li>
            <li>Your name and student ID number should be readable.</li>
            <li>Avoid blurry, dark, or cropped images.</li>
            <li>Upload your own school ID only.</li>
          </ul>
        </div>
      </section>

      <section className="rounded-xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-xl font-bold">Privacy notice</h2>
        <p className="mt-3 text-sm leading-6 text-[#444653]">
          Your school ID image is used to verify your student identity for this
          marketplace. It is stored in a private bucket and can be accessed by
          you and authorized administrators handling verification. It will not
          appear on your public marketplace profile or listings.
        </p>
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-[#c4c5d5] p-4 text-sm leading-6">
          <input
            type="checkbox"
            name="privacyConsent"
            checked={consented}
            onChange={(event) => setConsented(event.target.checked)}
            disabled={pending}
            required
            className="mt-1 size-4 shrink-0 accent-[#0038a8]"
          />
          <span>
            I understand that my school ID will be stored privately and used
            for account verification.
          </span>
        </label>
      </section>

      {state.message && (
        <div aria-live="polite">
          <FormNotification variant="error">{state.message}</FormNotification>
        </div>
      )}

      <button
        type="submit"
        disabled={pending || !selectedFile || !consented}
        className="w-full rounded-lg bg-[#0038a8] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-[#002576] disabled:cursor-not-allowed disabled:bg-[#7183ad] sm:w-auto"
      >
        {pending ? "Uploading ID and submitting..." : "Submit for verification"}
      </button>
    </form>
  );
}
