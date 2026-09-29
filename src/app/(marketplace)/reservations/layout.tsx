import type { ReactNode } from "react";

import { ReservationFeedbackProvider } from "@/features/reservations/components/reservation-feedback-provider";

export default function ReservationsLayout({ children }: { children: ReactNode }) {
  return <ReservationFeedbackProvider>{children}</ReservationFeedbackProvider>;
}
