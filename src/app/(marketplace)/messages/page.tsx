import type { Metadata } from "next";

import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Messages | UC Marketplace",
  description: "Student marketplace conversations.",
};

export default async function MessagesPage() {
  await requireVerifiedActiveStudent("/messages");

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f9f9ff] px-6 pb-28 pt-10 text-[#121c2a] md:pb-12">
      <section className="mx-auto w-full max-w-3xl">
        <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#002576]">
          Messages
        </h1>
        <div className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-bold">No conversations yet</h2>
          <p className="mt-2 text-sm leading-6 text-[#444653]">
            Secure student messaging will be connected in a later marketplace step.
          </p>
        </div>
      </section>
    </main>
  );
}
