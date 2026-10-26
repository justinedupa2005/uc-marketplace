"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";
import {
  getListingFieldErrors,
  listingDetailsSchema,
  type ListingFieldErrors,
} from "@/features/listings/validation";
import { isOwnedPrivateImagePath, parsePrivateImagePaths, readPrivateImage } from "@/features/uploads/private-images";

export type CreateListingState = {
  message: string | null;
  fieldErrors: ListingFieldErrors;
  submissionId: string;
};

type AuthorizedSupabase = Awaited<
  ReturnType<typeof requireVerifiedActiveStudent>
>["supabase"];

type CleanupContext = {
  supabase: AuthorizedSupabase;
  listingId: string;
  uploadedPaths: string[];
};

const submissionTokenSchema = z.string().uuid();
const genericFailureMessage =
  "We couldn't publish your listing. Your information is still here, so you can try again.";

function actionState(
  submissionId: string,
  message: string,
  fieldErrors: ListingFieldErrors = {},
): CreateListingState {
  return { submissionId, message, fieldErrors };
}

function logListingFailure(stage: string, code?: string) {
  // Keep diagnostics useful without logging form values, filenames, or user IDs.
  console.warn("Listing creation failed", { stage, code: code ?? "unknown" });
}

async function removeUploadedObjects(
  supabase: AuthorizedSupabase,
  uploadedPaths: string[],
) {
  let allRemoved = true;

  // Remove one object at a time so one failed cleanup does not prevent attempts
  // for the other successfully uploaded files.
  for (const path of uploadedPaths) {
    try {
      const { error } = await supabase.storage
        .from("listing-images")
        .remove([path]);

      if (!error) {
        continue;
      }

      allRemoved = false;
      logListingFailure("storage-cleanup", error.name);
    } catch {
      allRemoved = false;
      logListingFailure("storage-cleanup");
    }
  }

  return allRemoved;
}

async function cleanupIncompleteListing({
  supabase,
  listingId,
  uploadedPaths,
}: CleanupContext) {
  // Storage RLS requires the owned listing to still exist, so objects must be
  // removed before deleting the draft row.
  const objectsRemoved = await removeUploadedObjects(supabase, uploadedPaths);

  if (!objectsRemoved) {
    return false;
  }

  try {
    const { error } = await supabase.rpc("discard_listing_draft", {
      p_listing_id: listingId,
    });

    if (!error) {
      return true;
    }

    logListingFailure("draft-cleanup", error.code);
    return false;
  } catch {
    logListingFailure("draft-cleanup");
    return false;
  }
}

async function findListingForSubmission(
  supabase: AuthorizedSupabase,
  sellerId: string,
  submissionId: string,
) {
  return supabase
    .from("listings")
    .select("id, status")
    .eq("seller_id", sellerId)
    .eq("submission_token", submissionId)
    .maybeSingle();
}

function redirectToCreatedListing(listingId: string): never {
  revalidatePath("/marketplace");
  revalidatePath("/my-listings");
  revalidatePath(`/listing/${listingId}`);
  redirect(`/listing/${listingId}?created=1`);
}

