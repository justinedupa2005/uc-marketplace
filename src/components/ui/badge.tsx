import type { ReactNode } from "react";

type BadgeTone = "neutral" | "available" | "pending";

type BadgeProps = {
  children: ReactNode;
  className?: string;
  tone?: BadgeTone;
};

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border border-[#c4c5d5] bg-white/90 text-[#121c2a] shadow-sm",
  available: "bg-[rgba(78,222,163,0.2)] text-[#003522]",
  pending: "bg-[rgba(255,222,170,0.5)] text-[#5f4100]",
};

export function Badge({
  children,
  className = "",
  tone = "neutral",
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-sm px-2 py-1 text-xs font-semibold tracking-[0.05em] ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
