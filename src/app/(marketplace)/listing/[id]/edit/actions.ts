"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";
import {
  getListingFieldErrors,
  listingDetailsSchema,
  MAX_LISTING_IMAGES,
  type ListingFieldErrors,
} from "@/features/listings/validation";
import { isOwnedPrivateImagePath, readPrivateImage } from "@/features/uploads/private-images";

const idSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const imageReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), value: z.string().min(1).max(500) }),
  z.object({ kind: z.literal("new"), value: idSchema }),
]);
const imageOrderSchema = z.array(imageReferenceSchema).min(1).max(MAX_LISTING_IMAGES);
const tokenListSchema = z.array(idSchema).max(MAX_LISTING_IMAGES);

export type UpdateListingState = {
  message: string | null;
  fieldErrors: ListingFieldErrors;
};

type AuthorizedSupabase = Awaited<
  ReturnType<typeof requireVerifiedActiveStudent>
>["supabase"];

function state(
  message: string,
  fieldErrors: ListingFieldErrors = {},
): UpdateListingState {
  return { message, fieldErrors };
}

function parseJson(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function logEditFailure(stage: string, code?: string) {
  console.warn("Listing edit failed", { stage, code: code ?? "unknown" });
}

async function removeObjects(supabase: AuthorizedSupabase, paths: string[]) {
  let succeeded = true;

  for (const path of paths) {
    try {
      const { error } = await supabase.storage.from("listing-images").remove([path]);
      if (error) {
        succeeded = false;
        logEditFailure("storage-cleanup", error.name);
      }
    } catch {
      succeeded = false;
      logEditFailure("storage-cleanup");
    }
  }

  return succeeded;
}

export async function prepareListingEditUpload(formData: FormData): Promise<{ ownerId?: string; message?: string }> {
  const id = idSchema.safeParse(formData.get("listingId"));
  const version = timestampSchema.safeParse(formData.get("expectedUpdatedAt"));
  if (!id.success || !version.success) return { message: "This edit form expired. Refresh before trying again." };
  const { supabase, user } = await requireVerifiedActiveStudent(`/listing/${id.data}/edit`);
  const { data, error } = await supabase.from("listings").select("status, updated_at")
    .eq("id", id.data).eq("seller_id", user.id).maybeSingle();
  if (error || !data || !["available", "reserved"].includes(data.status) || data.updated_at !== version.data) {
    return { message: "This listing is unavailable or has changed. Refresh before editing again." };
  }
  return { ownerId: user.id };
}

export async function updateListing(
  _previousState: UpdateListingState,
  formData: FormData,
): Promise<UpdateListingState> {
  const listingId = idSchema.safeParse(formData.get("listingId"));
  const expectedUpdatedAt = timestampSchema.safeParse(
    formData.get("expectedUpdatedAt"),
  );
  const details = listingDetailsSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    categoryId: formData.get("categoryId"),
    price: formData.get("price"),
    condition: formData.get("condition"),
  });
  const imageOrder = imageOrderSchema.safeParse(
    parseJson(formData.get("imageOrder")),
  );
  const newImageTokens = tokenListSchema.safeParse(
    parseJson(formData.get("newImageTokens")),
  );
  const newPaths = z.array(z.string().min(1).max(160)).max(MAX_LISTING_IMAGES).safeParse(
    parseJson(formData.get("newImagePaths")),
  );

  if (!listingId.success || !expectedUpdatedAt.success) {
    return state("This edit form expired. Refresh the page and try again.");
  }

  if (!details.success) {
    return state(
      "Check the highlighted fields and try again.",
      getListingFieldErrors(details.error),
    );
  }

  if (!imageOrder.success || !newImageTokens.success || !newPaths.success || formData.getAll("newImages").length) {
    return state("Choose between one and five valid listing images.", {
      images: "Keep at least one image and use no more than five.",
    });
  }

  const orderedKeys = imageOrder.data.map((reference) =>
    `${reference.kind}:${reference.value}`,
  );
  if (new Set(orderedKeys).size !== orderedKeys.length) {
    return state("The image order contains a duplicate.", {
      images: "Remove duplicate images and try again.",
    });
  }

  const orderedNewTokens = imageOrder.data
    .filter((reference) => reference.kind === "new")
    .map((reference) => reference.value);
  if (
    newPaths.data.length !== newImageTokens.data.length ||
    new Set(newPaths.data).size !== newPaths.data.length ||
    orderedNewTokens.length !== newImageTokens.data.length ||
    orderedNewTokens.some((token) => !newImageTokens.data.includes(token)) ||
    new Set(newImageTokens.data).size !== newImageTokens.data.length
  ) {
    return state("The selected images could not be matched. Choose them again.", {
      images: "Remove and re-add the new images.",
    });
  }

  const { supabase, user } = await requireVerifiedActiveStudent(
    `/listing/${listingId.data}/edit`,
  );
  const uploadedPaths = newPaths.data;
  if (uploadedPaths.some((path) => !isOwnedPrivateImagePath(path, user.id, listingId.data, "listing"))) {
    return state("New images must belong to this listing.", { images: "Choose the new images again." });
  }
  const { data: currentListing, error: listingError } = await supabase
    .from("listings")
    .select("id, status, updated_at, listing_images(storage_path)")
    .eq("id", listingId.data)
    .eq("seller_id", user.id)
    .maybeSingle();

  if (listingError) {
    logEditFailure("listing-check", listingError.code);
    return state("Unable to verify your listing. Please try again.");
  }
  if (!currentListing) return state("You are not allowed to modify this listing.");
  if (!['available', 'reserved'].includes(String(currentListing.status))) {
    await removeObjects(supabase, uploadedPaths);
    return state("This listing can no longer be edited.");
  }
  if (String(currentListing.updated_at) !== expectedUpdatedAt.data) {
    await removeObjects(supabase, uploadedPaths);
    return state("This listing changed after you opened the form. Refresh before editing again.");
  }

  const existingPaths = new Set(
    (currentListing.listing_images ?? []).flatMap((image) =>
      typeof image.storage_path === "string" ? [image.storage_path] : [],
    ),
  );
  const submittedExistingPaths = imageOrder.data
    .filter((reference) => reference.kind === "existing")
    .map((reference) => reference.value);
  if (submittedExistingPaths.some((path) => !existingPaths.has(path))) {
    await removeObjects(supabase, uploadedPaths);
    return state("One of the existing images is no longer available. Refresh the page.", {
      images: "Refresh before changing the image order.",
    });
  }

  const { data: category, error: categoryError } = await supabase
    .from("categories")
    .select("id")
    .eq("id", details.data.categoryId)
    .eq("is_active", true)
    .maybeSingle();
  if (categoryError || !category) {
    if (categoryError) logEditFailure("category-check", categoryError.code);
    await removeObjects(supabase, uploadedPaths);
    return state("Select an available category.", {
      categoryId: "Select an active category.",
    });
  }

  const pathByToken = new Map<string, string>();
  for (const [index, path] of uploadedPaths.entries()) {
    const token = newImageTokens.data[index];
    if (!(await readPrivateImage(supabase.storage.from("listing-images"), path))) {
      await removeObjects(supabase, uploadedPaths);
      return state("An uploaded image could not be verified. Choose it again.", {
        images: "Use JPEG, PNG, or WebP images no larger than 5 MB with matching file contents.",
      });
    }
    pathByToken.set(token, path);
  }

  const finalPaths = imageOrder.data.map((reference) =>
    reference.kind === "existing"
      ? reference.value
      : (pathByToken.get(reference.value) ?? ""),
  );

  const { data: updateResult, error: updateError } = await supabase.rpc(
    "update_owned_listing",
    {
      p_listing_id: listingId.data,
      p_expected_updated_at: expectedUpdatedAt.data,
      p_title: details.data.title,
      p_description: details.data.description,
      p_category_id: details.data.categoryId,
      p_price: Number(details.data.price),
      p_condition: details.data.condition,
      p_image_paths: finalPaths,
    },
  );

  if (updateError || !updateResult || typeof updateResult !== "object") {
    logEditFailure("database-update", updateError?.code);
    // Never delete images on an ambiguous network outcome: the transactional
    // edit may already have committed. Only definite SQL rejections are safe.
    const definiteRejection = ["PT409", "40001", "22023", "23505", "23514", "42501", "P0001", "P0002"].includes(updateError?.code ?? "");
    if (definiteRejection) await removeObjects(supabase, uploadedPaths);
    return state(
      ["PT409", "40001"].includes(updateError?.code ?? "")
        ? "This listing changed while you were editing. Refresh and review the latest version."
        : definiteRejection ? "Unable to update your listing. Please try again." : "We couldn't confirm the edit. Refresh your listing before trying again.",
    );
  }

  const removedPaths = Array.isArray((updateResult as { removedPaths?: unknown }).removedPaths)
    ? (updateResult as { removedPaths: unknown[] }).removedPaths.filter(
        (path): path is string => typeof path === "string",
      )
    : [];
  if (!(await removeObjects(supabase, removedPaths))) {
    logEditFailure("removed-object-cleanup");
  }

  revalidatePath("/marketplace");
  revalidatePath("/my-listings");
  revalidatePath("/favorites");
  revalidatePath(`/listing/${listingId.data}`);
  redirect(`/listing/${listingId.data}?updated=1`);
}
