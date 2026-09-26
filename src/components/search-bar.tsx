import Image from "next/image";

export function SearchBar({
  defaultValue = "",
  categoryId,
  sort,
}: {
  defaultValue?: string;
  categoryId?: string;
  sort?: string;
}) {
  return (
    <form action="/marketplace" method="get" role="search" className="relative w-full">
      {categoryId && <input type="hidden" name="category" value={categoryId} />}
      {sort && sort !== "newest" && <input type="hidden" name="sort" value={sort} />}
      <label htmlFor="marketplace-search" className="sr-only">
        Search marketplace
      </label>
      <button
        type="submit"
        aria-label="Search marketplace"
        className="absolute left-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-[#0038a8]"
      >
        <Image
          src="/assets/marketplace/search.svg"
          alt=""
          width={18}
          height={18}
          aria-hidden="true"
        />
      </button>
      <input
        id="marketplace-search"
        name="query"
        type="search"
        defaultValue={defaultValue}
        maxLength={80}
        placeholder="Search marketplace..."
        className="h-[57px] w-full rounded-lg border border-[#c4c5d5] bg-white py-3 pl-10 pr-4 text-base text-[#121c2a] shadow-sm outline-none placeholder:text-[#6b7280] focus:border-[#002576] focus:ring-2 focus:ring-[#002576]/15"
      />
    </form>
  );
}