export async function prepareListingUpload(
  previousState: CreateListingState,
  formData: FormData,
): Promise<CreateListingState & { upload?: { listingId: string; ownerId: string } }> {
  const submittedToken = submissionTokenSchema.safeParse(
    formData.get("submissionToken"),
  );
  const submissionId = submittedToken.success
    ? submittedToken.data
    : previousState.submissionId;

  if (
    !submittedToken.success ||
    !submissionTokenSchema.safeParse(submissionId).success
  ) {
    return actionState(
      crypto.randomUUID(),
      "This form expired. Review your information and submit it again.",
    );
  }

  const parsed = listingDetailsSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    categoryId: formData.get("categoryId"),
    price: formData.get("price"),
    condition: formData.get("condition"),
  });

  if (!parsed.success) {
    return actionState(
      submissionId,
      "Check the highlighted fields and try again.",
      getListingFieldErrors(parsed.error),
    );
  }

  const { supabase, user } = await requireVerifiedActiveStudent("/sell");
  let category: { id: string } | null = null;
  let categoryError: { code?: string } | null = null;

  try {
    const result = await supabase
      .from("categories")
      .select("id")
      .eq("id", parsed.data.categoryId)
      .eq("is_active", true)
      .maybeSingle();
    category = result.data;
    categoryError = result.error;
  } catch {
    categoryError = { code: "network_error" };
  }

  if (categoryError) {
    logListingFailure("category-check", categoryError.code);
    return actionState(
      submissionId,
      "We couldn't verify the selected category. Please try again.",
    );
  }

  if (!category) {
    return actionState(
      submissionId,
      "The selected category is no longer available. Choose another category.",
      { categoryId: "Select an active category." },
    );
  }

  const listingId = crypto.randomUUID();
  let draft: { id: string; status: string } | null = null;
  let draftError: { code?: string } | null = null;

  try {
    const result = await supabase
      .from("listings")
      .insert({
        id: listingId,
        seller_id: user.id,
        submission_token: submissionId,
        category_id: parsed.data.categoryId,
        title: parsed.data.title,
        description: parsed.data.description,
        price: Number(parsed.data.price),
        condition: parsed.data.condition,
      })
      .select("id, status")
      .maybeSingle();
    draft = result.data;
    draftError = result.error;
  } catch {
    draftError = { code: "network_error" };
  }

  if (draftError || !draft) {
    let existing: { id: string; status: string } | null = null;
    let existingError = false;

    try {
      const result = await findListingForSubmission(
        supabase,
        user.id,
        submissionId,
      );
      existing = result.data;
      existingError = Boolean(result.error);
    } catch {
      existingError = true;
    }

    if (!existingError && existing && existing.status !== "draft") {
      redirectToCreatedListing(existing.id);
    }

    if (!existingError && existing?.status === "draft") {
      return actionState(
        submissionId,
        "This listing is already being processed. Wait a moment before trying again.",
      );
    }

    logListingFailure("draft-create", draftError?.code);
    return actionState(submissionId, genericFailureMessage);
  }

  // Refuse to continue against an out-of-date database where new rows are
  // immediately public instead of using the protected draft workflow.
  if (draft.status !== "draft") {
    const cleaned = await cleanupIncompleteListing({
      supabase,
      listingId: draft.id,
      uploadedPaths: [],
    });
    logListingFailure("draft-status");
    return actionState(
      submissionId,
      cleaned
        ? "Listing creation is being updated. Please try again in a moment."
        : "Listing creation is being updated, and cleanup is still pending. Check My Items before trying again.",
    );
  }

  return { submissionId, message: null, fieldErrors: {}, upload: { listingId, ownerId: user.id } };
}

