"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FavoritesEmptyState } from "@/features/favorites/components/favorites-empty-state";
import { ProductCard } from "@/features/listings/components/product-card";
import type { MarketplaceProduct } from "@/features/listings/types";

export function FavoritesGrid({
  products,
  returnTo = "/favorites",
}: {
  products: MarketplaceProduct[];
  returnTo?: string;
}) {
  const router = useRouter();
  const [previousProducts, setPreviousProducts] = useState(products);
  const [removedListingIds, setRemovedListingIds] = useState<Set<string>>(
    () => new Set(),
  );

  if (products !== previousProducts) {
    setPreviousProducts(products);
    setRemovedListingIds(new Set());
  }

  const visibleProducts = products.filter(
    (product) => !removedListingIds.has(String(product.id)),
  );

  function handleFavoriteChange(listingId: string, isFavorited: boolean) {
    if (isFavorited) return;

    setRemovedListingIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(listingId);
      return nextIds;
    });
    router.refresh();
  }

  if (visibleProducts.length === 0) {
    if (products.length > 0) {
      return (
        <div className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
          <p role="status" className="text-sm text-[#444653]">
            This page has no remaining favorites.
          </p>
          <Link
            href="/favorites"
            className="mt-4 inline-flex min-h-11 items-center rounded-md border border-[#0038a8] px-5 text-sm font-semibold text-[#0038a8] hover:bg-[#edf2ff]"
          >
            View Favorites
          </Link>
        </div>
      );
    }
    return <FavoritesEmptyState />;
  }

  return (
    <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {visibleProducts.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          showMetadata
          returnTo={returnTo}
          onFavoriteChange={handleFavoriteChange}
        />
      ))}
    </div>
  );
}
