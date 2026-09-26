import { Pagination } from "@/components/pagination";
import {
  buildMarketplaceUrl,
  type MarketplaceUrlValues,
} from "@/lib/marketplace-search-params";

export function MarketplacePagination({
  values,
  totalPages,
}: {
  values: MarketplaceUrlValues;
  totalPages: number;
}) {
  return (
    <Pagination
      currentPage={values.page}
      totalPages={totalPages}
      hrefForPage={(page) => buildMarketplaceUrl(values, { page })}
      ariaLabel="Marketplace result pages"
    />
  );
}
