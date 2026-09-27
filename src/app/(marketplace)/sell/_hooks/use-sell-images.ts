"use client";

import { useState, type ChangeEvent } from "react";

import { useObjectUrlRegistry } from "@/features/listings/client/use-object-url-registry";
import {
  listingImageSchema,
  MAX_LISTING_IMAGES,
} from "@/features/listings/validation";

export type SelectedListingImage = {
  id: string;
  file: File;
  previewUrl: string;
};

function getFileFingerprint(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}

export function useSellImages(onImagesChanged: () => void) {
  const [images, setImages] = useState<SelectedListingImage[]>([]);
  const [selectionErrors, setSelectionErrors] = useState<string[]>([]);
  const { createObjectUrl, revokeObjectUrl, revokeAllObjectUrls } =
    useObjectUrlRegistry();

  function chooseImages(event: ChangeEvent<HTMLInputElement>) {
    const chosenFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";

    if (chosenFiles.length === 0) return;

    const nextImages = [...images];
    const knownFiles = new Set(
      nextImages.map(({ file }) => getFileFingerprint(file)),
    );
    const nextErrors: string[] = [];

    for (const file of chosenFiles) {
      if (nextImages.length >= MAX_LISTING_IMAGES) {
        nextErrors.push(
          `${file.name} could not be added. You can upload a maximum of ${MAX_LISTING_IMAGES} images.`,
        );
        continue;
      }

      const fingerprint = getFileFingerprint(file);
      if (knownFiles.has(fingerprint)) {
        nextErrors.push(`${file.name} is already selected.`);
        continue;
      }

      const validation = listingImageSchema.safeParse(file);
      if (!validation.success) {
        nextErrors.push(
          `${file.name} could not be added. ${validation.error.issues[0]?.message ?? "Choose another image."}`,
        );
        continue;
      }

      knownFiles.add(fingerprint);
      nextImages.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: createObjectUrl(file),
      });
    }

    setImages(nextImages);
    setSelectionErrors(nextErrors);
    onImagesChanged();
  }

  function removeImage(imageId: string) {
    const imageToRemove = images.find((image) => image.id === imageId);
    if (imageToRemove) revokeObjectUrl(imageToRemove.previewUrl);

    setImages((currentImages) =>
      currentImages.filter((image) => image.id !== imageId),
    );
    setSelectionErrors([]);
    onImagesChanged();
  }

  function appendImagesTo(formData: FormData) {
    formData.delete("images");
    images.forEach(({ file }) => formData.append("images", file, file.name));
  }

  function clearImages() {
    revokeAllObjectUrls();
    setImages([]);
    setSelectionErrors([]);
  }

  function clearSelectionErrors() {
    setSelectionErrors([]);
  }

  return {
    images,
    selectionErrors,
    chooseImages,
    removeImage,
    appendImagesTo,
    clearImages,
    clearSelectionErrors,
  };
}
