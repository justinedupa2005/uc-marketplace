import type { ReactNode } from "react";

export function ListingFormSection({
  id,
  eyebrow,
  step,
  title,
  description,
  children,
  contentClassName = "mt-6",
}: {
  id: string;
  eyebrow?: string;
  step?: number;
  title: string;
  description?: string;
  children: ReactNode;
  contentClassName?: string;
}) {
  const eyebrowText = eyebrow ?? (step ? `Step ${step}` : undefined);

  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      className="rounded-xl border border-[#c4c5d5]/60 bg-white p-5 shadow-sm outline-none focus:ring-2 focus:ring-[#0038a8]/30 sm:p-7"
    >
      <div className={eyebrowText ? "border-b border-[#c4c5d5]/40 pb-4" : ""}>
        {eyebrowText && (
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#0038a8]">
            {eyebrowText}
          </p>
        )}
        <h2
          id={`${id}-title`}
          className={`${eyebrowText ? "mt-1" : ""} text-xl font-bold leading-7 text-[#121c2a]`}
        >
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm leading-5 text-[#5b6070]">
            {description}
          </p>
        )}
      </div>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
