import type { ReactNode } from "react";

export function FieldError({
  id,
  children,
  message,
  className = "",
}: {
  id?: string;
  children?: ReactNode;
  message?: ReactNode;
  className?: string;
}) {
  const content = children ?? message;
  if (!content) return null;

  return (
    <p
      id={id}
      role="alert"
      className={`mt-2 text-sm leading-5 text-[#ba1a1a] ${className}`}
    >
      {content}
    </p>
  );
}
