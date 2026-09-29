"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Pagination } from "@/components/pagination";
import { markAllNotificationsRead, markNotificationRead } from "@/features/notifications/actions";
import { NotificationIcon } from "@/features/notifications/components/notification-icon";
import { NotificationRow } from "@/features/notifications/components/notification-row";
import { getNotificationDestination, getNotificationsPageHref } from "@/features/notifications/rules";
import type { NotificationItem } from "@/features/notifications/types";

export function NotificationsInbox({
  notifications,
  unreadCount,
  snapshotAt,
  page,
  pageCount,
  totalCount,
}: {
  notifications: NotificationItem[];
  unreadCount: number;
  snapshotAt: string;
  page: number;
  pageCount: number;
  totalCount: number;
}) {
  const router = useRouter();
  const [view, setView] = useState({
    items: notifications,
    unreadCount,
    snapshotAt,
  });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const actionLocked = useRef(false);

  // A refresh replaces the optimistic view with the persisted owner-only data.
  if (view.snapshotAt !== snapshotAt) {
    setView({ items: notifications, unreadCount, snapshotAt });
  }
  const { items, unreadCount: unread } = view;

  function openNotification(notification: NotificationItem) {
    if (actionLocked.current || pending) return;
    const destination = getNotificationDestination(notification);

    if (notification.isRead) {
      if (destination) router.push(destination);
      return;
    }

    actionLocked.current = true;
    const previousView = view;
    const rollback = () => setView((current) =>
      current.snapshotAt === previousView.snapshotAt ? previousView : current,
    );
    setPendingId(notification.id);
    setNotice(null);
    setView({
      ...view,
      items: items.map((item) => item.id === notification.id ? { ...item, isRead: true } : item),
      unreadCount: Math.max(0, unread - 1),
    });

    startTransition(async () => {
      try {
        const result = await markNotificationRead(notification.id);
        if (!result.ok) {
          rollback();
          setNotice({ message: result.message, error: true });
          return;
        }
        setView((current) => ({
          ...current,
          items: current.items.map((item) => item.id === notification.id ? { ...item, isRead: true } : item),
          unreadCount: result.unreadCount ?? current.unreadCount,
        }));
        if (destination) router.push(destination);
        else setNotice({ message: result.message, error: false });
      } catch (error) {
        unstable_rethrow(error);
        rollback();
        setNotice({ message: "Unable to mark this notification as read. Please try again.", error: true });
      } finally {
        actionLocked.current = false;
        setPendingId(null);
        router.refresh();
      }
    });
  }

  function markAllRead() {
    if (actionLocked.current || pending || unread === 0) return;
    actionLocked.current = true;
    const previousView = view;
    const rollback = () => setView((current) =>
      current.snapshotAt === previousView.snapshotAt ? previousView : current,
    );
    // The query already bounded these rows by the database snapshot. Capture
    // IDs so a refresh during this action never acknowledges a newer row.
    const visibleIds = new Set(items.map((item) => item.id));
    setPendingId("all");
    setNotice(null);
    setView({
      ...view,
      items: items.map((item) => ({ ...item, isRead: true })),
      unreadCount: 0,
    });

    startTransition(async () => {
      try {
        const result = await markAllNotificationsRead(snapshotAt);
        if (!result.ok) {
          rollback();
          setNotice({ message: result.message, error: true });
          return;
        }
        setView((current) => ({
          ...current,
          items: current.items.map((item) => visibleIds.has(item.id) ? { ...item, isRead: true } : item),
          unreadCount: result.unreadCount ?? current.unreadCount,
        }));
        setNotice({ message: result.message, error: false });
      } catch (error) {
        unstable_rethrow(error);
        rollback();
        setNotice({ message: "Unable to mark notifications as read. Please try again.", error: true });
      } finally {
        actionLocked.current = false;
        setPendingId(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm text-[#444653]">
          <span className="font-semibold text-[#121c2a]">{unread}</span> unread
          {totalCount > 0 && <span> &middot; {totalCount} total</span>}
        </p>
        <button
          type="button"
          onClick={markAllRead}
          disabled={pending || unread === 0}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#c4c5d5] bg-white px-4 text-sm font-semibold text-[#0038a8] hover:bg-[#e9effb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0038a8] disabled:cursor-default disabled:opacity-50"
        >
          {pendingId === "all" ? "Marking as read..." : "Mark all as read"}
        </button>
      </div>

      {notice && (
        <div role={notice.error ? "alert" : "status"} className={`mb-5 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm leading-6 ${notice.error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          <p>{notice.message}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification update" className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded hover:bg-black/5">&times;</button>
        </div>
      )}

      {items.length > 0 ? (
        <ul aria-label="Your notifications" aria-busy={pending} className="divide-y divide-[#e1e2ea] overflow-hidden rounded-2xl border border-[#c4c5d5] bg-white shadow-sm">
          {items.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              pending={pendingId === notification.id || pendingId === "all"}
              disabled={pending}
              onOpen={openNotification}
            />
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-[#c4c5d5] bg-white px-6 py-14 text-center shadow-sm">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#e9effb] text-[#0038a8]"><NotificationIcon type="empty" className="size-7" /></span>
          <h2 className="mt-5 text-lg font-bold text-[#121c2a]">No notifications yet</h2>
          <p className="mt-2 text-sm leading-6 text-[#444653]">Important marketplace updates will appear here.</p>
        </div>
      )}

      <Pagination currentPage={page} totalPages={pageCount} hrefForPage={getNotificationsPageHref} ariaLabel="Notification pages" />
    </>
  );
}
