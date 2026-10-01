import "server-only";

import { signListingImagePaths } from "@/features/listings/server/media";
import {
  ADMIN_PAGE_SIZE,
  getAdminPage,
  getAdminPageCount,
  getAdminSearch,
  getListingStatusFilter,
  getReportKind,
  getReportStatusFilter,
  getUserStatusFilter,
  isModerationId,
} from "@/features/moderation/rules";
import type {
  AdminDashboard,
  AdminDetailResult,
  AdminListing,
  AdminReport,
  AdminUser,
  ListingStatusFilter,
  PagedAdminResult,
  ReportKind,
  ReportStatus,
  ReportStatusFilter,
  UserStatusFilter,
} from "@/features/moderation/types";
import { requireActiveAdmin } from "@/lib/auth/authorization";

type UserRow = {
  id: string;
  full_name: string | null;
  role: string;
  verification_status: string;
  account_status: string;
  course: string | null;
  year_level: number | null;
  student_id_number?: string | null;
  created_at: string;
};

type ListingRow = {
  id: string;
  title: string;
  description: string;
  price: number;
  condition: string;
  status: string;
  created_at: string;
  updated_at: string;
  seller_id: string;
};

type ReportRow = {
  id: string;
  reporter_id: string;
  seller_id?: string;
  subject_id?: string;
  listing_id?: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

const userSelection = "id,full_name,role,verification_status,account_status,course,year_level,created_at";
const listingSelection = "id,title,description,price,condition,status,created_at,updated_at,seller_id";
const listingReportSelection = "id,reporter_id,seller_id,listing_id,reason,details,status,created_at,updated_at,reviewed_at,reviewed_by";
const studentReportSelection = "id,reporter_id,subject_id,reason,details,status,created_at,updated_at,reviewed_at,reviewed_by";

function emptyPage<T>(page: number): PagedAdminResult<T> {
  return { items: [], totalCount: 0, page, pageCount: 1, error: true };
}

function pageNumber(value: number) {
  return getAdminPage(String(value));
}

function mapUser(row: UserRow): AdminUser {
  return {
    id: row.id,
    fullName: row.full_name?.trim() || "Unnamed student",
    role: row.role,
    verificationStatus: row.verification_status,
    accountStatus: row.account_status,
    course: row.course,
    yearLevel: row.year_level,
    studentIdNumber: row.student_id_number ?? null,
    createdAt: row.created_at,
  };
}

function mapListing(row: ListingRow, names: Map<string, string>, imageUrls: string[] = []): AdminListing {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price: row.price,
    condition: row.condition,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sellerId: row.seller_id,
    sellerName: names.get(row.seller_id) ?? "Former student",
    imageUrls,
  };
}

function toReportStatus(value: string): ReportStatus {
  if (value === "reviewing" || value === "resolved" || value === "dismissed") return value;
  return "pending";
}

function mapReport(
  row: ReportRow,
  kind: ReportKind,
  names: Map<string, string>,
  titles: Map<string, string>,
  adminNote: string | null = null,
): AdminReport {
  const subjectId = kind === "listing" ? row.seller_id! : row.subject_id!;
  const listingId = kind === "listing" ? row.listing_id! : null;
  return {
    id: row.id,
    kind,
    reporterId: row.reporter_id,
    reporterName: names.get(row.reporter_id) ?? "Former student",
    subjectId,
    subjectName: names.get(subjectId) ?? "Former student",
    listingId,
    listingTitle: listingId ? (titles.get(listingId) ?? "Removed listing") : null,
    reason: row.reason,
    details: row.details,
    status: toReportStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    adminNote,
  };
}

export async function getAdminDashboard(): Promise<AdminDashboard> {
  const { supabase } = await requireActiveAdmin("/admin");
  const [verifications, listingReports, studentReports, listings, users] = await Promise.all([
    supabase.from("verifications").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("listing_reports").select("id", { count: "exact", head: true }).in("status", ["pending", "reviewing"]),
    supabase.from("student_reports").select("id", { count: "exact", head: true }).in("status", ["pending", "reviewing"]),
    supabase.from("listings").select("id", { count: "exact", head: true }).in("status", ["available", "reserved"]),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student").eq("account_status", "suspended"),
  ]);
  const error = Boolean(verifications.error || listingReports.error || studentReports.error || listings.error || users.error);
  if (error) console.warn("Unable to load moderation dashboard");
  return {
    pendingVerifications: verifications.count ?? 0,
    openListingReports: listingReports.count ?? 0,
    openStudentReports: studentReports.count ?? 0,
    activeListings: listings.count ?? 0,
    suspendedUsers: users.count ?? 0,
    error,
  };
}

