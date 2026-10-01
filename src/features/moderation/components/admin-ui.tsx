import "server-only";

import type { ReactNode } from "react";
import Link from "next/link";

type QueryValue = string | string[] | undefined;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAdminUuid(value: string) {
  return uuidPattern.test(value);
}

export function oneQueryValue(value: QueryValue) {
  return typeof value === "string" ? value : undefined;
}

export function adminPageNumber(value: QueryValue) {
  const single = oneQueryValue(value);
  if (!single || !/^[1-9]\d{0,3}$/.test(single)) return 1;
  return Math.min(Number(single), 1000);
}

export function adminHref(
  path: string,
  filters: Record<string, string | undefined>,
  page = 1,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  if (page > 1) query.set("page", String(page));
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export function formatAdminDate(value: string | null | undefined) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(date);
}

export function formatAdminPrice(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value);
}

export function AdminPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#002576]">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#444653]">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function AdminFilterNav({
  label,
  path,
  selected,
  parameter,
  options,
  otherFilters = {},
  defaultValue = "all",
}: {
  label: string;
  path: string;
  selected: string;
  parameter: string;
  options: readonly (readonly [string, string])[];
  otherFilters?: Record<string, string | undefined>;
  defaultValue?: string;
}) {
  return (
    <nav aria-label={label} className="overflow-x-auto pb-1">
      <ul className="flex min-w-max gap-2">
        {options.map(([value, text]) => (
          <li key={value}>
            <Link
              href={adminHref(path, { ...otherFilters, [parameter]: value === defaultValue ? undefined : value })}
              aria-current={selected === value ? "page" : undefined}
              className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold ${
                selected === value
                  ? "border-[#0038a8] bg-[#0038a8] text-white"
                  : "border-[#c4c5d5] bg-white text-[#444653] hover:border-[#0038a8] hover:text-[#0038a8]"
              }`}
            >
              {text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AdminPagination({
  path,
  filters,
  page,
  pageCount,
  totalCount,
}: {
  path: string;
  filters: Record<string, string | undefined>;
  page: number;
  pageCount: number;
  totalCount: number;
}) {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label="Pages" className="mt-6 flex flex-wrap items-center justify-between gap-4 text-sm">
      <p className="text-[#444653]">Page {page} of {pageCount} · {totalCount} results</p>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={adminHref(path, filters, page - 1)} className="inline-flex min-h-11 items-center rounded-md border border-[#c4c5d5] bg-white px-4 font-semibold text-[#0038a8] hover:border-[#0038a8]">
            Previous
          </Link>
        )}
        {page < pageCount && (
          <Link href={adminHref(path, filters, page + 1)} className="inline-flex min-h-11 items-center rounded-md border border-[#c4c5d5] bg-white px-4 font-semibold text-[#0038a8] hover:border-[#0038a8]">
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}

export function AdminStatusBadge({ status }: { status: string }) {
  const tone = status === "pending" || status === "reviewing" || status === "reserved"
    ? "border-amber-200 bg-amber-50 text-amber-900"
    : status === "suspended" || status === "removed" || status === "rejected" || status === "dismissed" || status === "disabled"
      ? "border-red-200 bg-red-50 text-red-800"
      : status === "active" || status === "available" || status === "approved" || status === "resolved"
        ? "border-green-200 bg-green-50 text-green-800"
        : "border-[#c4c5d5] bg-[#f2f3f8] text-[#444653]";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${tone}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function AdminDetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-t border-[#e4e4ec] py-3 sm:grid sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm font-semibold text-[#444653]">{label}</dt>
      <dd className="mt-1 min-w-0 break-words text-sm sm:mt-0">{value}</dd>
    </div>
  );
}

export function AdminLoadError({ subject, retryHref }: { subject: string; retryHref: string }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
      <p className="font-semibold">Unable to load {subject}.</p>
      <p className="mt-1 text-sm">Please try again. No moderation changes were made.</p>
      <Link href={retryHref} className="mt-4 inline-flex min-h-11 items-center rounded-md border border-red-300 px-4 text-sm font-semibold hover:bg-red-100">
        Try again
      </Link>
    </div>
  );
}