// Called only when the browser has finished transferring files directly to the
// private bucket. Recheck identity/ownership; never trust browser MIME or sizes.
export async function createListing(
  previousState: CreateListingState,
  formData: FormData,
): Promise<CreateListingState> {
  const token = submissionTokenSchema.safeParse(formData.get("submissionToken"));
  const id = submissionTokenSchema.safeParse(formData.get("listingId"));
  const uploadedPaths = parsePrivateImagePaths(formData.get("imagePaths"));
  const submissionId = token.success ? token.data : previousState.submissionId;
  if (!token.success || !id.success || !uploadedPaths || formData.getAll("images").length) {
    return actionState(submissionId, "This upload form expired. Refresh before trying again.");
  }
  const { supabase, user } = await requireVerifiedActiveStudent("/sell");
  const listingId = id.data;
  if (uploadedPaths.some((path) => !isOwnedPrivateImagePath(path, user.id, listingId, "listing"))) {
    return actionState(submissionId, "The selected images do not belong to this listing.", { images: "Choose your listing images again." });
  }
  const { data: draft, error: draftError } = await supabase.from("listings")
    .select("id, status").eq("id", listingId).eq("seller_id", user.id)
    .eq("submission_token", token.data).maybeSingle();
  if (draftError || !draft) return actionState(submissionId, "Unable to confirm your draft. Check My Items before trying again.");
  if (draft.status === "available") redirectToCreatedListing(draft.id);
  if (draft.status !== "draft") return actionState(submissionId, "This listing can no longer be published.");

  for (const path of uploadedPaths) {
    if (!(await readPrivateImage(supabase.storage.from("listing-images"), path))) {
      const cleaned = await cleanupIncompleteListing({ supabase, listingId, uploadedPaths });
      return actionState(submissionId, cleaned ? "An uploaded image is invalid. Choose valid images and try again." : "An image could not be verified. Check My Items before trying again.",
        { images: "Use JPEG, PNG, or WebP images no larger than 5 MB with matching file contents." });
    }
  }

  const imageRows = uploadedPaths.map((storagePath, index) => ({
    listing_id: listingId,
    storage_path: storagePath,
    is_cover: index === 0,
    sort_order: index,
  }));
  let imageRowsError: { code?: string } | null = null;

  try {
    const result = await supabase.from("listing_images").insert(imageRows);
    imageRowsError = result.error;
  } catch {
    imageRowsError = { code: "network_error" };
  }

  if (imageRowsError) {
    logListingFailure("image-records", imageRowsError.code);
    // A duplicate or lost response may be another finalize request committing.
    // Do not destroy its draft or images while its outcome is uncertain.
    return actionState(
      submissionId,
      "We couldn't confirm image registration. Check My Items before submitting again.",
    );
  }

  let publishedListingId: string | null = null;
  let publishError: { code?: string } | null = null;

  try {
    const result = await supabase.rpc("publish_listing", {
      p_listing_id: listingId,
    });
    publishedListingId = typeof result.data === "string" ? result.data : null;
    publishError = result.error;
  } catch {
    publishError = { code: "network_error" };
  }

  if (publishError || publishedListingId !== listingId) {
    let reconciled: { id: string; status: string } | null = null;
    let reconcileError: { code?: string } | null = null;

    try {
      const result = await supabase
        .from("listings")
        .select("id, status")
        .eq("id", listingId)
        .maybeSingle();
      reconciled = result.data;
      reconcileError = result.error;
    } catch {
      reconcileError = { code: "network_error" };
    }

    if (!reconcileError && reconciled?.status === "available") {
      redirectToCreatedListing(reconciled.id);
    }

    logListingFailure("publish", publishError?.code);

    if (reconcileError) {
      return actionState(
        submissionId,
        "We couldn't confirm whether your listing was published. Check My Items before submitting again.",
      );
    }

    const cleaned = await cleanupIncompleteListing({
      supabase,
      listingId,
      uploadedPaths,
    });

    return actionState(
      submissionId,
      cleaned
        ? genericFailureMessage
        : "We couldn't finish publishing, and cleanup is still pending. Refresh My Items before trying again.",
    );
  }

  redirectToCreatedListing(publishedListingId);
}

export async function cancelListingUpload(listingId: string, submissionId: string, paths: string[]) {
  if (!submissionTokenSchema.safeParse(listingId).success || !submissionTokenSchema.safeParse(submissionId).success ||
    !Array.isArray(paths) || paths.length > 5 || paths.some((path) => typeof path !== "string")) return false;
  const { supabase, user } = await requireVerifiedActiveStudent("/sell");
  if (paths.some((path) => !isOwnedPrivateImagePath(path, user.id, listingId, "listing"))) return false;
  const { data: draft, error } = await supabase.from("listings").select("id, status")
    .eq("id", listingId).eq("seller_id", user.id).eq("submission_token", submissionId).maybeSingle();
  if (error || draft?.status !== "draft") return false;
  return cleanupIncompleteListing({ supabase, listingId, uploadedPaths: paths });
}
