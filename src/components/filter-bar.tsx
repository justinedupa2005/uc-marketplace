import Image from "next/image";

import { Button } from "@/components/ui/button";

export function FilterBar() {
  return (
    <div className="flex items-center justify-between py-2">
      <h2 className="text-lg font-semibold leading-7 text-[#121c2a]">
        Recent Listings
      </h2>
      <Button variant="ghost" className="gap-2 px-2 py-1 text-sm font-normal">
        <Image
          src="/assets/marketplace/filter.svg"
          alt=""
          width={14}
          height={9}
          aria-hidden="true"
        />
        Sort &amp; Filter
      </Button>
    </div>
  );
}
