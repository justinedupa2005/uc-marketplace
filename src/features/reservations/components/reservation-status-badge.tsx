import {
  getMeetupStatusLabel,
  getReservationStatusLabel,
} from "@/features/reservations/rules";
import type {
  MeetupStatus,
  ReservationStatus,
} from "@/features/reservations/types";

const reservationClasses: Record<ReservationStatus, string> = {
  pending: "bg-amber-100 text-amber-900 ring-amber-200",
  accepted: "bg-blue-100 text-blue-900 ring-blue-200",
  rejected: "bg-red-50 text-red-800 ring-red-200",
  cancelled: "bg-slate-100 text-slate-700 ring-slate-200",
  completed: "bg-emerald-100 text-emerald-900 ring-emerald-200",
};

const meetupClasses: Record<MeetupStatus, string> = {
  proposed: "bg-amber-100 text-amber-900 ring-amber-200",
  scheduled: "bg-violet-100 text-violet-900 ring-violet-200",
  cancelled: "bg-slate-100 text-slate-700 ring-slate-200",
  completed: "bg-emerald-100 text-emerald-900 ring-emerald-200",
};

export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${reservationClasses[status]}`}>
      {getReservationStatusLabel(status)}
    </span>
  );
}

export function MeetupStatusBadge({ status }: { status: MeetupStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${meetupClasses[status]}`}>
      {getMeetupStatusLabel(status)}
    </span>
  );
}
