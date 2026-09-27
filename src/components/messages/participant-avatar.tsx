import Image from "next/image";

const avatarSizes = {
  sm: { container: "size-10", image: "40px", text: "text-xs" },
  md: { container: "size-12", image: "48px", text: "text-sm" },
  lg: { container: "size-14", image: "56px", text: "text-base" },
} as const;

export function ParticipantAvatar({
  name,
  avatarUrl,
  size = "md",
}: {
  name: string;
  avatarUrl: string | null;
  size?: keyof typeof avatarSizes;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const classes = avatarSizes[size];

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e6eeff] font-bold text-[#002576] ${classes.container} ${classes.text}`}
    >
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt=""
          fill
          unoptimized
          sizes={classes.image}
          className="object-cover"
        />
      ) : (
        <span aria-hidden="true">
          {initials || "UC"}
        </span>
      )}
    </div>
  );
}
