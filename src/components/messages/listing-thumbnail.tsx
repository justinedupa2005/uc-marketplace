import Image from "next/image";

const thumbnailSizes = {
  sm: { container: "size-14", image: "56px" },
  md: { container: "size-16", image: "64px" },
  lg: { container: "size-20", image: "80px" },
} as const;

export function ListingThumbnail({
  imageUrl,
  size = "md",
}: {
  imageUrl: string | null;
  size?: keyof typeof thumbnailSizes;
}) {
  const classes = thumbnailSizes[size];

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#e1e2ea] bg-[#f1f4fb] text-[#5b6070] ${classes.container}`}
    >
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt=""
          fill
          unoptimized
          sizes={classes.image}
          className="object-cover"
        />
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z" />
          <path d="m5 17 4.4-4.4a1.5 1.5 0 0 1 2.1 0l1.2 1.2 1.8-1.8a1.5 1.5 0 0 1 2.1 0L20 15.4M8.5 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
        </svg>
      )}
    </div>
  );
}
