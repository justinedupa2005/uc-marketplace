const priceFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

export function formatListingPrice(value: number | string) {
  return priceFormatter.format(Number(value));
}
