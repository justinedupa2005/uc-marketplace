"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getValidatedUser } from "@/lib/auth/server";

import {
  hasMatchingImageSignature,
  isSupportedSchoolIdImage,
  SCHOOL_ID_EXTENSIONS,
  studentInformationSchema,
} from "./validation";

export type VerificationActionState = { message: string | null };

type VerificationSupabase = Awaited<ReturnType<typeof getValidatedUser>>["supabase"];
type UploadContext = {
  supabase: VerificationSupabase;
  userId: string;
  verificationId: string;
  documentPath: string;
};

const unavailableMessage = "Verification is temporarily unavailable. Please try again.";

async function reconcileUpload({
  supabase,
  userId,
  verificationId,
  documentPath,
}: UploadContext, allowCleanup: boolean): Promise<"submitted" | "removed" | "unknown"> {
  try {
    const { data: existing, error: lookupError } = await supabase
      .from("verifications")
      .select("id")
      .eq("id", verificationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (lookupError) return "unknown";
    if (existing) return "submitted";
    if (!allowCleanup) return "unknown";

    // Only clean up after a definite database rejection. A transport failure
    // may still be committing, so deleting its document could strand a row.
    // Storage RLS also refuses deletion once a request references the object.
    const { error: removeError } = await supabase.storage
      .from("student-verifications")
      .remove([documentPath]);
    return removeError ? "unknown" : "removed";
  } catch {
    return "unknown";
  }
}

export async function updateStudentInformation(
  _previousState: VerificationActionState,
  formData: FormData,
): Promise<VerificationActionState> {
  const parsed = studentInformationSchema.safeParse({
    fullName: formData.get("fullName"),
    studentIdNumber: formData.get("studentIdNumber"),
    course: formData.get("course"),
    yearLevel: formData.get("yearLevel"),
  });

  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Check your information." };
  }

  try {
    const { supabase, user } = await getValidatedUser();
    if (!user) {
      return { message: "Your session expired. Log in and try again." };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, account_status, verification_status")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return { message: unavailableMessage };
    }

    if (
      profile.role !== "student" ||
      profile.account_status !== "active" ||
      !["unverified", "rejected"].includes(profile.verification_status)
    ) {
      return { message: "Your information cannot be changed while verification is in progress." };
    }

    const { fullName, studentIdNumber, course, yearLevel } = parsed.data;
    const { data: updatedProfile, error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        student_id_number: studentIdNumber,
        course,
        year_level: yearLevel,
      })
      .eq("id", user.id)
      .select("id")
      .maybeSingle();

    if (error || !updatedProfile) {
      return {
        message:
          error?.code === "23505"
            ? "This student ID number cannot be used. Check it or contact an administrator."
            : "We couldn't save your information. Please try again.",
      };
    }
  } catch {
    return { message: unavailableMessage };
  }

  revalidatePath("/verification");
  redirect("/verification?information=updated");
}

export async function submitStudentVerification(
  _previousState: VerificationActionState,
  formData: FormData,
): Promise<VerificationActionState> {
  if (formData.get("privacyConsent") !== "on") {
    return { message: "Accept the privacy notice before submitting." };
  }

  const image = formData.get("schoolId");
  if (!(image instanceof File) || !isSupportedSchoolIdImage(image)) {
    return { message: "Choose a JPEG, PNG, or WebP image no larger than 5 MB." };
  }

  let hasValidSignature = false;
  try {
    hasValidSignature = await hasMatchingImageSignature(image);
  } catch {
    return { message: "We couldn't read the selected image. Choose another file." };
  }

  if (!hasValidSignature) {
    return { message: "The selected file is not a valid JPEG, PNG, or WebP image." };
  }

  let submitted = false;
  let uploadContext: UploadContext | null = null;

  try {
    const { supabase, user } = await getValidatedUser();
    if (!user) {
      return { message: "Your session expired. Log in and try again." };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select(
        "full_name, student_id_number, course, year_level, role, account_status, verification_status",
      )
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return { message: unavailableMessage };
    }

    if (profile.role !== "student" || profile.account_status !== "active") {
      return { message: "This account cannot submit student verification." };
    }

    if (!["unverified", "rejected"].includes(profile.verification_status)) {
      return { message: "A verification request is already pending or complete. Refresh this page." };
    }

    const information = studentInformationSchema.safeParse({
      fullName: profile.full_name,
      studentIdNumber: profile.student_id_number,
      course: profile.course,
      yearLevel: profile.year_level,
    });

    if (!information.success) {
      return { message: "Complete your student information before submitting." };
    }

    const verificationId = crypto.randomUUID();
    const extension = SCHOOL_ID_EXTENSIONS[image.type];
    const documentPath = `${user.id}/${verificationId}/student-id.${extension}`;
    uploadContext = { supabase, userId: user.id, verificationId, documentPath };
    const { error: uploadError } = await supabase.storage
      .from("student-verifications")
      .upload(documentPath, image, {
        contentType: image.type,
        cacheControl: "0",
        upsert: false,
      });

    if (uploadError) {
      return { message: "We couldn't upload your school ID. Please try again." };
    }

    const { error: submitError } = await supabase.rpc("submit_verification", {
      p_verification_id: verificationId,
      p_document_path: documentPath,
    });

    if (submitError) {
      // A network error can happen after a successful commit. Confirm the
      // result before removing the image so a submitted record is preserved.
      const definiteRejection = new Set([
        "22023", "23505", "42501", "P0001", "P0002",
      ]).has(submitError.code);
      const result = await reconcileUpload(uploadContext, definiteRejection);
      if (result === "submitted") {
        submitted = true;
      }

      if (!submitted) {
        return {
          message:
            submitError.code === "23505"
              ? "A verification request is already pending. Refresh this page."
              : result === "unknown"
                ? "We couldn't confirm your submission. Refresh this page before trying again."
                : "We couldn't submit your verification. Please try again.",
        };
      }
    } else {
      submitted = true;
    }
  } catch {
    if (uploadContext) {
      submitted = (await reconcileUpload(uploadContext, false)) === "submitted";
    }
    if (!submitted) {
      return {
        message: "We couldn't confirm your submission. Refresh this page before trying again.",
      };
    }
  }

  if (!submitted) {
    return { message: "We couldn't submit your verification. Please try again." };
  }

  revalidatePath("/verification");
  redirect("/verification");
}
