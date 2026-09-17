import Image from "next/image";

import { Button } from "@/components/ui/button";

export type MockReservation = {
  id: number;
  title: string;
  buyer: string;
  location: string;
  time: string;
  status: "Pending" | "Confirmed";
  image: string;
  imageAlt: string;
};

export function ReservationCard({ reservation }: { reservation: MockReservation }) {
  const confirmed = reservation.status === "Confirmed";

  return (
    <article className="overflow-hidden rounded-2xl border border-[#c4c5d5] bg-white shadow-sm">
      <div className="relative h-48 overflow-hidden bg-[#eff3ff]">
        <Image
          src={reservation.image}
          alt={reservation.imageAlt}
          fill
          sizes="(max-width: 767px) 100vw, 50vw"
          className="object-cover"
        />
        <span
          className={`absolute right-4 top-4 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold tracking-[0.05em] shadow-sm ${
            confirmed ? "bg-[#e6eeff] text-[#0038a8]" : "bg-[#f3f4f6] text-[#444653]"
          }`}
        >
          {confirmed && <Image src="/assets/app/confirmed.svg" alt="" width={12} height={12} />}
          {reservation.status}
        </span>
      </div>

      <div className="flex flex-col gap-2 p-4">
        <h2 className="text-xl font-semibold leading-7 text-[#121c2a]">{reservation.title}</h2>
        <dl className="space-y-1 pt-1 text-sm leading-5 text-[#444653]">
          <div className="flex items-center gap-2">
            <Image src="/assets/app/person.svg" alt="" width={12} height={12} />
            <dt className="sr-only">Buyer</dt>
            <dd>Buyer: {reservation.buyer}</dd>
          </div>
          <div className="flex items-center gap-2">
            <Image src="/assets/app/location.svg" alt="" width={12} height={15} />
            <dt className="sr-only">Location</dt>
            <dd>{reservation.location}</dd>
          </div>
          <div className="flex items-center gap-2">
            <Image src="/assets/app/clock.svg" alt="" width={15} height={15} />
            <dt className="sr-only">Time</dt>
            <dd>{reservation.time}</dd>
          </div>
        </dl>

        {confirmed ? (
          <Button variant="ghost" className="mt-1 h-9 border border-[#c4c5d5] text-xs tracking-[0.05em]">
            Message Buyer
          </Button>
        ) : (
          <div className="mt-1 grid grid-cols-2 gap-2">
            <Button className="h-9 text-xs tracking-[0.05em]">Confirm</Button>
            <Button variant="ghost" className="h-9 border border-[#0038a8] text-xs tracking-[0.05em]">
              Reschedule
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
