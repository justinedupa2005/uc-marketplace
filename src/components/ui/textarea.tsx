import type { ComponentProps } from "react";

type TextareaProps = ComponentProps<"textarea"> & {
  invalid?: boolean;
};

export function Textarea({
  className = "",
  invalid = false,
  ...props
}: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={`w-full resize-y rounded-md border bg-white p-4 text-base text-[#121c2a] outline-none transition placeholder:text-[#747685] focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8] ${
        invalid ? "border-[#ba1a1a]" : "border-[#c4c5d5]"
      } ${className}`}
      {...props}
    />
  );
}
