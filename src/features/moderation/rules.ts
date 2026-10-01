import type {
  ListingStatusFilter,
  ReportKind,
  ReportStatusFilter,
  UserStatusFilter,
} from "./types";

export const STUDENT_REPORT_REASONS = [
  "scam",
  "harassment",
  "abusive_behavior",
  "impersonation",
  "unsafe_meetup",
  "spam",
  "other",
] as const;

export type StudentReportReason = (typeof STUDENT_REPORT_REASONS)[number];

export const ADMIN_PAGE_SIZE = 20;
const MAX_ADMIN_PAGE = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const userStatuses = ["all", "active", "suspended", "disabled"] as const;
const listingStatuses = ["all", "draft", "available", "reserved", "sold", "removed"] as const;
const reportStatuses = ["open", "all", "pending", "reviewing", "resolved", "dismissed"] as const;

export function isModerationId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function getAdminPage(value: string | string[] | undefined): number {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || !/^[1-9]\d*$/.test(first)) return 1;
  const parsed = Number(first);
  return Number.isSafeInteger(parsed) && parsed <= MAX_ADMIN_PAGE ? parsed : 1;
}

export function getUserStatusFilter(value: string | undefined): UserStatusFilter {
  return userStatuses.find((status) => status === value) ?? "all";
}

export function getListingStatusFilter(value: string | undefined): ListingStatusFilter {
  return listingStatuses.find((status) => status === value) ?? "all";
}

export function getReportStatusFilter(value: string | undefined): ReportStatusFilter {
  return reportStatuses.find((status) => status === value) ?? "open";
}

export function getReportKind(value: string | undefined): ReportKind {
  return value === "student" ? "student" : "listing";
}

export function getAdminSearch(value: string | undefined): string {
  return typeof value === "string"
    ? value.trim().replace(/[%_\\,]/g, "").slice(0, 80)
    : "";
}

export function getAdminPageCount(totalCount: number): number {
  return Math.max(1, Math.ceil(totalCount / ADMIN_PAGE_SIZE));
}

export function getAdminPageHref(
  route: "users" | "listings" | "reports",
  page: number,
  filters: Record<string, string> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  if (Number.isSafeInteger(page) && page > 1 && page <= MAX_ADMIN_PAGE) {
    params.set("page", String(page));
  }
  const search = params.toString();
  return `/admin/${route}${search ? `?${search}` : ""}`;
}
