"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

const listingIdSchema = z.string().uuid();
const reportSchema = z
  .object({
    listingId: listingIdSchema,
    reason: z.enum([
      "prohibited_item",
      "scam",
      "misleading",
      "duplicate",
      "inappropriate",
      "wrong_category",
      "other",
    ]),
    details: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, context) => {
    if (value.reason === "other" && (value.details?.length ?? 0) < 10) {
      context.addIssue({
        code: "custom",
        path: ["details"],
        message: "Explain the issue using at least 10 characters.",
      });
    }
  });

export type ListingActionResult = {
  ok: boolean;
  message: string;
  conversationId?: string;
};

function invalidRequest(message = "This request is invalid. Refresh and try again.") {
  return { ok: false, message } satisfies ListingActionResult;
}

function logActionFailure(action: string, code?: string) {
  console.warn("Listing action failed", { action, code: code ?? "unknown" });
}

function refreshListingPaths(listingId: string) {
  revalidatePath(`/listing/${listingId}`);
  revalidatePath("/marketplace");
  revalidatePath("/my-listings");
  revalidatePath("/favorites");
  revalidatePath("/reservations");
}

export async function startListingConversation(
  listingId: string,
): Promise<ListingActionResult> {
  const parsedId = listingIdSchema.safeParse(listingId);
  if (!parsedId.success) return invalidRequest();

  const { supabase } = await requireVerifiedActiveStudent(
    `/listing/${parsedId.data}`,
  );
  const { data, error } = await supabase.rpc("start_listing_conversation", {
    p_listing_id: parsedId.data,
  });

  if (error || typeof data !== "string") {
    logActionFailure("conversation", error?.code);
    return invalidRequest(
      "Unable to open a conversation for this item. Please try again.",
    );
  }

  revalidatePath("/messages");
  return {
    ok: true,
    conversationId: data,
    message: "Conversation ready.",
  };
}

export async function submitListingReport(
  listingId: string,
  reason: string,
  details: string,
): Promise<ListingActionResult> {
  const parsed = reportSchema.safeParse({ listingId, reason, details });
  if (!parsed.success) {
    return invalidRequest(
      parsed.error.issues[0]?.message ?? "Complete the report and try again.",
    );
  }

  const { supabase } = await requireVerifiedActiveStudent(
    `/listing/${parsed.data.listingId}`,
  );
  const { error } = await supabase.rpc("report_listing", {
    p_listing_id: parsed.data.listingId,
    p_reason: parsed.data.reason,
    p_details: parsed.data.details || undefined,
  });

  if (error) {
    logActionFailure("report", error.code);
    return invalidRequest("Unable to submit this report. Please try again.");
  }

  return {
    ok: true,
    message: "Report submitted. Our moderation team can now review it.",
  };
}

export async function changeOwnedListingStatus(
  listingId: string,
  targetStatus: "removed",
): Promise<ListingActionResult> {
  const parsed = z
    .object({ listingId: listingIdSchema, targetStatus: z.literal("removed") })
    .safeParse({ listingId, targetStatus });
  if (!parsed.success) return invalidRequest();

  const { supabase } = await requireVerifiedActiveStudent(
    `/listing/${parsed.data.listingId}`,
  );
  const { error } = await supabase.rpc("set_owned_listing_status", {
    p_listing_id: parsed.data.listingId,
    p_status: parsed.data.targetStatus,
  });

  if (error) {
    logActionFailure("owner-status", error.code);
    return invalidRequest("Unable to update your listing. Please try again.");
  }

  refreshListingPaths(parsed.data.listingId);
  return {
    ok: true,
    message: "Listing removed from marketplace browsing.",
  };
}
