"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { STUDENT_REPORT_REASONS } from "@/features/moderation/rules";
import type { ModerationActionResult, ReportKind } from "@/features/moderation/types";
import { requireActiveAdmin, requireVerifiedActiveStudent } from "@/lib/auth/authorization";

const uuid = z.string().uuid();
const moderatorReason = z.string().trim().min(10).max(500);
const studentReport = z.object({
  subjectId: uuid,
  reason: z.enum(STUDENT_REPORT_REASONS),
  details: z.string().trim().max(1000),
}).superRefine((value, context) => {
  if (value.reason === "other" && value.details.length < 10) {
    context.addIssue({ code: "custom", path: ["details"], message: "Explain the issue using at least 10 characters." });
  }
});

function failed(message: string): ModerationActionResult {
  return { ok: false, message };
}

function succeeded(message: string): ModerationActionResult {
  return { ok: true, message };
}

function moderationFailure(code: string | undefined): ModerationActionResult {
  if (code === "P0001" || code === "P0002") {
    return failed("This record changed or is no longer available. Refresh and review its current state.");
  }
  return failed("Unable to complete this moderation action. Refresh and try again.");
}

function refreshAdminViews() {
  revalidatePath("/admin", "layout");
}

export async function submitStudentReport(
  subjectId: string,
  reason: string,
  details: string,
): Promise<ModerationActionResult> {
  const parsed = studentReport.safeParse({ subjectId, reason, details });
  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? "Complete the report and try again.");
  }

  const { supabase } = await requireVerifiedActiveStudent("/marketplace");
  const { data, error } = await supabase.rpc("report_student", {
    p_subject_id: parsed.data.subjectId,
    p_reason: parsed.data.reason,
    p_details: parsed.data.details || undefined,
  });
  if (error || !data) {
    if (error) console.warn("Student report failed", { code: error.code });
    return failed("Unable to submit this report. Check that the student is still eligible, then try again.");
  }
  revalidatePath("/admin/reports");
  return succeeded("Report submitted privately to the moderation team.");
}

export async function moderateUser(
  userId: string,
  targetStatus: "active" | "suspended" | "disabled",
  reason: string,
): Promise<ModerationActionResult> {
  const parsed = z.object({ userId: uuid, targetStatus: z.enum(["active", "suspended", "disabled"]), reason: moderatorReason }).safeParse({ userId, targetStatus, reason });
  if (!parsed.success) return failed("Enter a moderation reason between 10 and 500 characters.");
  const { supabase } = await requireActiveAdmin("/admin/users");
  const { error } = await supabase.rpc("admin_moderate_user", {
    p_user_id: parsed.data.userId,
    p_account_status: parsed.data.targetStatus,
    p_reason: parsed.data.reason,
  });
  if (error) {
    console.warn("User moderation failed", { code: error.code });
    return moderationFailure(error.code);
  }
  refreshAdminViews();
  revalidatePath("/", "layout");
  return succeeded(targetStatus === "active"
    ? "Student account reactivated."
    : targetStatus === "disabled"
      ? "Student account disabled."
      : "Student account suspended.");
}

export async function moderateListing(
  listingId: string,
  reason: string,
): Promise<ModerationActionResult> {
  const parsed = z.object({ listingId: uuid, reason: moderatorReason }).safeParse({ listingId, reason });
  if (!parsed.success) return failed("Enter a removal reason between 10 and 500 characters.");
  const { supabase } = await requireActiveAdmin("/admin/listings");
  const { error } = await supabase.rpc("admin_moderate_listing", {
    p_listing_id: parsed.data.listingId,
    p_reason: parsed.data.reason,
  });
  if (error) {
    console.warn("Listing moderation failed", { code: error.code });
    return moderationFailure(error.code);
  }
  refreshAdminViews();
  revalidatePath("/marketplace");
  revalidatePath("/my-listings");
  revalidatePath("/reservations");
  revalidatePath("/favorites");
  revalidatePath(`/listing/${listingId}`);
  return succeeded("Listing removed from marketplace browsing.");
}

export async function reviewReport(
  kind: ReportKind,
  reportId: string,
  decision: "resolved" | "dismissed",
  note: string,
): Promise<ModerationActionResult> {
  const parsed = z.object({ kind: z.enum(["listing", "student"]), reportId: uuid, decision: z.enum(["resolved", "dismissed"]), note: moderatorReason }).safeParse({ kind, reportId, decision, note });
  if (!parsed.success) return failed("Enter a decision note between 10 and 500 characters.");
  const { supabase } = await requireActiveAdmin("/admin/reports");
  const { error } = await supabase.rpc("admin_review_report", {
    p_kind: parsed.data.kind,
    p_report_id: parsed.data.reportId,
    p_decision: parsed.data.decision,
    p_admin_note: parsed.data.note,
  });
  if (error) {
    console.warn("Report review failed", { code: error.code });
    return moderationFailure(error.code);
  }
  refreshAdminViews();
  return succeeded(decision === "resolved" ? "Report resolved." : "Report dismissed.");
}
