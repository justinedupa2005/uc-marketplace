import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  hasMatchingListingImageSignature,
  LISTING_DESCRIPTION_MAX_LENGTH,
  LISTING_PRICE_MAX_PHP,
  LISTING_TITLE_MAX_LENGTH,
  listingDetailsSchema,
  listingFormSchema,
  listingImageSchema,
  MAX_LISTING_IMAGE_BYTES,
} from "../src/lib/validations/listing.ts";

const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";

const signatures = {
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0],
  "image/png": [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ],
  "image/webp": [
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ],
};

const extensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function imageFile({
  type = "image/png",
  name = `product.${extensions[type] ?? "bin"}`,
  size,
  bytes,
} = {}) {
  const signature = bytes ?? signatures[type] ?? [1];
  const content = new Uint8Array(size ?? signature.length);
  content.set(signature.slice(0, content.length));

  return new File([content], name, { type, lastModified: 1 });
}

function validDetails(overrides = {}) {
  return {
    title: "Calculus Textbook",
    description: "A complete textbook in good working condition.",
    categoryId: CATEGORY_ID,
    price: "500.00",
    condition: "good",
    ...overrides,
  };
}

function validForm(overrides = {}) {
  return {
    ...validDetails(),
    images: [imageFile()],
    ...overrides,
  };
}

describe("listing text fields", () => {
  test("trims valid title and description values", () => {
    const result = listingDetailsSchema.safeParse(
      validDetails({
        title: "  Calculus Textbook  ",
        description: "  A complete textbook in good working condition.  ",
      }),
    );

    assert.equal(result.success, true);
    assert.equal(result.data.title, "Calculus Textbook");
    assert.equal(
      result.data.description,
      "A complete textbook in good working condition.",
    );
  });

  test("rejects titles outside the 5 to 100 character range", () => {
    assert.equal(
      listingDetailsSchema.safeParse(validDetails({ title: "Book" })).success,
      false,
    );
    assert.equal(
      listingDetailsSchema.safeParse(
        validDetails({ title: "x".repeat(LISTING_TITLE_MAX_LENGTH + 1) }),
      ).success,
      false,
    );
    assert.equal(
      listingDetailsSchema.safeParse(validDetails({ title: "     " })).success,
      false,
    );
  });

  test("rejects descriptions outside the 10 to 2,000 character range", () => {
    assert.equal(
      listingDetailsSchema.safeParse(
        validDetails({ description: "123456789" }),
      ).success,
      false,
    );
    assert.equal(
      listingDetailsSchema.safeParse(
        validDetails({
          description: "x".repeat(LISTING_DESCRIPTION_MAX_LENGTH + 1),
        }),
      ).success,
      false,
    );
    assert.equal(
      listingDetailsSchema.safeParse(
        validDetails({ description: "          " }),
      ).success,
      false,
    );
  });
});

describe("listing category, price, and condition", () => {
  test("accepts a UUID category and rejects non-UUID values", () => {
    assert.equal(listingDetailsSchema.safeParse(validDetails()).success, true);
    assert.equal(
      listingDetailsSchema.safeParse(
        validDetails({ categoryId: "not-a-category-id" }),
      ).success,
      false,
    );
  });

  test("accepts positive prices at or below the marketplace maximum", () => {
    for (const price of ["0.01", "1", "12.5", "12.50", String(LISTING_PRICE_MAX_PHP)]) {
      assert.equal(
        listingDetailsSchema.safeParse(validDetails({ price })).success,
        true,
        `expected ${price} to be accepted`,
      );
    }
  });

  test("rejects zero, negative, excessive, nonnumeric, and over-precise prices", () => {
    for (const price of [
      "0",
      "-1",
      `${LISTING_PRICE_MAX_PHP}.01`,
      "12.345",
      "NaN",
      "Infinity",
      "five hundred",
    ]) {
      assert.equal(
        listingDetailsSchema.safeParse(validDetails({ price })).success,
        false,
        `expected ${price} to be rejected`,
      );
    }
  });

  test("accepts every supported condition and rejects unsupported values", () => {
    for (const condition of ["new", "like_new", "good", "fair"]) {
      assert.equal(
        listingDetailsSchema.safeParse(validDetails({ condition })).success,
        true,
      );
    }

    assert.equal(
      listingDetailsSchema.safeParse(validDetails({ condition: "used" })).success,
      false,
    );
  });
});

describe("listing image validation", () => {
  test("accepts one image and five images", () => {
    assert.equal(listingFormSchema.safeParse(validForm()).success, true);
    assert.equal(
      listingFormSchema.safeParse(
        validForm({ images: Array.from({ length: 5 }, () => imageFile()) }),
      ).success,
      true,
    );
  });

  test("rejects zero images and six images", () => {
    assert.equal(
      listingFormSchema.safeParse(validForm({ images: [] })).success,
      false,
    );
    assert.equal(
      listingFormSchema.safeParse(
        validForm({ images: Array.from({ length: 6 }, () => imageFile()) }),
      ).success,
      false,
    );
  });

  test("accepts JPEG, PNG, and WebP MIME types", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      assert.equal(
        listingImageSchema.safeParse(imageFile({ type })).success,
        true,
      );
    }
  });

  test("rejects unsupported MIME types, empty files, and files over 5 MB", () => {
    assert.equal(
      listingImageSchema.safeParse(imageFile({ type: "image/gif" })).success,
      false,
    );
    assert.equal(
      listingImageSchema.safeParse(imageFile({ size: 0 })).success,
      false,
    );
    assert.equal(
      listingImageSchema.safeParse(
        imageFile({ size: MAX_LISTING_IMAGE_BYTES + 1 }),
      ).success,
      false,
    );
  });

  test("accepts an image exactly at the 5 MB limit", () => {
    assert.equal(
      listingImageSchema.safeParse(
        imageFile({ size: MAX_LISTING_IMAGE_BYTES }),
      ).success,
      true,
    );
  });
});

describe("listing image signatures", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    test(`recognizes a matching ${type} signature`, async () => {
      assert.equal(
        await hasMatchingListingImageSignature(imageFile({ type })),
        true,
      );
    });

    test(`rejects a mismatched ${type} signature`, async () => {
      assert.equal(
        await hasMatchingListingImageSignature(
          imageFile({ type, bytes: new Array(12).fill(0) }),
        ),
        false,
      );
    });
  }
});
