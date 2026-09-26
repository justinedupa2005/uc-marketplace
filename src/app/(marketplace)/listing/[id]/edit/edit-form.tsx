"use client";

import Image from "next/image";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { FormNotification } from "@/components/form-notification";
import type { OwnedListingForEdit } from "@/lib/listings";
import {
  getListingFieldErrors,
  LISTING_CONDITION_OPTIONS,
  LISTING_DESCRIPTION_MAX_LENGTH,
  LISTING_PRICE_MAX_PHP,
  LISTING_TITLE_MAX_LENGTH,
  listingDetailsSchema,
  listingImageSchema,
  MAX_LISTING_IMAGES,
  type ListingCondition,
  type ListingFieldErrors,
} from "@/lib/validations/listing";

import { updateListing, type UpdateListingState } from "./actions";

export type EditCategory = { id: string; name: string };

type ExistingImage = {
  kind: "existing";
  key: string;
  storagePath: string;
  previewUrl: string;
  alt: string;
};

type NewImage = {
  kind: "new";
  key: string;
  token: string;
  file: File;
  previewUrl: string;
  alt: string;
};

type EditableImage = ExistingImage | NewImage;

const inputClass =
  "h-12 w-full rounded-md border border-[#c4c5d5] bg-white px-4 text-base text-[#121c2a] outline-none transition placeholder:text-[#747685] focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]";

function FieldError({ message }: { message?: string }) {
  return message ? <p role="alert" className="mt-2 text-sm text-red-700">{message}</p> : null;
}

