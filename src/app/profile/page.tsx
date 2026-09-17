import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { MobileNavigation } from "@/components/mobile-navigation";

export const metadata: Metadata = {
  title: "Profile | UC Marketplace",
  description: "View your UC Marketplace profile and account options.",
};

const menuItems = [
  { label: "My Purchases", icon: "purchases.svg", href: "#purchases" },
  { label: "Account Settings", icon: "account.svg", href: "#settings" },
  { label: "Notification Preferences", icon: "notifications.svg", href: "#notifications" },
  { label: "Help Center", icon: "help.svg", href: "#help" },
];

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      <AppHeader variant="back" title="Profile" />

      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 pb-28 pt-8 md:pb-12">
        <section className="overflow-hidden rounded-xl border border-[#c4c5d5] bg-white shadow-sm">
          <div className="h-32 bg-[#0038a8]/10" />
          <div className="-mt-24 flex flex-col items-center px-6 pb-7 text-center">
            <div className="relative size-24 overflow-hidden rounded-full border-4 border-white shadow-sm">
              <Image
                src="/assets/app/profile-avatar.png"
                alt="Juan Dela Cruz"
                fill
                sizes="96px"
                className="object-cover"
                priority
              />
            </div>
            <h1 className="mt-5 text-2xl font-bold leading-8">Juan Dela Cruz</h1>
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#e6eeff] px-3 py-1 text-xs font-semibold tracking-[0.05em] text-[#002576]">
              <Image src="/assets/app/verified.svg" alt="" width={10} height={12} />
              Verified Student
            </span>
            <p className="mt-3 text-base leading-6 text-[#444653]">BS Computer Science - 3rd Year</p>

            <dl className="mt-6 flex w-full max-w-sm items-center justify-center border-t border-[#c4c5d5] pt-4">
              <div className="flex-1 px-4">
                <dd className="text-xl font-bold leading-7 text-[#002576]">12</dd>
                <dt className="text-sm leading-5 text-[#444653]">Items Sold</dt>
              </div>
              <div className="h-10 w-px bg-[#c4c5d5]" />
              <div className="flex-1 px-4">
                <dd className="flex items-center justify-center gap-1 text-xl font-bold leading-7 text-[#002576]">
                  4.9 <Image src="/assets/app/star.svg" alt="stars" width={15} height={15} />
                </dd>
                <dt className="text-sm leading-5 text-[#444653]">15 reviews</dt>
              </div>
            </dl>
          </div>
        </section>

        <nav aria-label="Profile settings" className="overflow-hidden rounded-xl border border-[#c4c5d5] bg-white shadow-sm">
          {menuItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="flex min-h-[73px] items-center border-b border-[#c4c5d5] px-6 text-lg transition last:border-b-0 hover:bg-[#f9f9ff]"
            >
              <span className="mr-4 flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e6eeff]">
                <Image src={`/assets/app/${item.icon}`} alt="" width={20} height={20} />
              </span>
              <span className="flex-1">{item.label}</span>
              <Image src="/assets/app/chevron-right.svg" alt="" width={8} height={12} />
            </Link>
          ))}
          <button
            type="button"
            className="flex min-h-[73px] w-full items-center px-6 text-left text-lg font-semibold text-[#ba1a1a] transition hover:bg-[#ba1a1a]/5"
          >
            <span className="mr-4 flex size-10 shrink-0 items-center justify-center rounded-full bg-[#ba1a1a]/10">
              <Image src="/assets/app/logout.svg" alt="" width={18} height={18} />
            </span>
            Logout
          </button>
        </nav>
      </main>

      <MobileNavigation active="profile" />
    </div>
  );
}
