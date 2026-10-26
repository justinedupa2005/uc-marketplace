"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getValidatedUser } from "@/lib/auth/server";

import { studentInformationSchema } from "./validation";
import { isOwnedPrivateImagePath, readPrivateImage } from "@/features/uploads/private-images";

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

export async function prepareVerificationUpload(
  formData: FormData,
): Promise<VerificationActionState & { upload?: { ownerId: string; verificationId: string } }> {
  if (formData.get("privacyConsent") !== "on") {
    return { message: "Accept the privacy notice before submitting." };
  }
  try {
    const { supabase, user } = await getValidatedUser();
    if (!user) return { message: "Your session expired. Log in and try again." };
    const { data: profile, error } = await supabase.from("profiles")
      .select("full_name, student_id_number, course, year_level, role, account_status, verification_status")
      .eq("id", user.id).maybeSingle();
    if (error || !profile) return { message: unavailableMessage };
    if (profile.role !== "student" || profile.account_status !== "active" ||
      !["unverified", "rejected"].includes(profile.verification_status)) {
      return { message: "This account cannot submit student verification. Refresh this page." };
    }
    const information = studentInformationSchema.safeParse({ fullName: profile.full_name,
      studentIdNumber: profile.student_id_number, course: profile.course, yearLevel: profile.year_level });
    if (!information.success) return { message: "Complete your student information before submitting." };
    return { message: null, upload: { ownerId: user.id, verificationId: crypto.randomUUID() } };
  } catch { return { message: unavailableMessage }; }
}

export async function submitStudentVerification(
  _previousState: VerificationActionState,
  formData: FormData,
): Promise<VerificationActionState> {
  if (formData.get("privacyConsent") !== "on") {
    return { message: "Accept the privacy notice before submitting." };
  }
  const id = z.string().uuid().safeParse(formData.get("verificationId"));
  const documentPath = formData.get("documentPath");
  if (!id.success || typeof documentPath !== "string" || documentPath.length > 160 || formData.has("schoolId")) {
    return { message: "This upload form expired. Choose your school ID again." };
  }

  let submitted = false;
  let uploadContext: UploadContext | null = null;

  try {
    const { supabase, user } = await getValidatedUser();
    if (!user) {
      return { message: "Your session expired. Log in and try again." };
    }

    const verificationId = id.data;
    if (!isOwnedPrivateImagePath(documentPath, user.id, verificationId, "verification")) {
      return { message: "The school ID upload does not belong to this request." };
    }
    uploadContext = { supabase, userId: user.id, verificationId, documentPath };

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
      await reconcileUpload(uploadContext, true);
      return { message: "This account cannot submit student verification." };
    }

    if (!["unverified", "rejected"].includes(profile.verification_status)) {
      await reconcileUpload(uploadContext, true);
      return { message: "A verification request is already pending or complete. Refresh this page." };
    }

    const information = studentInformationSchema.safeParse({
      fullName: profile.full_name,
      studentIdNumber: profile.student_id_number,
      course: profile.course,
      yearLevel: profile.year_level,
    });

    if (!information.success) {
      await reconcileUpload(uploadContext, true);
      return { message: "Complete your student information before submitting." };
    }

    if (!(await readPrivateImage(supabase.storage.from("student-verifications"), documentPath))) {
      await reconcileUpload(uploadContext, true);
      return { message: "The uploaded school ID is invalid or unavailable. Use a JPEG, PNG, or WebP image no larger than 5 MB." };
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
