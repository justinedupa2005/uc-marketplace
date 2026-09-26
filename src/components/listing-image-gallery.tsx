"use client";

import Image from "next/image";
import { useState } from "react";

import type { ListingDetailsImage } from "@/lib/listings";

export function ListingImageGallery({
  images,
  title,
}: {
  images: ListingDetailsImage[];
  title: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedImage = images[selectedIndex] ?? images[0];

  if (!selectedImage) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-2xl border border-[#c4c5d5] bg-[#d9e3f7] sm:aspect-[4/3]">
        <p className="text-sm font-medium text-[#444653]">
          No product image is available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-square overflow-hidden rounded-2xl border border-[#c4c5d5] bg-[#d9e3f7] sm:aspect-[4/3]">
        <Image
          key={selectedImage.src}
          src={selectedImage.src}
          alt={selectedImage.alt}
          fill
          unoptimized
          priority
          sizes="(max-width: 1023px) 100vw, 60vw"
          className="object-contain"
        />
      </div>

      {images.length > 1 && (
        <ul
          aria-label={`${title} image thumbnails`}
          className="grid grid-cols-4 gap-3 sm:grid-cols-5"
        >
          {images.map((image, index) => (
            <li key={`${image.sortOrder}-${image.src}`}>
              <button
                type="button"
                onClick={() => setSelectedIndex(index)}
                aria-label={`Show product image ${index + 1}`}
                aria-pressed={index === selectedIndex}
                className={`relative block aspect-square w-full overflow-hidden rounded-lg border-2 bg-[#d9e3f7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8] ${
                  index === selectedIndex
                    ? "border-[#0038a8]"
                    : "border-transparent hover:border-[#8aa5d8]"
                }`}
              >
                <Image
                  src={image.src}
                  alt=""
                  fill
                  unoptimized
                  sizes="(max-width: 639px) 25vw, 130px"
                  className="object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
