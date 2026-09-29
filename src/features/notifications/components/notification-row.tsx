"use client";

import { useState } from "react";

import { NotificationIcon } from "@/features/notifications/components/notification-icon";
import { getNotificationDestination } from "@/features/notifications/rules";
import type { NotificationItem } from "@/features/notifications/types";

function formatNotificationDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

export function NotificationRow({
  notification,
  pending,
  disabled,
  onOpen,
}: {
  notification: NotificationItem;
  pending: boolean;
  disabled: boolean;
  onOpen: (notification: NotificationItem) => void;
}) {
  const destination = getNotificationDestination(notification);
  // Keep an interacted-with row's button mounted after acknowledging it so
  // keyboard focus does not disappear when the optimistic read state changes.
  const [keepReadButton] = useState(!notification.isRead);
  const actionable = Boolean(destination) || !notification.isRead || keepReadButton;
  const canInteract = Boolean(destination) || !notification.isRead;
  const content = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#e9effb] text-[#0038a8]">
        <NotificationIcon type={notification.type} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <span className={`break-words text-base leading-6 text-[#121c2a] ${notification.isRead ? "font-medium" : "font-bold"}`}>
            {notification.title}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold leading-6 text-[#444653]">
            {!notification.isRead && <span aria-hidden="true" className="size-1.5 rounded-full bg-[#0038a8]" />}
            {notification.isRead ? "Read" : "Unread"}
          </span>
        </span>
        <span id={`notification-message-${notification.id}`} className="mt-1 block break-words text-sm leading-6 text-[#444653]">
          {notification.message}
        </span>
        <span className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <time dateTime={notification.createdAt} className="text-xs leading-5 text-[#616372]">
            {formatNotificationDate(notification.createdAt)}
          </time>
          {(canInteract || pending) && (
            <span className="text-xs font-semibold text-[#0038a8]">
              {pending ? "Updating..." : destination ? "View update" : "Mark as read"}
              {destination && !pending && <span aria-hidden="true"> &rarr;</span>}
            </span>
          )}
        </span>
      </span>
    </>
  );
  const className = `flex w-full items-start gap-3 px-4 py-5 text-left sm:gap-4 sm:px-6 ${notification.isRead ? "bg-white" : "bg-[#f2f6ff]"}`;

  return (
    <li>
      {actionable ? (
        <button
          type="button"
          onClick={() => {
            if (!disabled && canInteract) onOpen(notification);
          }}
          aria-disabled={disabled || !canInteract}
          tabIndex={!canInteract && !pending ? -1 : undefined}
          aria-label={`${notification.isRead ? "Read" : "Unread"}: ${notification.title}. ${destination ? "Open update" : notification.isRead ? "Already marked as read" : "Mark as read"}`}
          aria-describedby={`notification-message-${notification.id}`}
          aria-busy={pending}
          className={`${className} hover:bg-[#e9effb] focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0038a8] aria-disabled:opacity-70 ${disabled ? "cursor-wait" : !canInteract ? "cursor-default" : ""}`}
        >
          {content}
        </button>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}
