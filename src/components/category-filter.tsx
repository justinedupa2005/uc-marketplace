import Link from "next/link";

import type { MarketplaceCategory } from "@/lib/listings";

function marketplaceUrl({
  categoryId,
  query,
  sort,
}: {
  categoryId?: string;
  query?: string;
  sort?: string;
}) {
  const params = new URLSearchParams();
  if (categoryId) params.set("category", categoryId);
  if (query) params.set("query", query);
  if (sort && sort !== "newest") params.set("sort", sort);
  const search = params.toString();
  return search ? `/marketplace?${search}` : "/marketplace";
}

export function CategoryFilter({
  categories,
  selectedCategoryId,
  query,
  sort,
}: {
  categories: MarketplaceCategory[];
  selectedCategoryId?: string;
  query?: string;
  sort?: string;
}) {
  const options = [{ id: undefined, name: "All Items" }, ...categories];

  return (
    <nav aria-label="Marketplace categories" className="-mx-1 overflow-x-auto py-2">
      <div className="flex w-max gap-2 px-1">
        {options.map((category) => {
          const selected = category.id === selectedCategoryId;
          return (
          <Link
            key={category.id ?? "all"}
            href={marketplaceUrl({ categoryId: category.id, query, sort })}
            aria-current={selected ? "page" : undefined}
            className={`inline-flex h-[34px] items-center rounded-full border px-4 text-xs font-semibold tracking-[0.05em] transition ${selected ? "border-[#0038a8] bg-[#0038a8] text-white" : "border-[#c4c5d5] bg-white text-[#0038a8] hover:bg-[#edf2ff]"}`}
          >
            {category.name}
          </Link>
          );
        })}
      </div>
    </nav>
  );
}
