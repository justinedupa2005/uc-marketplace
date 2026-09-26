"use client";

import { useState } from "react";

import { FavoritesEmptyState } from "@/components/favorites-empty-state";
import {
  ProductCard,
  type MarketplaceProduct,
} from "@/components/product-card";

export function FavoritesGrid({
  products,
  returnTo = "/favorites",
}: {
  products: MarketplaceProduct[];
  returnTo?: string;
}) {
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
  }

  if (visibleProducts.length === 0) {
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
