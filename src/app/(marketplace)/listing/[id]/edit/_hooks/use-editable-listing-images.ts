"use client";

import { useState, type ChangeEvent } from "react";

import { useObjectUrlRegistry } from "@/features/listings/client/use-object-url-registry";
import type { OwnedListingImage } from "@/features/listings/types";
import {
  listingImageSchema,
  MAX_LISTING_IMAGES,
} from "@/features/listings/validation";

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

export type EditableListingImage = ExistingImage | NewImage;

export function useEditableListingImages(
  initialImages: readonly OwnedListingImage[],
  onImagesChanged: () => void,
) {
  const [images, setImages] = useState<EditableListingImage[]>(() =>
    initialImages.map((image) => ({
      kind: "existing",
      key: `existing:${image.storagePath}`,
      storagePath: image.storagePath,
      previewUrl: image.src,
      alt: image.alt,
    })),
  );
  const [selectionErrors, setSelectionErrors] = useState<string[]>([]);
  const { createObjectUrl, revokeObjectUrl } = useObjectUrlRegistry();

  function chooseImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    const nextImages = [...images];
    const nextErrors: string[] = [];

    for (const file of files) {
      if (nextImages.length >= MAX_LISTING_IMAGES) {
        nextErrors.push(`You can keep a maximum of ${MAX_LISTING_IMAGES} images.`);
        break;
      }

      const validation = listingImageSchema.safeParse(file);
      if (!validation.success) {
        nextErrors.push(
          `${file.name}: ${validation.error.issues[0]?.message ?? "Invalid image."}`,
        );
        continue;
      }

      const duplicate = nextImages.some(
        (image) =>
          image.kind === "new" &&
          image.file.name === file.name &&
          image.file.size === file.size,
      );
      if (duplicate) {
        nextErrors.push(`${file.name} is already selected.`);
        continue;
      }

      const token = crypto.randomUUID();
      nextImages.push({
        kind: "new",
        key: `new:${token}`,
        token,
        file,
        previewUrl: createObjectUrl(file),
        alt: file.name,
      });
    }

    setSelectionErrors(nextErrors);
    if (nextImages.length !== images.length) {
      setImages(nextImages);
      onImagesChanged();
    }
  }

  function removeImage(key: string) {
    const removedImage = images.find((image) => image.key === key);
    if (removedImage?.kind === "new") {
      revokeObjectUrl(removedImage.previewUrl);
    }

    setImages((currentImages) =>
      currentImages.filter((image) => image.key !== key),
    );
    setSelectionErrors([]);
    onImagesChanged();
  }

  function moveImage(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= images.length) return;

    setImages((currentImages) => {
      const nextImages = [...currentImages];
      [nextImages[index], nextImages[targetIndex]] = [
        nextImages[targetIndex],
        nextImages[index],
      ];
      return nextImages;
    });
    onImagesChanged();
  }

  function appendImagesTo(formData: FormData) {
    const newImages = images.filter(
      (image): image is NewImage => image.kind === "new",
    );
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
    formData.set(
      "newImageTokens",
      JSON.stringify(newImages.map((image) => image.token)),
    );
    formData.delete("newImages");
    newImages.forEach((image) =>
      formData.append("newImages", image.file, image.file.name),
    );
  }

  return {
    images,
    selectionErrors,
    chooseImages,
    removeImage,
    moveImage,
    appendImagesTo,
  };
}
