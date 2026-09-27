"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { FormNotification } from "@/components/form-notification";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChangesWarning } from "@/features/listings/client/use-unsaved-changes-warning";
import { ListingFormSection as FormSection } from "@/features/listings/components/listing-form-section";
import type { ListingCategoryOption } from "@/features/listings/types";
import {
  getListingFieldErrors,
  LISTING_CONDITION_OPTIONS,
  LISTING_DESCRIPTION_MAX_LENGTH,
  LISTING_FIELD_ORDER,
  LISTING_PRICE_MAX_PHP,
  LISTING_TITLE_MAX_LENGTH,
  listingFormSchema,
  type ListingCondition,
  type ListingField,
  type ListingFieldErrors,
} from "@/features/listings/validation";

import { createListing, type CreateListingState } from "./actions";
import { SellImagesSection } from "./_components/sell-images-section";
import { useSellImages } from "./_hooks/use-sell-images";

type SellFormProps = {
  categories: ListingCategoryOption[];
  categoryLoadError: boolean;
  submissionId: string;
};

type DismissedServerFeedback = {
  state: CreateListingState;
  fields: ListingField[];
};

const fieldIds: Record<ListingField, string> = {
  images: "product-images",
  title: "listing-title",
  categoryId: "listing-category",
  description: "listing-description",
  condition: "listing-condition-new",
  price: "listing-price",
};

const priceFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

