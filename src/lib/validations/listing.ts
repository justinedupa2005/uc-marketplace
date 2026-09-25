import { z } from "zod";

export const LISTING_TITLE_MIN_LENGTH = 5;
export const LISTING_TITLE_MAX_LENGTH = 100;
export const LISTING_DESCRIPTION_MIN_LENGTH = 10;
export const LISTING_DESCRIPTION_MAX_LENGTH = 2_000;
export const LISTING_PRICE_MAX_PHP = 1_000_000;
export const MAX_LISTING_IMAGES = 5;
export const MAX_LISTING_IMAGE_BYTES = 5 * 1024 * 1024;

export const LISTING_CONDITIONS = [
  "new",
  "like_new",
  "good",
  "fair",
] as const;

export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

export const LISTING_CONDITION_OPTIONS: ReadonlyArray<{
  value: ListingCondition;
  label: string;
  description: string;
}> = [
  {
    value: "new",
    label: "New",
    description: "Unused and in its original or like-original condition.",
  },
  {
    value: "like_new",
    label: "Like New",
    description: "Previously owned with little to no visible signs of use.",
  },
  {
    value: "good",
    label: "Good",
    description: "Fully usable with minor signs of normal wear.",
  },
  {
    value: "fair",
    label: "Fair",
    description: "Usable but has noticeable wear or cosmetic flaws.",
  },
];

export const LISTING_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type ListingField =
  | "title"
  | "description"
  | "categoryId"
  | "price"
  | "condition"
  | "images";

export type ListingFieldErrors = Partial<Record<ListingField, string>>;

export const LISTING_FIELD_ORDER: readonly ListingField[] = [
  "images",
  "title",
  "categoryId",
  "description",
  "condition",
  "price",
];

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function isFileLike(value: unknown): value is File {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<File>;

  return (
    typeof candidate.name === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.type === "string" &&
    typeof candidate.arrayBuffer === "function" &&
    typeof candidate.slice === "function"
  );
}

const titleSchema = z.preprocess(
  stringValue,
  z
    .string()
    .trim()
    .min(
      LISTING_TITLE_MIN_LENGTH,
      `Enter at least ${LISTING_TITLE_MIN_LENGTH} characters for the title.`,
    )
    .max(
      LISTING_TITLE_MAX_LENGTH,
      `Keep the title within ${LISTING_TITLE_MAX_LENGTH} characters.`,
    ),
);

const descriptionSchema = z.preprocess(
  stringValue,
  z
    .string()
    .trim()
    .min(
      LISTING_DESCRIPTION_MIN_LENGTH,
      `Enter at least ${LISTING_DESCRIPTION_MIN_LENGTH} characters for the description.`,
    )
    .max(
      LISTING_DESCRIPTION_MAX_LENGTH,
      `Keep the description within ${LISTING_DESCRIPTION_MAX_LENGTH.toLocaleString()} characters.`,
    ),
);

const categorySchema = z.preprocess(
  stringValue,
  z.string().trim().uuid("Select an available category."),
);

const priceSchema = z.preprocess(
  stringValue,
  z
    .string()
    .trim()
    .min(1, "Enter a price.")
    .regex(
      /^\d+(?:\.\d{1,2})?$/,
      "Enter a valid price with no more than two decimal places.",
    )
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
      message: "Price must be greater than zero.",
    })
    .refine((value) => Number(value) <= LISTING_PRICE_MAX_PHP, {
      message: `Price cannot exceed ₱${LISTING_PRICE_MAX_PHP.toLocaleString("en-PH")}.`,
    }),
);

const conditionSchema = z.preprocess(
  stringValue,
  z.enum(LISTING_CONDITIONS, {
    error: "Select a valid item condition.",
  }),
);

export const listingDetailsSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  categoryId: categorySchema,
  price: priceSchema,
  condition: conditionSchema,
});

export const listingImageSchema = z
  .custom<File>(isFileLike, { error: "Choose a valid image file." })
  .refine((file) => file.size > 0, "The image file is empty.")
  .refine(
    (file) => file.size <= MAX_LISTING_IMAGE_BYTES,
    "Each image must be 5 MB or smaller.",
  )
  .refine(
    (file) => Object.hasOwn(LISTING_IMAGE_EXTENSIONS, file.type),
    "Use a JPEG, PNG, or WebP image.",
  );

export const listingImagesSchema = z
  .array(listingImageSchema)
  .min(1, "Upload at least one product image.")
  .max(MAX_LISTING_IMAGES, `Upload no more than ${MAX_LISTING_IMAGES} images.`);

export const listingFormSchema = listingDetailsSchema.extend({
  images: listingImagesSchema,
});

export type ListingFormValues = z.input<typeof listingFormSchema>;
export type ValidatedListingForm = z.output<typeof listingFormSchema>;

export function getListingFieldErrors(error: z.ZodError): ListingFieldErrors {
  const fieldErrors: ListingFieldErrors = {};

  for (const issue of error.issues) {
    const field = issue.path[0];

    if (
      typeof field === "string" &&
      LISTING_FIELD_ORDER.includes(field as ListingField) &&
      !fieldErrors[field as ListingField]
    ) {
      fieldErrors[field as ListingField] = issue.message;
    }
  }

  return fieldErrors;
}

export async function hasMatchingListingImageSignature(file: File) {
  const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer());

  if (file.type === "image/jpeg") {
    return (
      signature[0] === 0xff &&
      signature[1] === 0xd8 &&
      signature[2] === 0xff
    );
  }

  if (file.type === "image/png") {
    return (
      signature[0] === 0x89 &&
      signature[1] === 0x50 &&
      signature[2] === 0x4e &&
      signature[3] === 0x47 &&
      signature[4] === 0x0d &&
      signature[5] === 0x0a &&
      signature[6] === 0x1a &&
      signature[7] === 0x0a
    );
  }

  if (file.type === "image/webp") {
    return (
      signature[0] === 0x52 &&
      signature[1] === 0x49 &&
      signature[2] === 0x46 &&
      signature[3] === 0x46 &&
      signature[8] === 0x57 &&
      signature[9] === 0x45 &&
      signature[10] === 0x42 &&
      signature[11] === 0x50
    );
  }

  return false;
}
