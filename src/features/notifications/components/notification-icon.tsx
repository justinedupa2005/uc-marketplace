import type { NotificationType } from "@/features/notifications/rules";

export function NotificationIcon({
  type,
  className = "size-5",
}: {
  type: NotificationType | "empty";
  className?: string;
}) {
  let paths;

  switch (type) {
    case "message":
      paths = <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />;
      break;
    case "meetup_scheduled":
    case "meetup_updated":
      paths = (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 11h18m-13 5 2 2 5-5" />
        </>
      );
      break;
    case "reservation_requested":
      paths = (
        <>
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M8 12h8m-4-4v8" />
        </>
      );
      break;
    case "reservation_accepted":
    case "sale_completed":
    case "verification_approved":
    case "account_reactivated":
      paths = (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 3 3 5-6" />
        </>
      );
      break;
    case "reservation_rejected":
    case "reservation_cancelled":
    case "listing_removed":
      paths = (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m9 9 6 6m0-6-6 6" />
        </>
      );
      break;
    case "verification_rejected":
    case "account_suspended":
      paths = (
        <>
          <path d="m10.3 3.8-8.4 14a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3l-8.4-14a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4m0 4h.01" />
        </>
      );
      break;
    default:
      paths = (
        <>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21a2 2 0 0 0 4 0" />
        </>
      );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths}
    </svg>
  );
}