function focusListingField(field: ListingField) {
  window.requestAnimationFrame(() => {
    const element = document.getElementById(fieldIds[field]);

    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

export function SellForm({
  categories,
  categoryLoadError,
  submissionId,
}: SellFormProps) {
  const router = useRouter();
  const [retryPending, startRetryTransition] = useTransition();
  const initialState: CreateListingState = {
    message: null,
    fieldErrors: {},
    submissionId,
  };
  const [state, formAction, pending] = useActionState(
    createListing,
    initialState,
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState<ListingCondition | "">("");
  const [clientFieldErrors, setClientFieldErrors] =
    useState<ListingFieldErrors>({});
  const [dismissedServerFeedback, setDismissedServerFeedback] =
    useState<DismissedServerFeedback | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const previousActionStateRef = useRef(state);
  const dismissedServerFields =
    dismissedServerFeedback?.state === state
      ? new Set(dismissedServerFeedback.fields)
      : null;
  const showServerFeedback = dismissedServerFeedback?.state !== state;
  const categoriesAvailable = !categoryLoadError && categories.length > 0;
  const serverFieldErrors: ListingFieldErrors = { ...state.fieldErrors };
  dismissedServerFields?.forEach((field) => delete serverFieldErrors[field]);
  const fieldErrors = { ...serverFieldErrors, ...clientFieldErrors };
  const {
    images: selectedImages,
    selectionErrors: imageSelectionErrors,
    chooseImages,
    removeImage,
    appendImagesTo,
    clearImages,
    clearSelectionErrors: clearImageSelectionErrors,
  } = useSellImages(() => markFieldEdited("images"));

  const selectedCategory = categories.find(
    (category) => category.id === categoryId,
  );
  const selectedCondition = LISTING_CONDITION_OPTIONS.find(
    (option) => option.value === condition,
  );
  const formattedPrice = useMemo(() => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(price) || Number(price) < 0) {
      return "Not set";
    }

    return priceFormatter.format(Number(price));
  }, [price]);
  const isDirty = Boolean(
    title ||
      description ||
      categoryId ||
      price ||
      condition ||
      selectedImages.length,
  );

  useEffect(() => {
    if (previousActionStateRef.current === state) {
      return;
    }

    previousActionStateRef.current = state;
    const firstInvalidField = LISTING_FIELD_ORDER.find(
      (field) => state.fieldErrors[field],
    );

    if (firstInvalidField) {
      focusListingField(firstInvalidField);
    }
  }, [state]);

  useUnsavedChangesWarning(isDirty);

  function dismissServerFields(fields: readonly ListingField[]) {
    setDismissedServerFeedback((current) => {
      const currentFields = current?.state === state ? current.fields : [];
      const nextFields = [...new Set([...currentFields, ...fields])];

      if (current?.state === state && nextFields.length === currentFields.length) {
        return current;
      }
      return { state, fields: nextFields };
    });
  }

  function markFieldEdited(field: ListingField) {
    dismissServerFields([field]);
    setClientFieldErrors((currentErrors) => {
      if (!currentErrors[field]) {
        return currentErrors;
      }

      const nextErrors = { ...currentErrors };
      delete nextErrors[field];
      return nextErrors;
    });
  }

  function handleFormAction(formData: FormData) {
    appendImagesTo(formData);

    const validation = listingFormSchema.safeParse({
      title: formData.get("title"),
      description: formData.get("description"),
      categoryId: formData.get("categoryId"),
      price: formData.get("price"),
      condition: formData.get("condition"),
      images: selectedImages.map(({ file }) => file),
    });

    if (!validation.success) {
      const validationErrors = getListingFieldErrors(validation.error);
      setClientFieldErrors(validationErrors);
      dismissServerFields(LISTING_FIELD_ORDER);

      const firstInvalidField = LISTING_FIELD_ORDER.find(
        (field) => validationErrors[field],
      );
      if (firstInvalidField) {
        focusListingField(firstInvalidField);
      }
      return;
    }

    setClientFieldErrors({});
    clearImageSelectionErrors();
    startTransition(() => formAction(formData));
  }

  function clearForm() {
    if (isDirty && !window.confirm("Clear all listing information and images?")) {
      return;
    }

    clearImages();
    formRef.current?.reset();
    setTitle("");
    setDescription("");
    setCategoryId("");
    setPrice("");
    setCondition("");
    setClientFieldErrors({});
    dismissServerFields(LISTING_FIELD_ORDER);
  }

  return (
    <form
      ref={formRef}
      action={handleFormAction}
      noValidate
      aria-busy={pending}
      className="mt-8 space-y-7"
    >
      <input
        type="hidden"
        name="submissionToken"
        value={state.submissionId || submissionId}
      />

      <SellImagesSection
        images={selectedImages}
        selectionErrors={imageSelectionErrors}
        fieldError={fieldErrors.images}
        pending={pending}
        onChooseImages={chooseImages}
        onRemoveImage={removeImage}
      />
      <FormSection
        id="product-information"
        step={2}
        title="Product Information"
        description="Tell buyers what the item is and describe its current condition honestly."
      >
        <div className="space-y-6">
          <div>
            <div className="mb-2 flex items-end justify-between gap-4">
              <label htmlFor="listing-title" className="text-sm font-semibold">
                Product Title <span aria-hidden="true" className="text-[#ba1a1a]">*</span>
              </label>
              <span className="text-xs text-[#5b6070]">
                {LISTING_TITLE_MAX_LENGTH - title.length} characters remaining
              </span>
            </div>
            <Input
              id="listing-title"
              name="title"
              type="text"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                markFieldEdited("title");
              }}
              minLength={5}
              maxLength={LISTING_TITLE_MAX_LENGTH}
              required
              disabled={pending}
              autoComplete="off"
              placeholder="e.g. Calculus 8th Edition"
              invalid={Boolean(fieldErrors.title)}
              aria-describedby={fieldErrors.title ? "listing-title-error" : undefined}
            />
            <FieldError id="listing-title-error" message={fieldErrors.title} />
          </div>

          <div>
            <label htmlFor="listing-category" className="mb-2 block text-sm font-semibold">
              Category <span aria-hidden="true" className="text-[#ba1a1a]">*</span>
            </label>
            <div className="relative">
              <Select
                id="listing-category"
                name="categoryId"
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  markFieldEdited("categoryId");
                }}
                required
                disabled={pending || !categoriesAvailable}
                invalid={Boolean(fieldErrors.categoryId)}
                aria-describedby={
                  fieldErrors.categoryId ? "listing-category-error" : undefined
                }
                className="appearance-none pr-11"
              >
                <option value="">Select a category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
              <Image
                src="/assets/app/dropdown.svg"
                alt=""
                width={24}
                height={24}
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
              />
            </div>
            <FieldError id="listing-category-error" message={fieldErrors.categoryId} />

            {categoryLoadError && (
              <div
                role="alert"
                className="mt-3 flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between"
              >
                <p>Categories could not be loaded. Try again before publishing.</p>
                <button
                  type="button"
                  disabled={retryPending}
                  onClick={() => startRetryTransition(() => router.refresh())}
                  className="min-h-10 shrink-0 rounded-md border border-red-300 bg-white px-4 font-semibold text-red-800 hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
                >
                  {retryPending ? "Retrying..." : "Retry"}
                </button>
              </div>
            )}

            {!categoryLoadError && categories.length === 0 && (
              <p
                role="status"
                className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
              >
                No active categories are available. Listing publication is temporarily disabled.
              </p>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-end justify-between gap-4">
              <label htmlFor="listing-description" className="text-sm font-semibold">
                Description <span aria-hidden="true" className="text-[#ba1a1a]">*</span>
              </label>
              <span className="text-xs text-[#5b6070]">
                {LISTING_DESCRIPTION_MAX_LENGTH - description.length} characters remaining
              </span>
            </div>
            <Textarea
              id="listing-description"
              name="description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                markFieldEdited("description");
              }}
              rows={6}
              minLength={10}
              maxLength={LISTING_DESCRIPTION_MAX_LENGTH}
              required
              disabled={pending}
              placeholder="Describe the item's condition, features, included accessories, and any flaws."
              invalid={Boolean(fieldErrors.description)}
              aria-describedby={
                fieldErrors.description
                  ? "listing-description-help listing-description-error"
                  : "listing-description-help"
              }
              className="leading-6"
            />
            <p id="listing-description-help" className="mt-2 text-xs leading-5 text-[#5b6070]">
              Include important details that help another student decide whether the item is right for them.
            </p>
            <FieldError id="listing-description-error" message={fieldErrors.description} />
          </div>

          <fieldset
            aria-describedby={fieldErrors.condition ? "listing-condition-error" : undefined}
          >
            <legend className="text-sm font-semibold">
              Condition <span aria-hidden="true" className="text-[#ba1a1a]">*</span>
            </legend>
            <div
              role="radiogroup"
              aria-invalid={Boolean(fieldErrors.condition)}
              className="mt-3 grid gap-3 sm:grid-cols-2"
            >
              {LISTING_CONDITION_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition focus-within:ring-2 focus-within:ring-[#0038a8]/20 ${
                    condition === option.value
                      ? "border-[#0038a8] bg-[#eef3ff]"
                      : "border-[#c4c5d5] bg-white hover:border-[#8098c9]"
                  } ${pending ? "cursor-wait opacity-60" : ""}`}
                >
                  <input
                    id={`listing-condition-${option.value}`}
                    type="radio"
                    name="condition"
                    value={option.value}
                    checked={condition === option.value}
                    onChange={() => {
                      setCondition(option.value);
                      markFieldEdited("condition");
                    }}
                    required
                    disabled={pending}
                    className="mt-1 size-4 shrink-0 accent-[#0038a8]"
                  />
                  <span>
                    <span className="block text-sm font-bold text-[#121c2a]">
                      {option.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[#5b6070]">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <FieldError id="listing-condition-error" message={fieldErrors.condition} />
          </fieldset>
        </div>
      </FormSection>

      <FormSection
        id="product-pricing"
        step={3}
        title="Pricing"
        description="Set a fair price in Philippine pesos. Payment is arranged directly with the buyer."
      >
        <div className="max-w-md">
          <label htmlFor="listing-price" className="mb-2 block text-sm font-semibold">
            Price (PHP) <span aria-hidden="true" className="text-[#ba1a1a]">*</span>
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="absolute left-4 top-1/2 -translate-y-1/2 font-semibold text-[#444653]"
            >
              ₱
            </span>
            <Input
              id="listing-price"
              name="price"
              type="number"
              value={price}
              onChange={(event) => {
                setPrice(event.target.value);
                markFieldEdited("price");
              }}
              min="0"
              max={LISTING_PRICE_MAX_PHP}
              step="0.01"
              inputMode="decimal"
              required
              disabled={pending}
              placeholder="0.00"
              invalid={Boolean(fieldErrors.price)}
              aria-describedby={
                fieldErrors.price ? "listing-price-help listing-price-error" : "listing-price-help"
              }
              className="pl-10"
            />
          </div>
          <p id="listing-price-help" className="mt-2 text-xs leading-5 text-[#5b6070]">
            Maximum price: PHP {LISTING_PRICE_MAX_PHP.toLocaleString("en-PH")}. Online payment is not collected by UC Marketplace.
          </p>
          <FieldError id="listing-price-error" message={fieldErrors.price} />
        </div>
      </FormSection>

      <FormSection
        id="listing-submission"
        step={4}
        title="Review and Publish"
        description="Check the summary before making your listing visible to verified students."
      >
        <dl className="grid gap-3 rounded-lg bg-[#f2f5fc] p-4 text-sm sm:grid-cols-2 sm:p-5">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.05em] text-[#5b6070]">Title</dt>
            <dd className="mt-1 break-words font-semibold text-[#121c2a]">{title.trim() || "Not set"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.05em] text-[#5b6070]">Images</dt>
            <dd className="mt-1 font-semibold text-[#121c2a]">{selectedImages.length} selected</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.05em] text-[#5b6070]">Category</dt>
            <dd className="mt-1 font-semibold text-[#121c2a]">{selectedCategory?.name ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.05em] text-[#5b6070]">Condition</dt>
            <dd className="mt-1 font-semibold text-[#121c2a]">{selectedCondition?.label ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.05em] text-[#5b6070]">Price</dt>
            <dd className="mt-1 font-semibold text-[#002576]">{formattedPrice}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.05em] text-[#5b6070]">Initial status</dt>
            <dd className="mt-1 font-semibold text-[#121c2a]">Available</dd>
          </div>
        </dl>

        {showServerFeedback && state.message && (
          <div className="mt-5">
            <FormNotification variant="error">{state.message}</FormNotification>
          </div>
        )}

        <p className="mt-5 text-sm leading-6 text-[#5b6070]">
          By publishing, you confirm that the description and photos accurately represent your item.
        </p>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            type="button"
            disabled={pending}
            onClick={clearForm}
            className="min-h-12 px-6 text-sm"
          >
            Clear Form
          </Button>
          <Button
            type="submit"
            disabled={pending || !categoriesAvailable}
            className="min-h-12 px-7 text-sm"
          >
            {pending ? (
              <>
                <span
                  aria-hidden="true"
                  className="mr-2 size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                />
                Publishing Listing...
              </>
            ) : (
              "Publish Listing"
            )}
          </Button>
        </div>
      </FormSection>
    </form>
  );
}
