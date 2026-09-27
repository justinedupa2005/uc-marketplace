"use client";

import Image from "next/image";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";

import { FormNotification } from "@/components/form-notification";
import { NavigationLink as Link } from "@/components/navigation-blocker";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChangesWarning } from "@/features/listings/client/use-unsaved-changes-warning";
import { ListingFormSection } from "@/features/listings/components/listing-form-section";
import type {
  ListingCategoryOption,
  OwnedListingForEdit,
} from "@/features/listings/types";
import {
  getListingFieldErrors,
  LISTING_CONDITION_OPTIONS,
  LISTING_DESCRIPTION_MAX_LENGTH,
  LISTING_DESCRIPTION_MIN_LENGTH,
  LISTING_FIELD_ORDER,
  LISTING_PRICE_MAX_PHP,
  LISTING_TITLE_MAX_LENGTH,
  LISTING_TITLE_MIN_LENGTH,
  listingDetailsSchema,
  MAX_LISTING_IMAGES,
  type ListingCondition,
  type ListingField,
  type ListingFieldErrors,
} from "@/features/listings/validation";

import { updateListing, type UpdateListingState } from "./actions";
import { useEditableListingImages } from "./_hooks/use-editable-listing-images";

const fieldIds: Record<ListingField, string> = {
  images: "edit-listing-images-section",
  title: "edit-title",
  categoryId: "edit-category",
  description: "edit-description",
  condition: "edit-condition",
  price: "edit-price",
};

