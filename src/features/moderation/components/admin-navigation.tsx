"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  ["/admin", "Overview"],
  ["/admin/reports", "Reports"],
  ["/admin/users", "Users"],
  ["/admin/listings", "Listings"],
  ["/admin/verifications", "Verifications"],
] as const;

export function AdminNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin sections" className="mx-auto max-w-6xl overflow-x-auto px-5 sm:px-8">
      <ul className="flex min-w-max gap-1 text-sm font-semibold">
        {sections.map(([href, label]) => {
          const selected = href === "/admin"
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={selected ? "page" : undefined}
                className={`inline-flex min-h-11 items-center border-b-[3px] px-3 pt-1 transition-colors ${
                  selected
                    ? "border-[#0038a8] text-[#002576]"
                    : "border-transparent text-[#444653] hover:border-[#c4c5d5] hover:text-[#002576]"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
