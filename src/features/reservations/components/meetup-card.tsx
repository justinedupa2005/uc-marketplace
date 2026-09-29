import { MeetupStatusBadge } from "@/features/reservations/components/reservation-status-badge";
import type { ReservationMeetup } from "@/features/reservations/types";

function formatMeetupDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

export function MeetupCard({ meetup }: { meetup: ReservationMeetup }) {
  return (
    <section
      aria-labelledby="meetup-details-title"
      className="rounded-2xl border border-[#c4c5d5] bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="meetup-details-title" className="text-lg font-bold">
          Meetup details
        </h2>
        <MeetupStatusBadge status={meetup.status} />
      </div>

      <dl className="mt-5 space-y-4 text-sm">
        <div>
          <dt className="font-medium text-[#747685]">When</dt>
          <dd className="mt-1 font-bold text-[#121c2a]">
            <time dateTime={meetup.scheduledAt}>
              {formatMeetupDate(meetup.scheduledAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt className="font-medium text-[#747685]">Public location</dt>
          <dd className="mt-1 font-bold text-[#121c2a]">{meetup.locationName}</dd>
          {meetup.locationDetails && (
            <dd className="mt-1 whitespace-pre-wrap text-[#444653]">
              {meetup.locationDetails}
            </dd>
          )}
        </div>
        {meetup.notes && (
          <div>
            <dt className="font-medium text-[#747685]">Notes</dt>
            <dd className="mt-1 whitespace-pre-wrap text-[#444653]">
              {meetup.notes}
            </dd>
          </div>
        )}
      </dl>

      <p className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-900">
        Meet in a visible, public campus area. Tell someone where you are going,
        inspect the item before paying, and leave if anything feels unsafe.
      </p>
    </section>
  );
}