export async function getAdminUsers({
  status = "all", page = 1, query = "",
}: {
  status?: UserStatusFilter;
  page?: number;
  query?: string;
} = {}): Promise<PagedAdminResult<AdminUser>> {
  const { supabase } = await requireActiveAdmin("/admin/users");
  const requestedPage = pageNumber(page);
  const selectedStatus = getUserStatusFilter(status);
  const search = getAdminSearch(query);
  let request = supabase.from("profiles")
    .select(userSelection, { count: "exact" })
    .eq("role", "student");
  if (selectedStatus !== "all") request = request.eq("account_status", selectedStatus);
  if (search) request = request.ilike("full_name", `%${search}%`);
  const { data, count, error } = await request
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((requestedPage - 1) * ADMIN_PAGE_SIZE, requestedPage * ADMIN_PAGE_SIZE - 1);
  if (error) {
    console.warn("Unable to load students", { code: error.code });
    return emptyPage(requestedPage);
  }
  const totalCount = count ?? 0;
  return { items: ((data ?? []) as UserRow[]).map(mapUser), totalCount, page: requestedPage, pageCount: getAdminPageCount(totalCount), error: false };
}

export async function getAdminUser(id: string): Promise<AdminDetailResult<AdminUser>> {
  const { supabase } = await requireActiveAdmin("/admin/users");
  if (!isModerationId(id)) return { item: null, error: false };
  const { data, error } = await supabase.from("profiles")
    .select(`${userSelection},student_id_number`)
    .eq("id", id).eq("role", "student").maybeSingle();
  if (error) {
    console.warn("Unable to load student", { code: error.code });
    return { item: null, error: true };
  }
  return { item: data ? mapUser(data as UserRow) : null, error: false };
}

export async function getAdminListings({
  status = "all", page = 1, query = "",
}: {
  status?: ListingStatusFilter;
  page?: number;
  query?: string;
} = {}): Promise<PagedAdminResult<AdminListing>> {
  const { supabase } = await requireActiveAdmin("/admin/listings");
  const requestedPage = pageNumber(page);
  const selectedStatus = getListingStatusFilter(status);
  const search = getAdminSearch(query);
  let request = supabase.from("listings").select(listingSelection, { count: "exact" });
  if (selectedStatus !== "all") request = request.eq("status", selectedStatus);
  if (search) request = request.ilike("title", `%${search}%`);
  const { data, count, error } = await request
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((requestedPage - 1) * ADMIN_PAGE_SIZE, requestedPage * ADMIN_PAGE_SIZE - 1);
  if (error) {
    console.warn("Unable to load moderation listings", { code: error.code });
    return emptyPage(requestedPage);
  }
  const rows = (data ?? []) as ListingRow[];
  const sellerIds = [...new Set(rows.map((row) => row.seller_id))];
  const names = new Map<string, string>();
  if (sellerIds.length) {
    const sellers = await supabase.from("profiles").select("id,full_name").in("id", sellerIds);
    if (sellers.error) {
      console.warn("Unable to load listing owners", { code: sellers.error.code });
      return emptyPage(requestedPage);
    }
    for (const seller of sellers.data ?? []) names.set(seller.id, seller.full_name || "Unnamed student");
  }
  const totalCount = count ?? 0;
  return { items: rows.map((row) => mapListing(row, names)), totalCount, page: requestedPage, pageCount: getAdminPageCount(totalCount), error: false };
}

export async function getAdminListing(id: string): Promise<AdminDetailResult<AdminListing>> {
  const { supabase } = await requireActiveAdmin("/admin/listings");
  if (!isModerationId(id)) return { item: null, error: false };
  const { data, error } = await supabase.from("listings")
    .select(listingSelection).eq("id", id).maybeSingle();
  if (error) {
    console.warn("Unable to load moderation listing", { code: error.code });
    return { item: null, error: true };
  }
  if (!data) return { item: null, error: false };
  const row = data as ListingRow;
  const [seller, images] = await Promise.all([
    supabase.from("profiles").select("id,full_name").eq("id", row.seller_id).maybeSingle(),
    supabase.from("listing_images").select("storage_path").eq("listing_id", id).order("sort_order", { ascending: true }),
  ]);
  if (seller.error || images.error) {
    console.warn("Unable to load moderation listing context");
    return { item: null, error: true };
  }
  const paths = (images.data ?? []).map((image) => image.storage_path);
  const signed = await signListingImagePaths(supabase, paths);
  return {
    item: mapListing(
      row,
      new Map([[row.seller_id, seller.data?.full_name || "Unnamed student"]]),
      paths.map((path) => signed.urls.get(path)).filter((url): url is string => Boolean(url)),
    ),
    error: false,
  };
}