function focusListingField(field: ListingField) {
  window.requestAnimationFrame(() => {
    const element = document.getElementById(fieldIds[field]);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

type DismissedServerFeedback = {
  state: UpdateListingState;
  fields: ListingField[];
};

export function EditListingForm({
  listing,
  categories,
  categoryLoadError,
}: {
  listing: OwnedListingForEdit;
  categories: ListingCategoryOption[];
  categoryLoadError: boolean;
}) {
  const initialState: UpdateListingState = { message: null, fieldErrors: {} };
  const [actionState, formAction, pending] = useActionState(updateListing, initialState);
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description);
  const [categoryId, setCategoryId] = useState(listing.categoryId);
  const [price, setPrice] = useState(listing.price);
  const [condition, setCondition] = useState<ListingCondition>(listing.condition as ListingCondition);
  const [clientErrors, setClientErrors] = useState<ListingFieldErrors>({});
  const [dismissedServerFeedback, setDismissedServerFeedback] =
    useState<DismissedServerFeedback | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const previousActionStateRef = useRef(actionState);
  const serverNotificationRef = useRef<HTMLDivElement>(null);
  const dismissedServerFields =
    dismissedServerFeedback?.state === actionState
      ? new Set(dismissedServerFeedback.fields)
      : null;
  const showServerFeedback = dismissedServerFeedback?.state !== actionState;
  const serverFieldErrors: ListingFieldErrors = { ...actionState.fieldErrors };
  dismissedServerFields?.forEach((field) => delete serverFieldErrors[field]);
  const fieldErrors = { ...serverFieldErrors, ...clientErrors };
  const {
    images,
    selectionErrors: imageSelectionErrors,
    chooseImages,
    removeImage,
    moveImage,
    appendImagesTo,
  } = useEditableListingImages(listing.images, () => edited("images"));

  useUnsavedChangesWarning(isDirty);

  useEffect(() => {
    if (previousActionStateRef.current === actionState) return;

    previousActionStateRef.current = actionState;
    const firstInvalidField = LISTING_FIELD_ORDER.find(
      (field) => actionState.fieldErrors[field],
    );
    if (firstInvalidField) {
      focusListingField(firstInvalidField);
      return;
    }
    if (actionState.message) {
      window.requestAnimationFrame(() => {
        serverNotificationRef.current?.focus({ preventScroll: true });
        serverNotificationRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    }
  }, [actionState]);

  function dismissServerFields(fields: readonly ListingField[]) {
    setDismissedServerFeedback((current) => {
      const currentFields =
        current?.state === actionState ? current.fields : [];
      const nextFields = [...new Set([...currentFields, ...fields])];

      if (
        current?.state === actionState &&
        nextFields.length === currentFields.length
      ) {
        return current;
      }
      return { state: actionState, fields: nextFields };
    });
  }

  function edited(field: ListingField) {
    setIsDirty(true);
    dismissServerFields([field]);
    setClientErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
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
      dismissServerFields(LISTING_FIELD_ORDER);
      const firstInvalidField = LISTING_FIELD_ORDER.find(
        (field) => nextErrors[field],
      );
      if (firstInvalidField) focusListingField(firstInvalidField);
      return;
    }

    appendImagesTo(formData);
    setClientErrors({});
    startTransition(() => formAction(formData));
  }

  return (
    <form action={submit} noValidate aria-busy={pending} className="mt-8 space-y-7">
      <input type="hidden" name="listingId" value={listing.id} />
      <input type="hidden" name="expectedUpdatedAt" value={listing.updatedAt} />

      {showServerFeedback && actionState.message && (
        <div
          ref={serverNotificationRef}
          tabIndex={-1}
          className="rounded-md outline-none focus:ring-2 focus:ring-[#0038a8]/30"
        >
          <FormNotification variant="error">{actionState.message}</FormNotification>
        </div>
      )}
      {categoryLoadError && (
        <FormNotification variant="error">
          Categories could not be loaded. Refresh this page before saving your
          changes.
        </FormNotification>
      )}

      <ListingFormSection
        id="edit-listing-images-section"
        title="Listing images"
        description="Keep, remove, add, or reorder up to five images. The first image is the cover."
        contentClassName="mt-5"
      >
        <div className="flex items-center justify-between gap-4">
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
          aria-invalid={Boolean(fieldErrors.images)}
          aria-describedby={fieldErrors.images ? "edit-images-error" : undefined}
          className="sr-only"
        />
        <FieldError id="edit-images-error" message={fieldErrors.images} />
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
      </ListingFormSection>

      <ListingFormSection id="edit-listing-details" title="Item details">
        <div className="space-y-5">
          <div>
            <label htmlFor="edit-title" className="text-sm font-semibold">Title</label>
            <Input id="edit-title" name="title" value={title} minLength={LISTING_TITLE_MIN_LENGTH} maxLength={LISTING_TITLE_MAX_LENGTH} required disabled={pending} invalid={Boolean(fieldErrors.title)} aria-describedby={fieldErrors.title ? "edit-title-error" : undefined} onChange={(event) => { setTitle(event.target.value); edited("title"); }} className="mt-2" />
            <FieldError id="edit-title-error" message={fieldErrors.title} />
          </div>
          <div>
            <label htmlFor="edit-category" className="text-sm font-semibold">Category</label>
            <Select id="edit-category" name="categoryId" value={categoryId} required disabled={pending || categoryLoadError} invalid={Boolean(fieldErrors.categoryId)} aria-describedby={fieldErrors.categoryId ? "edit-category-error" : undefined} onChange={(event) => { setCategoryId(event.target.value); edited("categoryId"); }} className="mt-2">
              <option value="">Select a category</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
            <FieldError id="edit-category-error" message={fieldErrors.categoryId} />
          </div>
          <div>
            <label htmlFor="edit-description" className="text-sm font-semibold">Description</label>
            <Textarea id="edit-description" name="description" value={description} minLength={LISTING_DESCRIPTION_MIN_LENGTH} maxLength={LISTING_DESCRIPTION_MAX_LENGTH} rows={6} required disabled={pending} invalid={Boolean(fieldErrors.description)} aria-describedby={fieldErrors.description ? "edit-description-error" : undefined} onChange={(event) => { setDescription(event.target.value); edited("description"); }} className="mt-2" />
            <FieldError id="edit-description-error" message={fieldErrors.description} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="edit-condition" className="text-sm font-semibold">Condition</label>
              <Select id="edit-condition" name="condition" value={condition} required disabled={pending} invalid={Boolean(fieldErrors.condition)} aria-describedby={fieldErrors.condition ? "edit-condition-error" : undefined} onChange={(event) => { setCondition(event.target.value as ListingCondition); edited("condition"); }} className="mt-2">
                {LISTING_CONDITION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
              <FieldError id="edit-condition-error" message={fieldErrors.condition} />
            </div>
            <div>
              <label htmlFor="edit-price" className="text-sm font-semibold">Price (PHP)</label>
              <Input id="edit-price" name="price" type="number" inputMode="decimal" min="0" step="0.01" value={price} required disabled={pending} max={LISTING_PRICE_MAX_PHP} invalid={Boolean(fieldErrors.price)} aria-describedby={fieldErrors.price ? "edit-price-error" : undefined} onChange={(event) => { setPrice(event.target.value); edited("price"); }} className="mt-2" />
              <FieldError id="edit-price-error" message={fieldErrors.price} />
            </div>
          </div>
        </div>
      </ListingFormSection>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link
          href={`/listing/${listing.id}`}
          className="inline-flex min-h-12 items-center justify-center rounded-md border border-[#c4c5d5] px-5 text-sm font-semibold text-[#444653] hover:bg-white"
        >
          Cancel
        </Link>
        <button type="submit" disabled={pending || categoryLoadError} className="min-h-12 rounded-md bg-[#0038a8] px-6 text-sm font-semibold text-white hover:bg-[#002576] disabled:cursor-wait disabled:opacity-60">{pending ? "Saving changes…" : "Save Changes"}</button>
      </div>
    </form>
  );
}
