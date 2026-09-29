"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

import { ActionNotice } from "@/components/action-notice";

type ReservationNotice = {
  message: string;
  variant: "success" | "error";
};

type ShowReservationNotice = (
  message: string,
  variant: ReservationNotice["variant"],
) => void;

const ReservationFeedbackContext = createContext<ShowReservationNotice | null>(null);

export function ReservationFeedbackProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [notice, setNotice] = useState<ReservationNotice | null>(null);
  const showNotice = useCallback<ShowReservationNotice>((message, variant) => {
    setNotice({ message, variant });
  }, []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return (
    <ReservationFeedbackContext.Provider value={showNotice}>
      {children}
      <ActionNotice
        message={notice?.message ?? null}
        variant={notice?.variant ?? "success"}
        onDismiss={dismissNotice}
      />
    </ReservationFeedbackContext.Provider>
  );
}

// A page owns shared feedback so an action notice remains visible when its
// reservation no longer matches a status filter. Embedded controls still work
// without a provider, using their own local notice.
export function useReservationNotice() {
  const showSharedNotice = useContext(ReservationFeedbackContext);
  const [notice, setNotice] = useState<ReservationNotice | null>(null);
  const showLocalNotice = useCallback<ShowReservationNotice>((message, variant) => {
    setNotice({ message, variant });
  }, []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    showNotice: showSharedNotice ?? showLocalNotice,
    notice: showSharedNotice ? null : notice,
    dismissNotice,
  };
}