async function getReportContext(
  supabase: Awaited<ReturnType<typeof requireActiveAdmin>>["supabase"],
  rows: ReportRow[],
  kind: ReportKind,
): Promise<{ names: Map<string, string>; titles: Map<string, string> } | null> {
  const userIds = [...new Set(rows.flatMap((row) => [row.reporter_id, kind === "listing" ? row.seller_id! : row.subject_id!]))];
  const listingIds = kind === "listing" ? [...new Set(rows.map((row) => row.listing_id!))] : [];
  const [profiles, listings] = await Promise.all([
    userIds.length
      ? supabase.from("profiles").select("id,full_name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    listingIds.length
      ? supabase.from("listings").select("id,title").in("id", listingIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profiles.error || listings.error) {
    console.warn("Unable to load report context");
    return null;
  }
  const names = new Map<string, string>();
  for (const profile of profiles.data ?? []) names.set(profile.id, profile.full_name || "Unnamed student");
  const titles = new Map<string, string>();
  for (const listing of listings.data ?? []) titles.set(listing.id, listing.title);
  return { names, titles };
}

export async function getAdminReports({
  kind = "listing", status = "open", page = 1,
}: {
  kind?: ReportKind;
  status?: ReportStatusFilter;
  page?: number;
} = {}): Promise<PagedAdminResult<AdminReport>> {
  const { supabase } = await requireActiveAdmin("/admin/reports");
  const selectedKind = getReportKind(kind);
  const selectedStatus = getReportStatusFilter(status);
  const requestedPage = pageNumber(page);
  let request = selectedKind === "listing"
    ? supabase.from("listing_reports").select(listingReportSelection, { count: "exact" })
    : supabase.from("student_reports").select(studentReportSelection, { count: "exact" });
  if (selectedStatus === "open") request = request.in("status", ["pending", "reviewing"]);
  else if (selectedStatus !== "all") request = request.eq("status", selectedStatus);
  const { data, count, error } = await request
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((requestedPage - 1) * ADMIN_PAGE_SIZE, requestedPage * ADMIN_PAGE_SIZE - 1);
  if (error) {
    console.warn("Unable to load reports", { code: error.code });
    return emptyPage(requestedPage);
  }
  const rows = (data ?? []) as ReportRow[];
  const context = await getReportContext(supabase, rows, selectedKind);
  if (!context) return emptyPage(requestedPage);
  const totalCount = count ?? 0;
  return {
    items: rows.map((row) => mapReport(row, selectedKind, context.names, context.titles)),
    totalCount, page: requestedPage, pageCount: getAdminPageCount(totalCount), error: false,
  };
}

export async function getAdminReport(kind: ReportKind, id: string): Promise<AdminDetailResult<AdminReport>> {
  const { supabase } = await requireActiveAdmin("/admin/reports");
  if (!isModerationId(id) || (kind !== "listing" && kind !== "student")) return { item: null, error: false };
  const result = kind === "listing"
    ? await supabase.from("listing_reports").select(listingReportSelection).eq("id", id).maybeSingle()
    : await supabase.from("student_reports").select(studentReportSelection).eq("id", id).maybeSingle();
  if (result.error) {
    console.warn("Unable to load report", { code: result.error.code });
    return { item: null, error: true };
  }
  if (!result.data) return { item: null, error: false };
  const row = result.data as ReportRow;
  const [context, privateNote] = await Promise.all([
    getReportContext(supabase, [row], kind),
    supabase.rpc("get_admin_report_note", { p_kind: kind, p_report_id: id }),
  ]);
  if (!context || privateNote.error) {
    console.warn("Unable to load report review context", { code: privateNote.error?.code });
    return { item: null, error: true };
  }
  return { item: mapReport(row, kind, context.names, context.titles, privateNote.data), error: false };
}
