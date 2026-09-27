import Image from "next/image";
import type { ChangeEventHandler } from "react";

import { FieldError } from "@/components/ui/field-error";
import { ListingFormSection } from "@/features/listings/components/listing-form-section";
import { MAX_LISTING_IMAGES } from "@/features/listings/validation";

import type { SelectedListingImage } from "../_hooks/use-sell-images";

export function SellImagesSection({
  images,
  selectionErrors,
  fieldError,
  pending,
  onChooseImages,
  onRemoveImage,
}: {
  images: SelectedListingImage[];
  selectionErrors: string[];
  fieldError?: string;
  pending: boolean;
  onChooseImages: ChangeEventHandler<HTMLInputElement>;
  onRemoveImage: (imageId: string) => void;
}) {
  const maximumReached = images.length >= MAX_LISTING_IMAGES;

  return (
    <ListingFormSection
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
        disabled={pending || maximumReached}
        onChange={onChooseImages}
        aria-required="true"
        aria-describedby={
          fieldError
            ? "listing-images-help listing-images-error"
            : "listing-images-help"
        }
        aria-invalid={Boolean(fieldError)}
        className="peer sr-only"
      />
      <label
        htmlFor="listing-images"
        aria-disabled={pending || maximumReached}
        className={`flex min-h-44 flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 text-center transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#0038a8] ${
          pending || maximumReached
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
          {maximumReached
            ? "Maximum images selected"
            : images.length
              ? "Add more images"
              : "Choose product images"}
        </span>
        <span id="listing-images-help" className="mt-1 text-xs leading-5">
          JPEG, PNG, or WebP · Up to 5 MB each
        </span>
      </label>

      <div className="mt-4 flex items-center justify-between gap-4 text-sm">
        <p className="font-semibold text-[#121c2a]">
          Images selected: {images.length} / {MAX_LISTING_IMAGES}
        </p>
        {images.length > 0 && (
          <p className="text-[#5b6070]">First image is the cover</p>
        )}
      </div>

      <FieldError id="listing-images-error" message={fieldError} />

      {selectionErrors.length > 0 && (
        <div
          role="alert"
          aria-live="polite"
          className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <ul className="list-disc space-y-1 pl-5">
            {selectionErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {images.length > 0 && (
        <ul
          aria-label="Selected product images"
          className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3"
        >
          {images.map((image, index) => (
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
                onClick={() => onRemoveImage(image.id)}
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
    </ListingFormSection>
  );
}
