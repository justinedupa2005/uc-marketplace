"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

import { NavigationLink } from "@/components/navigation-blocker";

export function NotificationBellLink({ unreadCount }: { unreadCount: number | null }) {
  const pathname = usePathname();
  const label = unreadCount === null
    ? "Notifications (unread count unavailable)"
    : unreadCount > 0
      ? `Notifications, ${unreadCount} unread`
      : "Notifications";
  return (
    <NavigationLink
      href="/notifications"
      aria-label={label}
      aria-current={pathname === "/notifications" ? "page" : undefined}
      title={label}
      className="relative flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full hover:bg-[#e6eeff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8]"
    >
      <Image src="/assets/app/bell.svg" alt="" width={20} height={22} aria-hidden="true" />
      {unreadCount !== null && unreadCount > 0 && (
        <span aria-hidden="true" className="absolute right-0 top-0 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[#ba1a1a] px-1 text-[10px] font-bold leading-5 text-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </NavigationLink>
  );
}
