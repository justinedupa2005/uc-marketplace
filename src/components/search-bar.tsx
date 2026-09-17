import Image from "next/image";

export function SearchBar() {
  return (
    <form role="search" className="relative w-full">
      <label htmlFor="marketplace-search" className="sr-only">
        Search marketplace
      </label>
      <Image
        src="/assets/marketplace/search.svg"
        alt=""
        width={18}
        height={18}
        aria-hidden="true"
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
      />
      <input
        id="marketplace-search"
        name="query"
        type="search"
        placeholder="Search marketplace..."
        className="h-[57px] w-full rounded-lg border border-[#c4c5d5] bg-white py-3 pl-10 pr-4 text-base text-[#121c2a] shadow-sm outline-none placeholder:text-[#6b7280] focus:border-[#002576] focus:ring-2 focus:ring-[#002576]/15"
      />
    </form>
  );
}
