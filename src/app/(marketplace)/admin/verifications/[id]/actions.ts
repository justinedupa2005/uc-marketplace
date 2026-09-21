"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  getActiveAdmin,
  VERIFICATION_ID_PATTERN,
} from "../admin-access";

export type ReviewState = { message: string | null };

export async function reviewVerification(
  _previousState: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const id = formData.get("verificationId");
  const decision = formData.get("decision");
  const rawReason = formData.get("reason");

  if (typeof id !== "string" || !VERIFICATION_ID_PATTERN.test(id)) {
    return { message: "This verification request is invalid." };
  }

  if (decision !== "approved" && decision !== "rejected") {
    return { message: "Choose a valid review action." };
  }

  const reason = typeof rawReason === "string" ? rawReason.trim() : "";

  if (decision === "rejected" && (reason.length < 5 || reason.length > 500)) {
    return { message: "Enter a useful reason between 5 and 500 characters." };
  }

  let reviewErrorCode: string | null = null;
  let reviewFailed = false;

  try {
    const auth = await getActiveAdmin();

    if (!auth) {
      return { message: "Your administrator access could not be confirmed. Sign in again." };
    }

    const { error } = await auth.supabase.rpc("review_verification", {
      p_verification_id: id,
      p_decision: decision,
      p_rejection_reason: decision === "rejected" ? reason : null,
    });
    reviewFailed = error !== null;
    reviewErrorCode = error?.code ?? null;
  } catch {
    return { message: "We couldn't complete this review. Please try again." };
  }

  if (reviewFailed) {
    if (reviewErrorCode === "P0001") {
      revalidatePath(`/admin/verifications/${id}`);
      redirect(`/admin/verifications/${id}?notice=already-reviewed`);
    }

    return { message: "We couldn't complete this review. Please try again." };
  }

  revalidatePath(`/admin/verifications/${id}`);
  revalidatePath("/admin/verifications");
  redirect(`/admin/verifications/${id}?notice=${decision}`);
}
