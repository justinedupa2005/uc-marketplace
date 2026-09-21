import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { MobileNavigation } from "@/components/mobile-navigation";
import { Button } from "@/components/ui/button";
import { getValidatedUser } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "Sell an Item | UC Marketplace",
  description: "Create a new student marketplace listing.",
};

const inputClass =
  "h-[42px] w-full border border-[#c4c5d5] bg-white px-4 text-base text-[#121c2a] outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15";

function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="rounded-xl border border-[#c4c5d5]/30 bg-white p-4 shadow-sm sm:p-6">
      <legend className="sr-only">{title}</legend>
      <h2 className="border-b border-[#c4c5d5]/30 pb-2 text-xl font-semibold leading-7 text-[#121c2a]">
        {title}
      </h2>
      <div className="mt-6">{children}</div>
    </fieldset>
  );
}

export default async function SellPage() {
  const { supabase, user } = await getValidatedUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("role, account_status, verification_status")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };
  const canSell =
    profile?.role === "student" &&
    profile.account_status === "active" &&
    profile.verification_status === "verified";

  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      <AppHeader />

      <main className="mx-auto w-full max-w-3xl px-6 pb-28 pt-6 sm:pt-10 md:pb-12">
        <header>
          <h1 className="text-3xl font-bold tracking-[-0.02em] sm:text-4xl">Sell an Item</h1>
          <p className="mt-2 max-w-sm text-base leading-6 text-[#444653]">
            List your item securely on the student marketplace.
          </p>
        </header>

        {!canSell ? (
          <section className="mt-8 rounded-xl border border-[#c4c5d5] bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-xl font-semibold text-[#002576]">
              Student verification is required to sell
            </h2>
            <p className="mt-3 leading-6 text-[#444653]">
              Only active, verified student accounts can create listings. Your
              verification status is also enforced by the database.
            </p>
            {profile?.role === "student" && (
              <Link
                href="/verification"
                className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-[#0038a8] px-5 text-sm font-semibold text-white hover:bg-[#002576]"
              >
                View Verification Status
              </Link>
            )}
          </section>
        ) : (
        <form className="mt-8 space-y-7">
          <FormSection title="Step 1: Item Details">
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold tracking-[0.05em] text-[#444653]">
                  Item Title
                </span>
                <input
                  name="title"
                  type="text"
                  placeholder="e.g. Calculus 8th Edition"
                  className={inputClass}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold tracking-[0.05em] text-[#444653]">
                    Category
                  </span>
                  <span className="relative block">
                    <select name="category" defaultValue="" className={`${inputClass} appearance-none pr-10`}>
                      <option value="" disabled>Select category...</option>
                      <option>Books</option>
                      <option>Electronics</option>
                      <option>Uniforms</option>
                      <option>School Supplies</option>
                    </select>
                    <Image
                      src="/assets/app/dropdown.svg"
                      alt=""
                      width={24}
                      height={24}
                      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
                    />
                  </span>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold tracking-[0.05em] text-[#444653]">
                    Condition
                  </span>
                  <span className="relative block">
                    <select name="condition" defaultValue="" className={`${inputClass} appearance-none pr-10`}>
                      <option value="" disabled>Select condition...</option>
                      <option>New</option>
                      <option>Like New</option>
                      <option>Good</option>
                      <option>Used</option>
                    </select>
                    <Image
                      src="/assets/app/dropdown.svg"
                      alt=""
                      width={24}
                      height={24}
                      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
                    />
                  </span>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold tracking-[0.05em] text-[#444653]">
                  Price (₱)
                </span>
                <span className="relative block">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#444653]">₱</span>
                  <input
                    name="price"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className={`${inputClass} pl-9`}
                  />
                </span>
              </label>
            </div>
          </FormSection>

          <FormSection title="Step 2: Photos">
            <label className="flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#c4c5d5] px-6 text-center transition hover:border-[#0038a8] hover:bg-[#f9f9ff]">
              <Image src="/assets/app/upload-camera.svg" alt="" width={40} height={36} />
              <span className="mt-3 font-semibold">Click to upload photos</span>
              <span className="mt-1 text-xs text-[#444653]">PNG, JPG up to 5MB</span>
              <input type="file" name="photos" accept="image/png,image/jpeg" multiple className="sr-only" />
            </label>
          </FormSection>

          <FormSection title="Step 3: Description">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold tracking-[0.05em] text-[#444653]">
                Item Description
              </span>
              <textarea
                name="description"
                rows={5}
                placeholder="Describe the item, including any flaws, dimensions, or other important details..."
                className="w-full resize-y border border-[#c4c5d5] bg-white p-4 text-base leading-6 text-[#121c2a] outline-none transition focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15"
              />
            </label>
          </FormSection>

          <div className="flex items-center justify-end gap-4">
            <Button variant="ghost" type="reset" className="h-10 px-5 text-xs tracking-[0.05em]">
              Cancel
            </Button>
            <Button type="submit" className="h-10 px-6 text-xs tracking-[0.05em]">
              Post Listing
            </Button>
          </div>
        </form>
        )}
      </main>

      <MobileNavigation active="sell" />
    </div>
  );
}
