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
import {
  getListingFieldErrors,
  LISTING_CONDITION_OPTIONS,
  LISTING_DESCRIPTION_MAX_LENGTH,
  LISTING_FIELD_ORDER,
  LISTING_PRICE_MAX_PHP,
  LISTING_TITLE_MAX_LENGTH,
  listingFormSchema,
  listingImageSchema,
  MAX_LISTING_IMAGES,
  type ListingCondition,
  type ListingField,
  type ListingFieldErrors,
} from "@/lib/validations/listing";

import { createListing, type CreateListingState } from "./actions";

export type SellCategory = {
  id: string;
  name: string;
};

type SellFormProps = {
  categories: SellCategory[];
  categoryLoadError: boolean;
  submissionId: string;
};

type SelectedImage = {
  id: string;
  file: File;
  previewUrl: string;
};

const inputClass =
  "h-12 w-full rounded-md border bg-white px-4 text-base text-[#121c2a] outline-none transition placeholder:text-[#747685] focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]";

const fieldIds: Record<ListingField, string> = {
  images: "listing-images",
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

function FormSection({
  id,
  step,
  title,
  description,
  children,
}: {
  id: string;
  step: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-xl border border-[#c4c5d5]/60 bg-white p-5 shadow-sm sm:p-7"
    >
      <div className="border-b border-[#c4c5d5]/40 pb-4">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#0038a8]">
          Step {step}
        </p>
        <h2
          id={`${id}-title`}
          className="mt-1 text-xl font-bold leading-7 text-[#121c2a]"
        >
          {title}
        </h2>
        <p className="mt-1 text-sm leading-5 text-[#5b6070]">{description}</p>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p id={id} role="alert" className="mt-2 text-sm leading-5 text-[#ba1a1a]">
      {message}
    </p>
  );
}

function getFileFingerprint(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}

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
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [imageSelectionErrors, setImageSelectionErrors] = useState<string[]>([]);
  const [clientFieldErrors, setClientFieldErrors] =
    useState<ListingFieldErrors>({});
  const [dismissedServerState, setDismissedServerState] = useState<string | null>(
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const previousActionStateRef = useRef(state);
  const serverStateKey = JSON.stringify(state);
  const showServerFeedback = dismissedServerState !== serverStateKey;
  const categoriesAvailable = !categoryLoadError && categories.length > 0;
  const serverFieldErrors = showServerFeedback ? state.fieldErrors : {};
  const fieldErrors = { ...serverFieldErrors, ...clientFieldErrors };

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
    const previewUrls = previewUrlsRef.current;

    return () => {
      previewUrls.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
      previewUrls.clear();
    };
  }, []);

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

  useEffect(() => {
    if (!isDirty || pending) {
      return;
    }

    function preventAccidentalExit(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", preventAccidentalExit);
    return () => window.removeEventListener("beforeunload", preventAccidentalExit);
  }, [isDirty, pending]);

  function markFieldEdited(field: ListingField) {
    setDismissedServerState(serverStateKey);
    setClientFieldErrors((currentErrors) => {
      if (!currentErrors[field]) {
        return currentErrors;
      }

      const nextErrors = { ...currentErrors };
      delete nextErrors[field];
      return nextErrors;
    });
  }

  function chooseImages(event: React.ChangeEvent<HTMLInputElement>) {
    const chosenFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";

    if (chosenFiles.length === 0) {
      return;
    }

    const nextImages = [...selectedImages];
    const knownFiles = new Set(
      nextImages.map(({ file }) => getFileFingerprint(file)),
    );
    const selectionErrors: string[] = [];

    for (const file of chosenFiles) {
      if (nextImages.length >= MAX_LISTING_IMAGES) {
        selectionErrors.push(
          `${file.name} could not be added. You can upload a maximum of ${MAX_LISTING_IMAGES} images.`,
        );
        continue;
      }

      const fingerprint = getFileFingerprint(file);
      if (knownFiles.has(fingerprint)) {
        selectionErrors.push(`${file.name} is already selected.`);
        continue;
      }

      const validatedFile = listingImageSchema.safeParse(file);
      if (!validatedFile.success) {
        selectionErrors.push(
          `${file.name} could not be added. ${validatedFile.error.issues[0]?.message ?? "Choose another image."}`,
        );
        continue;
      }

      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      knownFiles.add(fingerprint);
      nextImages.push({
        id: crypto.randomUUID(),
        file,
        previewUrl,
      });
    }

    setSelectedImages(nextImages);
    setImageSelectionErrors(selectionErrors);
    markFieldEdited("images");
  }

  function removeImage(imageId: string) {
    setSelectedImages((currentImages) => {
      const imageToRemove = currentImages.find((image) => image.id === imageId);

      if (imageToRemove) {
        URL.revokeObjectURL(imageToRemove.previewUrl);
        previewUrlsRef.current.delete(imageToRemove.previewUrl);
      }

      return currentImages.filter((image) => image.id !== imageId);
    });
    setImageSelectionErrors([]);
    markFieldEdited("images");
  }

  function handleFormAction(formData: FormData) {
    formData.delete("images");
    selectedImages.forEach(({ file }) => formData.append("images", file, file.name));

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
      setDismissedServerState(serverStateKey);

      const firstInvalidField = LISTING_FIELD_ORDER.find(
        (field) => validationErrors[field],
      );
      if (firstInvalidField) {
        focusListingField(firstInvalidField);
      }
      return;
    }

    setClientFieldErrors({});
    setImageSelectionErrors([]);
    setDismissedServerState(null);
    startTransition(() => formAction(formData));
  }

  function clearForm() {
    if (isDirty && !window.confirm("Clear all listing information and images?")) {
      return;
    }

    selectedImages.forEach(({ previewUrl }) => {
      URL.revokeObjectURL(previewUrl);
      previewUrlsRef.current.delete(previewUrl);
    });
    formRef.current?.reset();
    setTitle("");
    setDescription("");
    setCategoryId("");
    setPrice("");
    setCondition("");
    setSelectedImages([]);
    setImageSelectionErrors([]);
    setClientFieldErrors({});
    setDismissedServerState(serverStateKey);
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

      <FormSection
        id="product-images"
        step={1}
        title="Product Images"
        description="Add clear photos from different angles. Your first photo will be the cover image."
      >
        <input
          id="listing-images"
          name="images"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={pending || selectedImages.length >= MAX_LISTING_IMAGES}
          onChange={chooseImages}
          aria-required="true"
          aria-describedby={
            fieldErrors.images
              ? "listing-images-help listing-images-error"
              : "listing-images-help"
          }
          aria-invalid={Boolean(fieldErrors.images)}
          className="peer sr-only"
        />
        <label
          htmlFor="listing-images"
          aria-disabled={pending || selectedImages.length >= MAX_LISTING_IMAGES}
          className={`flex min-h-44 flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 text-center transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#0038a8] ${
            pending || selectedImages.length >= MAX_LISTING_IMAGES
              ? "cursor-not-allowed border-[#d5d7df] bg-[#f2f3f8] text-[#747685]"
              : "cursor-pointer border-[#b7c5df] bg-[#f9faff] hover:border-[#0038a8] hover:bg-[#eef3ff]"
          }`}
        >
          <Image
            src="/assets/app/upload-camera.svg"
            alt=""
            width={40}
            height={36}
            aria-hidden="true"
          />
          <span className="mt-3 font-semibold text-[#002576]">
            {selectedImages.length >= MAX_LISTING_IMAGES
              ? "Maximum images selected"
              : selectedImages.length
                ? "Add more images"
                : "Choose product images"}
          </span>
          <span id="listing-images-help" className="mt-1 text-xs leading-5">
            JPEG, PNG, or WebP · Up to 5 MB each
          </span>
        </label>

        <div className="mt-4 flex items-center justify-between gap-4 text-sm">
          <p className="font-semibold text-[#121c2a]">
            Images selected: {selectedImages.length} / {MAX_LISTING_IMAGES}
          </p>
          {selectedImages.length > 0 && (
            <p className="text-[#5b6070]">First image is the cover</p>
          )}
        </div>

        <FieldError id="listing-images-error" message={fieldErrors.images} />

        {imageSelectionErrors.length > 0 && (
          <div
            role="alert"
            aria-live="polite"
            className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <ul className="list-disc space-y-1 pl-5">
              {imageSelectionErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {selectedImages.length > 0 && (
          <ul
            aria-label="Selected product images"
            className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            {selectedImages.map((image, index) => (
              <li
                key={image.id}
                className="relative overflow-hidden rounded-lg border border-[#c4c5d5] bg-[#eff3ff]"
              >
                <div className="relative aspect-square">
                  <Image
                    src={image.previewUrl}
                    alt={`Preview ${index + 1}: ${image.file.name}`}
                    fill
                    unoptimized
                    sizes="(max-width: 639px) 50vw, 220px"
                    className="object-cover"
                  />
                </div>
                {index === 0 && (
                  <span className="absolute bottom-2 left-2 rounded-full bg-[#002576] px-2.5 py-1 text-[11px] font-bold text-white shadow-sm">
                    Cover
                  </span>
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => removeImage(image.id)}
                  aria-label={`Remove ${image.file.name}`}
                  className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-full bg-white/95 text-[#ba1a1a] shadow-md transition hover:bg-[#fff0f0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8] disabled:cursor-wait disabled:opacity-50"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="size-4"
                  >
                    <path d="m6 6 8 8M14 6l-8 8" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </FormSection>

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
            <input
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
              aria-invalid={Boolean(fieldErrors.title)}
              aria-describedby={fieldErrors.title ? "listing-title-error" : undefined}
              className={`${inputClass} ${
                fieldErrors.title ? "border-[#ba1a1a]" : "border-[#c4c5d5]"
              }`}
            />
            <FieldError id="listing-title-error" message={fieldErrors.title} />
          </div>

          <div>
            <label htmlFor="listing-category" className="mb-2 block text-sm font-semibold">
              Category <span aria-hidden="true" className="text-[#ba1a1a]">*</span>
            </label>
            <div className="relative">
              <select
                id="listing-category"
                name="categoryId"
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  markFieldEdited("categoryId");
                }}
                required
                disabled={pending || !categoriesAvailable}
                aria-invalid={Boolean(fieldErrors.categoryId)}
                aria-describedby={
                  fieldErrors.categoryId ? "listing-category-error" : undefined
                }
                className={`${inputClass} appearance-none pr-11 ${
                  fieldErrors.categoryId ? "border-[#ba1a1a]" : "border-[#c4c5d5]"
                }`}
              >
                <option value="">Select a category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
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
            <textarea
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
              aria-invalid={Boolean(fieldErrors.description)}
              aria-describedby={
                fieldErrors.description
                  ? "listing-description-help listing-description-error"
                  : "listing-description-help"
              }
              className={`w-full resize-y rounded-md border bg-white p-4 text-base leading-6 text-[#121c2a] outline-none transition placeholder:text-[#747685] focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8] ${
                fieldErrors.description ? "border-[#ba1a1a]" : "border-[#c4c5d5]"
              }`}
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
            <input
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
              aria-invalid={Boolean(fieldErrors.price)}
              aria-describedby={
                fieldErrors.price ? "listing-price-help listing-price-error" : "listing-price-help"
              }
              className={`${inputClass} pl-10 ${
                fieldErrors.price ? "border-[#ba1a1a]" : "border-[#c4c5d5]"
              }`}
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
