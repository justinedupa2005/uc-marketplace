import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";

const desktopLinks = [
  { href: "/marketplace", label: "Home" },
  { href: "/sell", label: "Sell" },
  { href: "/messages", label: "Messages" },
  { href: "/favorites", label: "Saved" },
  { href: "/my-listings", label: "My Items" },
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 h-16 border-b border-[#e1e2ea] bg-[#f9f9ff]/95 shadow-[0_1px_1px_rgba(0,0,0,0.05)] backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-6">
        <Button
          variant="icon"
          aria-label="Open navigation menu"
          className="size-[34px] rounded-full p-2 md:hidden"
        >
          <Image
            src="/assets/marketplace/menu.svg"
            alt=""
            width={18}
            height={12}
            aria-hidden="true"
          />
        </Button>

        <Link
          href="/marketplace"
          className="text-2xl font-bold leading-9 text-[#002576]"
        >
          UC-Market
        </Link>

        <nav aria-label="Primary navigation" className="hidden items-center gap-1 md:flex">
          {desktopLinks.map((link, index) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={index === 0 ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors hover:bg-[#e9effb] ${
                index === 0 ? "text-[#002576]" : "text-[#444653]"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <Button
          variant="icon"
          aria-label="Search marketplace"
          className="size-[34px] rounded-full p-2"
        >
          <Image
            src="/assets/marketplace/header-search.svg"
            alt=""
            width={18}
            height={18}
            aria-hidden="true"
          />
        </Button>
      </div>
    </header>
  );
}
