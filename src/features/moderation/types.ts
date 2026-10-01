export type ReportKind = "listing" | "student";
export type ReportStatus = "pending" | "reviewing" | "resolved" | "dismissed";
export type UserStatusFilter = "all" | "active" | "suspended" | "disabled";
export type ListingStatusFilter = "all" | "draft" | "available" | "reserved" | "sold" | "removed";
export type ReportStatusFilter = "all" | "open" | ReportStatus;

export type AdminDashboard = {
  pendingVerifications: number;
  openListingReports: number;
  openStudentReports: number;
  activeListings: number;
  suspendedUsers: number;
  error: boolean;
};

export type AdminUser = {
  id: string;
  fullName: string;
  role: string;
  verificationStatus: string;
  accountStatus: string;
  course: string | null;
  yearLevel: number | null;
  studentIdNumber: string | null;
  createdAt: string;
};

export type AdminListing = {
  id: string;
  title: string;
  description: string;
  price: number;
  condition: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  sellerId: string;
  sellerName: string;
  imageUrls: string[];
};

export type AdminReport = {
  id: string;
  kind: ReportKind;
  reporterId: string;
  reporterName: string;
  subjectId: string;
  subjectName: string;
  listingId: string | null;
  listingTitle: string | null;
  reason: string;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  adminNote: string | null;
};

export type PagedAdminResult<T> = {
  items: T[];
  totalCount: number;
  page: number;
  pageCount: number;
  error: boolean;
};

export type AdminDetailResult<T> = {
  item: T | null;
  error: boolean;
};

export type ModerationActionResult = { ok: boolean; message: string };
