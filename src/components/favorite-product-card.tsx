import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type FavoriteProduct = {
  id: number;
  title: string;
  price: string;
  condition: string;
  image: string;
  imageAlt: string;
};

export function FavoriteProductCard({ product }: { product: FavoriteProduct }) {
  return (
    <article className="overflow-hidden rounded-xl border border-[#c4c5d5] bg-white">
      <div className="relative aspect-[5/4] overflow-hidden bg-[#eff3ff] sm:aspect-[4/3]">
        <Image
          src={product.image}
          alt={product.imageAlt}
          fill
          sizes="(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 25vw"
          className="object-cover"
        />
        <Badge className="absolute right-2 top-2 rounded-full border-[#c4c5d5]/50 bg-[#d9e3f7]/90 px-3 py-2 text-[#444653] backdrop-blur-sm">
          {product.condition}
        </Badge>
      </div>
      <div className="flex min-h-[118px] flex-col p-4">
        <h2 className="line-clamp-2 min-h-10 text-sm leading-5 text-[#121c2a] sm:text-base">
          {product.title}
        </h2>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <p className="text-base font-bold leading-6 text-[#002576] sm:text-lg">{product.price}</p>
          <Button
            variant="icon"
            aria-label={`Remove ${product.title} from favorites`}
            className="size-8 rounded-full p-1"
          >
            <Image src="/assets/app/favorite-filled.svg" alt="" width={20} height={19} />
          </Button>
        </div>
      </div>
    </article>
  );
}
