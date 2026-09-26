"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

import {
  buildMarketplaceHref,
  type MarketplaceUrlValues,
} from "@/lib/marketplace-search-params";

export function SearchBar({ values }: { values: MarketplaceUrlValues }) {
  const router = useRouter();

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const search = String(formData.get("search") ?? "").trim();

    router.push(
      buildMarketplaceHref(values, {
        search: search || null,
      }),
    );
  }

  return (
    <form
      action="/marketplace"
      method="get"
      role="search"
      onSubmit={submitSearch}
      className="relative w-full"
    >
      {values.category && (
        <input type="hidden" name="category" value={values.category} />
      )}
      {values.condition && (
        <input type="hidden" name="condition" value={values.condition} />
      )}
      {values.minPrice !== undefined && (
        <input type="hidden" name="minPrice" value={values.minPrice} />
      )}
      {values.maxPrice !== undefined && (
        <input type="hidden" name="maxPrice" value={values.maxPrice} />
      )}
      {values.sort !== "newest" && (
        <input type="hidden" name="sort" value={values.sort} />
      )}

      <label htmlFor="marketplace-search" className="sr-only">
        Search listings
      </label>
      <input
        key={values.search ?? "empty-search"}
        id="marketplace-search"
        name="search"
        type="search"
        defaultValue={values.search ?? ""}
        maxLength={80}
        enterKeyHint="search"
        autoComplete="off"
        placeholder="Search listings..."
        className="h-[57px] w-full rounded-lg border border-[#c4c5d5] bg-white py-3 pl-4 pr-14 text-base text-[#121c2a] shadow-sm outline-none placeholder:text-[#6b7280] focus:border-[#002576] focus:ring-2 focus:ring-[#002576]/15"
      />
      <button
        type="submit"
        aria-label="Search listings"
        className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-[#0038a8] hover:bg-[#edf2ff] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0038a8]"
      >
        <Image
          src="/assets/marketplace/search.svg"
          alt=""
          width={18}
          height={18}
          aria-hidden="true"
        />
      </button>
    </form>
  );
}
