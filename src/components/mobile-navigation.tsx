import Image from "next/image";
import Link from "next/link";

type NavigationItem = "home" | "messages" | "sell" | "favorites" | "profile";

type MobileNavigationProps = {
  active?: NavigationItem;
  compact?: boolean;
};

const items: Array<{
  href: string;
  id: NavigationItem;
  label: string;
  icon: string;
  activeIcon?: string;
}> = [
  { href: "/marketplace", id: "home", label: "Home", icon: "nav-home.svg" },
  {
    href: "/messages",
    id: "messages",
    label: "Messages",
    icon: "nav-messages.svg",
  },
  {
    href: "/sell",
    id: "sell",
    label: "Sell",
    icon: "nav-sell.svg",
    activeIcon: "nav-sell-active.svg",
  },
  {
    href: "/favorites",
    id: "favorites",
    label: "Favorites",
    icon: "nav-favorites.svg",
    activeIcon: "nav-favorites-active.svg",
  },
  {
    href: "/profile",
    id: "profile",
    label: "Profile",
    icon: "nav-profile.svg",
    activeIcon: "nav-profile-active.svg",
  },
];

export function MobileNavigation({
  active = "home",
  compact = false,
}: MobileNavigationProps) {
  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-[#c4c5d5] bg-white px-3 py-1 md:hidden"
    >
      <ul className="mx-auto flex max-w-[390px] items-stretch justify-between">
        {items.map((item) => {
          const isActive = item.id === active;

          return (
            <li key={item.href} className="flex flex-1 justify-center">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                aria-label={compact ? item.label : undefined}
                className={`flex min-h-14 w-16 flex-col items-center justify-center rounded-xl px-1 py-1 text-[10px] font-medium tracking-[0.04em] ${
                  isActive ? "bg-[#feb71a]/20 text-[#002576]" : "text-[#444653]"
                }`}
              >
                <span className="flex size-6 items-center justify-center">
                  <Image
                    src={`/assets/app/${isActive && item.activeIcon ? item.activeIcon : item.icon}`}
                    alt=""
                    width={20}
                    height={20}
                    aria-hidden="true"
                    className="max-h-6 max-w-6"
                  />
                </span>
                {!compact && <span className="mt-0.5 leading-4">{item.label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
