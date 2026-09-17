import { Button } from "@/components/ui/button";

const categories = [
  "All Items",
  "Books",
  "PE Uniforms",
  "School Uniforms",
  "Supplies",
  "Electronics",
  "Accessories",
  "Others",
];

export function CategoryFilter() {
  return (
    <nav aria-label="Marketplace categories" className="-mx-1 overflow-x-auto py-2">
      <div className="flex w-max gap-2 px-1">
        {categories.map((category, index) => (
          <Button
            key={category}
            variant={index === 0 ? "primary" : "secondary"}
            aria-pressed={index === 0}
            className="h-[34px] rounded-full px-4 text-xs tracking-[0.05em]"
          >
            {category}
          </Button>
        ))}
      </div>
    </nav>
  );
}
