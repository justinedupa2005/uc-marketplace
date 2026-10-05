import Link from "next/link";

import type { ListingSeller } from "@/features/listings/types";
import { ProfileAvatar } from "@/features/profiles/components/profile-avatar";

export function VerificationBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#e6eeff] px-2.5 py-1 text-xs font-semibold text-[#002576]">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="currentColor">
        <path d="M10 1.5 12 3l2.5-.1.7 2.4 2.1 1.4-.9 2.3.9 2.3-2.1 1.4-.7 2.4L12 15l-2 1.5L8 15l-2.5.1-.7-2.4-2.1-1.4.9-2.3-.9-2.3 2.1-1.4.7-2.4L8 3l2-1.5Zm3.2 5.8-1.1-1.1-3 3-1.3-1.3L6.7 9l2.4 2.4 4.1-4.1Z" />
      </svg>
      Verified Student
    </span>
  );
}

export function SellerCard({ seller }: { seller: ListingSeller }) {
  const details = [
    seller.course,
    seller.yearLevel ? `Year ${seller.yearLevel}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-labelledby="listing-seller-title" className="mt-6 border-t border-[#e1e2ea] pt-6">
      <h2 id="listing-seller-title" className="text-sm font-semibold text-[#444653]">
        Seller
      </h2>
      <div className="mt-3 flex items-center gap-3">
        <ProfileAvatar
          avatarUrl={seller.avatarUrl}
          fullName={seller.fullName}
          size={48}
          className="shrink-0"
        />
        <div className="min-w-0">
          <p className="truncate font-bold text-[#121c2a]">{seller.fullName}</p>
          {details && <p className="mt-0.5 truncate text-xs text-[#5b6070]">{details}</p>}
          {seller.isVerified && <div className="mt-2"><VerificationBadge /></div>}
        </div>
      </div>
      {seller.isVerified && (
        <Link
          href={`/users/${seller.id}`}
          className="mt-3 inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-[#0038a8] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
        >
          View Profile
        </Link>
      )}
    </section>
  );
}
