import Image from "next/image";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type MarketplaceProduct = {
  id: string | number;
  title: string;
  price: string;
  condition: string;
  status: "Available" | "Reserved" | "Sold" | "Removed" | "Draft";
  image: string | null;
  imageAlt: string;
};

type ProductCardProps = {
  product: MarketplaceProduct;
  showFavorite?: boolean;
};

function getStatusTone(status: MarketplaceProduct["status"]) {
  if (status === "Available") {
    return "available" as const;
  }

  if (status === "Reserved" || status === "Draft") {
    return "pending" as const;
  }

  return "neutral" as const;
}

export function ProductCard({
  product,
  showFavorite = true,
}: ProductCardProps) {
  const listingHref = `/listings/${product.id}`;

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
        <Badge
          tone="neutral"
          className="pointer-events-none absolute right-2 top-2 backdrop-blur-sm"
        >
          {product.condition}
        </Badge>
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
          {showFavorite && (
            <Button
              variant="icon"
              aria-label={`Save ${product.title}`}
              className="-mr-2 -mt-1 size-8 shrink-0 rounded-full p-2"
            >
              <Image
                src="/assets/marketplace/favorite.svg"
                alt=""
                width={17}
                height={16}
                aria-hidden="true"
              />
            </Button>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-1 pt-2">
          <p className="whitespace-nowrap text-lg font-bold leading-7 text-[#002576]">
            {product.price}
          </p>
          <Badge tone={getStatusTone(product.status)}>
            {product.status}
          </Badge>
        </div>
      </div>
    </article>
  );
}
