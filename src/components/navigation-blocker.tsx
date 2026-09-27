"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

const UNSAVED_CHANGES_MESSAGE =
  "You have unsaved changes. Leave this page without saving?";

type NavigationBlockerValue = {
  isBlocked: boolean;
  setIsBlocked: (isBlocked: boolean) => void;
  confirmNavigation: () => boolean;
};

const NavigationBlockerContext =
  createContext<NavigationBlockerValue | null>(null);

export function NavigationBlockerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isBlocked, setIsBlocked] = useState(false);
  const confirmNavigation = useCallback(
    () => !isBlocked || window.confirm(UNSAVED_CHANGES_MESSAGE),
    [isBlocked],
  );
  const value = useMemo(
    () => ({ isBlocked, setIsBlocked, confirmNavigation }),
    [confirmNavigation, isBlocked],
  );

  return (
    <NavigationBlockerContext.Provider value={value}>
      {children}
    </NavigationBlockerContext.Provider>
  );
}

export function useNavigationBlocker() {
  const blocker = useContext(NavigationBlockerContext);
  if (!blocker) {
    throw new Error(
      "useNavigationBlocker must be used within NavigationBlockerProvider.",
    );
  }
  return blocker;
}

export function NavigationLink({
  onNavigate,
  ...props
}: ComponentProps<typeof Link>) {
  const { confirmNavigation } = useNavigationBlocker();

  return (
    <Link
      {...props}
      onNavigate={(event) => {
        if (!confirmNavigation()) {
          event.preventDefault();
          return;
        }
        onNavigate?.(event);
      }}
    />
  );
}
