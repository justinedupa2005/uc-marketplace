import { Badge } from "@/components/ui/badge";
import {
  formatListingCondition,
  getListingStatusLabel,
  isListingStatus,
  type ListingStatus,
  type ListingStatusLabel,
} from "@/lib/listing-rules";

function normalizeStatus(
  status: ListingStatus | ListingStatusLabel,
): ListingStatus {
  if (isListingStatus(status)) {
    return status;
  }

  return status.toLowerCase() as ListingStatus;
}

export function ConditionBadge({ condition }: { condition: string }) {
  return <Badge tone="neutral">{formatListingCondition(condition)}</Badge>;
}

export function ListingStatusBadge({
  status,
}: {
  status: ListingStatus | ListingStatusLabel;
}) {
  const normalized = normalizeStatus(status);
  const tone =
    normalized === "available"
      ? "available"
      : normalized === "reserved" || normalized === "draft"
        ? "pending"
        : "neutral";
  const emphasis =
    normalized === "removed"
      ? "border-red-200 bg-red-50 text-red-800"
      : normalized === "sold"
        ? "border-slate-300 bg-slate-100 text-slate-700"
        : "";

  return (
    <Badge tone={tone} className={emphasis}>
      {getListingStatusLabel(normalized)}
    </Badge>
  );
}
