import type { ReactNode } from "react";

type FormNotificationProps = {
  children: ReactNode;
  variant: "error" | "success";
};

export function FormNotification({
  children,
  variant,
}: FormNotificationProps) {
  const isSuccess = variant === "success";

  return (
    <div
      role={isSuccess ? "status" : "alert"}
      aria-live={isSuccess ? "polite" : "assertive"}
      className={`flex items-start gap-3 rounded-md border px-3 py-3 text-sm leading-5 ${
        isSuccess
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
          isSuccess ? "bg-emerald-600" : "bg-red-600"
        }`}
      >
        {isSuccess ? "\u2713" : "!"}
      </span>
      <span>{children}</span>
    </div>
  );
}
