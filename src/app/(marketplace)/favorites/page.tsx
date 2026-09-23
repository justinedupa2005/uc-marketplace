import type { Metadata } from "next";

import {
  FavoriteProductCard,
  type FavoriteProduct,
} from "@/components/favorite-product-card";
import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Favorites | UC Marketplace",
  description: "View items saved from the UC Marketplace.",
};

const favorites: FavoriteProduct[] = [
  {
    id: 1,
    title: "Calculus Textbook 9th Edition",
    price: "₱500",
    condition: "Good",
    image: "/assets/app/favorite-calculus.png",
    imageAlt: "Calculus textbook on a desk",
  },
  {
    id: 2,
    title: "Scientific Calculator FX-991EX",
    price: "₱400",
    condition: "Like New",
    image: "/assets/app/favorite-calculator.png",
    imageAlt: "Scientific calculator on graph paper",
  },
  {
    id: 3,
    title: "Architecture Drafting Kit Complete",
    price: "₱1,200",
    condition: "New",
    image: "/assets/app/favorite-drafting.png",
    imageAlt: "Architecture drafting tools arranged on a desk",
  },
  {
    id: 4,
    title: "Lab Goggles & Chemistry Coat",
    price: "₱350",
    condition: "Used",
    image: "/assets/app/favorite-lab.png",
    imageAlt: "Protective chemistry coat and safety goggles",
  },
];

export default async function FavoritesPage() {
  await requireVerifiedActiveStudent("/favorites");

  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#121c2a]">
      <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-7xl px-6 pb-28 pt-12 md:pb-12">
        <header>
          <h1 className="text-2xl font-bold leading-8">Favorites</h1>
          <p className="mt-2 text-sm leading-5 text-[#444653]">Items you&apos;ve saved for later.</p>
        </header>

        <section
          aria-label="Favorite marketplace listings"
          className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
        >
          {favorites.map((product) => (
            <FavoriteProductCard key={product.id} product={product} />
          ))}
        </section>
      </main>
    </div>
  );
}
