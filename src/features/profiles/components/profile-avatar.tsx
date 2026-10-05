"use client";

import Image from "next/image";
import { useState } from "react";

import { getProfileInitials } from "@/features/profiles/rules";

export function ProfileAvatar({
  avatarUrl,
  fullName,
  size = 96,
  className = "",
}: {
  avatarUrl: string | null;
  fullName: string | null;
  size?: number;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initials = getProfileInitials(fullName);

  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e6eeff] font-bold text-[#002576] ${className}`}
    >
      {avatarUrl && failedUrl !== avatarUrl ? (
        <Image
          src={avatarUrl}
          alt=""
          fill
          sizes={`${size}px`}
          unoptimized
          className="object-cover"
          onError={() => setFailedUrl(avatarUrl)}
        />
      ) : initials ? (
        <span style={{ fontSize: Math.round(size / 3) }}>{initials}</span>
      ) : (
        <svg className="size-1/2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-2a8 8 0 0 1 16 0v2" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}
