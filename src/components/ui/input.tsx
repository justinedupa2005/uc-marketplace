import type { ComponentProps } from "react";

type InputProps = ComponentProps<"input"> & {
  invalid?: boolean;
};

export function Input({ className = "", invalid = false, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={`h-12 w-full rounded-md border bg-white px-4 text-base text-[#121c2a] outline-none transition placeholder:text-[#747685] focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8] ${
        invalid ? "border-[#ba1a1a]" : "border-[#c4c5d5]"
      } ${className}`}
      {...props}
    />
  );
}
