import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { FavoriteButton } from "@/components/favorite-button";
import { ConditionBadge, ListingStatusBadge } from "@/components/listing-badges";
import type { ListingStatus, ListingStatusLabel } from "@/lib/listing-rules";

export type MarketplaceProduct = {
  id: string | number;
  title: string;
  price: string;
  condition: string;
  status: ListingStatusLabel;
  statusValue: ListingStatus;
  categoryName: string;
  createdAt: string;
  image: string | null;
  imageAlt: string;
  isFavorited: boolean;
  isOwner: boolean;
};

type ProductCardProps = {
  product: MarketplaceProduct;
  showFavorite?: boolean;
  showMetadata?: boolean;
  actions?: ReactNode;
};

export function ProductCard({
  product,
  showFavorite = true,
  showMetadata = false,
  actions,
}: ProductCardProps) {
  const listingHref = `/listing/${product.id}`;
  const formattedDate = new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
  }).format(new Date(product.createdAt));

  return (
    <article className="overflow-hidden rounded-2xl border border-[#c4c5d5] bg-white shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative aspect-square w-full overflow-hidden bg-[#d9e3f7] sm:aspect-[4/3]">
        <Link
          href={listingHref}
          aria-label={`View ${product.title}`}
          className="relative block size-full focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0038a8]"
        >
          {product.image && (
            <Image
              src={product.image}
              alt={product.imageAlt}
              fill
              unoptimized
              sizes="(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 25vw"
              className="object-cover"
            />
          )}
        </Link>
        <div className="pointer-events-none absolute right-2 top-2">
          <ConditionBadge condition={product.condition} />
        </div>
      </div>

      <div className="flex min-h-28 flex-col gap-1 p-4">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <h3 className="line-clamp-2 min-h-10 text-base font-semibold leading-5 text-[#121c2a]">
            <Link
              href={listingHref}
              className="rounded-sm hover:text-[#0038a8] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
            >
              {product.title}
            </Link>
          </h3>
          {showFavorite && !product.isOwner && (
            <div className="-mr-2 -mt-1 shrink-0">
              <FavoriteButton
                listingId={String(product.id)}
                title={product.title}
                initialIsFavorited={product.isFavorited}
                compact
              />
            </div>
          )}
        </div>

        {showMetadata && (
          <p className="mt-1 line-clamp-1 text-xs text-[#5b6070]">
            {product.categoryName} · {formattedDate}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-1 pt-2">
          <p className="whitespace-nowrap text-lg font-bold leading-7 text-[#002576]">
            {product.price}
          </p>
          <ListingStatusBadge status={product.statusValue} />
        </div>

        {actions && <div className="mt-3 border-t border-[#e1e2ea] pt-3">{actions}</div>}
      </div>
    </article>
  );
}
