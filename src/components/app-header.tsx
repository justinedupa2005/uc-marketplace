import Image from "next/image";
import Link from "next/link";

type AppHeaderProps =
  | {
      variant?: "brand";
      showMenu?: boolean;
    }
  | {
      variant: "back";
      title: string;
      backHref?: string;
    };

const links = [
  { href: "/marketplace", label: "Marketplace" },
  { href: "/sell", label: "Sell" },
  { href: "/reservations", label: "Reservations" },
  { href: "/favorites", label: "Favorites" },
  { href: "/profile", label: "Profile" },
];

export function AppHeader(props: AppHeaderProps) {
  const isBack = props.variant === "back";

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-[#c4c5d5] bg-white">
      <div className="mx-auto flex h-full w-full max-w-[1280px] items-center justify-between px-6">
        <div className="flex min-w-0 items-center gap-2">
          {isBack ? (
            <>
              <Link
                href={props.backHref ?? "/marketplace"}
                aria-label="Go back to marketplace"
                className="flex size-9 items-center justify-center rounded-full hover:bg-[#e6eeff]"
              >
                <Image src="/assets/app/back.svg" alt="" width={16} height={16} />
              </Link>
              <h1 className="truncate text-lg font-bold text-[#002576]">{props.title}</h1>
            </>
          ) : (
            <>
              {props.showMenu && (
                <button
                  type="button"
                  aria-label="Open navigation menu"
                  className="flex size-9 items-center justify-center rounded-full hover:bg-[#e6eeff] md:hidden"
                >
                  <Image src="/assets/app/menu.svg" alt="" width={18} height={12} />
                </button>
              )}
              <Link href="/marketplace" className="flex items-center gap-2 font-bold text-[#002576]">
                <Image src="/assets/app/brand.svg" alt="" width={22} height={18} />
                <span className="whitespace-nowrap">UC Marketplace</span>
              </Link>
            </>
          )}
        </div>

        <nav aria-label="Primary navigation" className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-[#444653] hover:bg-[#e6eeff] hover:text-[#002576]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          aria-label={isBack ? "Open account settings" : "View notifications"}
          className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-[#e6eeff]"
        >
          <Image
            src={isBack ? "/assets/app/settings.svg" : "/assets/app/bell.svg"}
            alt=""
            width={isBack ? 20 : 16}
            height={20}
          />
        </button>
      </div>
    </header>
  );
}