export function EditListingForm({
  listing,
  categories,
  categoryLoadError,
}: {
  listing: OwnedListingForEdit;
  categories: EditCategory[];
  categoryLoadError: boolean;
}) {
  const initialState: UpdateListingState = { message: null, fieldErrors: {} };
  const [actionState, formAction, pending] = useActionState(updateListing, initialState);
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [categoryId, setCategoryId] = useState(listing.categoryId);
  const [price, setPrice] = useState(listing.price);
  const [condition, setCondition] = useState<ListingCondition>(listing.condition as ListingCondition);
  const [images, setImages] = useState<EditableImage[]>(
    listing.images.map((image) => ({
      kind: "existing",
      key: `existing:${image.storagePath}`,
      storagePath: image.storagePath,
      previewUrl: image.src,
      alt: image.alt,
    })),
  );
  const [clientErrors, setClientErrors] = useState<ListingFieldErrors>({});
  const [imageSelectionErrors, setImageSelectionErrors] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const previewUrls = useRef(new Set<string>());
  const fieldErrors = { ...actionState.fieldErrors, ...clientErrors };

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (!isDirty || pending) return;
    function preventExit(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", preventExit);
    return () => window.removeEventListener("beforeunload", preventExit);
  }, [isDirty, pending]);

  function edited(field?: keyof ListingFieldErrors) {
    setIsDirty(true);
    if (field) {
      setClientErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
  }

  function chooseImages(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    const next = [...images];
    const errors: string[] = [];

    for (const file of files) {
      if (next.length >= MAX_LISTING_IMAGES) {
        errors.push(`You can keep a maximum of ${MAX_LISTING_IMAGES} images.`);
        break;
      }
      const validation = listingImageSchema.safeParse(file);
      if (!validation.success) {
        errors.push(`${file.name}: ${validation.error.issues[0]?.message ?? "Invalid image."}`);
        continue;
      }
      const duplicate = next.some(
        (image) => image.kind === "new" && image.file.name === file.name && image.file.size === file.size,
      );
      if (duplicate) {
        errors.push(`${file.name} is already selected.`);
        continue;
      }

      const previewUrl = URL.createObjectURL(file);
      const token = crypto.randomUUID();
      previewUrls.current.add(previewUrl);
      next.push({
        kind: "new",
        key: `new:${token}`,
        token,
        file,
        previewUrl,
        alt: file.name,
      });
    }

    setImages(next);
    setImageSelectionErrors(errors);
    edited("images");
  }

  function removeImage(key: string) {
    setImages((current) => {
      const removed = current.find((image) => image.key === key);
      if (removed?.kind === "new") {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrls.current.delete(removed.previewUrl);
      }
      return current.filter((image) => image.key !== key);
    });
    setImageSelectionErrors([]);
    edited("images");
  }

  function moveImage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    setImages((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    edited("images");
  }

  function submit(formData: FormData) {
    const detailValidation = listingDetailsSchema.safeParse({
      title: formData.get("title"),
      description: formData.get("description"),
      categoryId: formData.get("categoryId"),
      price: formData.get("price"),
      condition: formData.get("condition"),
    });
    const nextErrors: ListingFieldErrors = detailValidation.success
      ? {}
      : getListingFieldErrors(detailValidation.error);

    if (images.length < 1 || images.length > MAX_LISTING_IMAGES) {
      nextErrors.images = `Keep between 1 and ${MAX_LISTING_IMAGES} images.`;
    }
    if (Object.keys(nextErrors).length > 0) {
      setClientErrors(nextErrors);
      return;
    }

    const newImages = images.filter((image): image is NewImage => image.kind === "new");
    formData.set(
      "imageOrder",
      JSON.stringify(
        images.map((image) =>
          image.kind === "existing"
            ? { kind: "existing", value: image.storagePath }
            : { kind: "new", value: image.token },
        ),
      ),
    );
    formData.set("newImageTokens", JSON.stringify(newImages.map((image) => image.token)));
    formData.delete("newImages");
    newImages.forEach((image) => formData.append("newImages", image.file, image.file.name));
    setClientErrors({});
    startTransition(() => formAction(formData));
  }

  return (
    <form action={submit} noValidate aria-busy={pending} className="mt-8 space-y-7">
      <input type="hidden" name="listingId" value={listing.id} />
      <input type="hidden" name="expectedUpdatedAt" value={listing.updatedAt} />

      {actionState.message && <FormNotification variant="error">{actionState.message}</FormNotification>}
      {categoryLoadError && (
        <FormNotification variant="error">
          Categories could not be loaded. Refresh this page before saving your
          changes.
        </FormNotification>
      )}

      <section className="rounded-xl border border-[#c4c5d5]/60 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-xl font-bold">Listing images</h2>
        <p className="mt-1 text-sm text-[#5b6070]">Keep, remove, add, or reorder up to five images. The first image is the cover.</p>

        <div className="mt-5 flex items-center justify-between gap-4">
          <label htmlFor="edit-listing-images" className={`inline-flex min-h-11 items-center rounded-md border border-[#0038a8] px-4 text-sm font-semibold text-[#0038a8] ${images.length >= MAX_LISTING_IMAGES || pending ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-[#e9effb]"}`}>
            Add images
          </label>
          <span className="text-sm font-semibold">{images.length} / {MAX_LISTING_IMAGES}</span>
        </div>
        <input
          id="edit-listing-images"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={pending || images.length >= MAX_LISTING_IMAGES}
          onChange={chooseImages}
          className="sr-only"
        />
        <FieldError message={fieldErrors.images} />
        {imageSelectionErrors.length > 0 && (
          <ul role="alert" className="mt-3 list-disc rounded-md bg-amber-50 px-8 py-3 text-sm text-amber-900">
            {imageSelectionErrors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        )}

        <ul aria-label="Listing image order" className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image, index) => (
            <li key={image.key} className="overflow-hidden rounded-lg border border-[#c4c5d5] bg-[#eff3ff]">
              <div className="relative aspect-square">
                <Image src={image.previewUrl} alt={image.alt} fill unoptimized sizes="(max-width: 639px) 50vw, 220px" className="object-cover" />
                {index === 0 && <span className="absolute left-2 top-2 rounded-full bg-[#002576] px-2 py-1 text-[11px] font-bold text-white">Cover</span>}
              </div>
              <div className="grid grid-cols-3 gap-1 p-2">
                <button type="button" disabled={pending || index === 0} onClick={() => moveImage(index, -1)} aria-label={`Move image ${index + 1} left`} className="min-h-9 rounded bg-white text-sm font-semibold disabled:opacity-40">←</button>
                <button type="button" disabled={pending || index === images.length - 1} onClick={() => moveImage(index, 1)} aria-label={`Move image ${index + 1} right`} className="min-h-9 rounded bg-white text-sm font-semibold disabled:opacity-40">→</button>
                <button type="button" disabled={pending} onClick={() => removeImage(image.key)} aria-label={`Remove image ${index + 1}`} className="min-h-9 rounded bg-white text-sm font-semibold text-red-700 disabled:opacity-40">×</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-[#c4c5d5]/60 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-xl font-bold">Item details</h2>
        <div className="mt-6 space-y-5">
          <div>
            <label htmlFor="edit-title" className="text-sm font-semibold">Title</label>
            <input id="edit-title" name="title" value={title} maxLength={LISTING_TITLE_MAX_LENGTH} disabled={pending} onChange={(event) => { setTitle(event.target.value); edited("title"); }} className={`mt-2 ${inputClass}`} />
            <FieldError message={fieldErrors.title} />
          </div>
          <div>
            <label htmlFor="edit-category" className="text-sm font-semibold">Category</label>
            <select id="edit-category" name="categoryId" value={categoryId} disabled={pending || categoryLoadError} onChange={(event) => { setCategoryId(event.target.value); edited("categoryId"); }} className={`mt-2 ${inputClass}`}>
              <option value="">Select a category</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <FieldError message={fieldErrors.categoryId} />
          </div>
          <div>
            <label htmlFor="edit-description" className="text-sm font-semibold">Description</label>
            <textarea id="edit-description" name="description" value={description} maxLength={LISTING_DESCRIPTION_MAX_LENGTH} rows={6} disabled={pending} onChange={(event) => { setDescription(event.target.value); edited("description"); }} className="mt-2 w-full resize-y rounded-md border border-[#c4c5d5] bg-white p-4 outline-none focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15" />
            <FieldError message={fieldErrors.description} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="edit-condition" className="text-sm font-semibold">Condition</label>
              <select id="edit-condition" name="condition" value={condition} disabled={pending} onChange={(event) => { setCondition(event.target.value as ListingCondition); edited("condition"); }} className={`mt-2 ${inputClass}`}>
                {LISTING_CONDITION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <FieldError message={fieldErrors.condition} />
            </div>
            <div>
              <label htmlFor="edit-price" className="text-sm font-semibold">Price (PHP)</label>
              <input id="edit-price" name="price" type="number" inputMode="decimal" min="0" step="0.01" value={price} disabled={pending} max={LISTING_PRICE_MAX_PHP} onChange={(event) => { setPrice(event.target.value); edited("price"); }} className={`mt-2 ${inputClass}`} />
              <FieldError message={fieldErrors.price} />
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link href={`/listing/${listing.id}`} className="inline-flex min-h-12 items-center justify-center rounded-md border border-[#c4c5d5] px-5 text-sm font-semibold text-[#444653] hover:bg-white">Cancel</Link>
        <button type="submit" disabled={pending || categoryLoadError} className="min-h-12 rounded-md bg-[#0038a8] px-6 text-sm font-semibold text-white hover:bg-[#002576] disabled:cursor-wait disabled:opacity-60">{pending ? "Saving changes…" : "Save Changes"}</button>
      </div>
    </form>
  );
}
