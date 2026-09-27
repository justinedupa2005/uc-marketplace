"use client";

import { useEffect, useState } from "react";

function isSameLocalDay(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function isYesterday(value: Date, now: Date) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return isSameLocalDay(value, yesterday);
}

function formatRelative(value: Date, now: Date) {
  const elapsed = Math.max(0, now.getTime() - value.getTime());
  const minutes = Math.floor(elapsed / 60_000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24 && isSameLocalDay(value, now)) return `${hours}h`;
  if (isYesterday(value, now)) return "Yesterday";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: value.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(value);
}

function formatMessageTime(value: Date, now: Date) {
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);

  if (isSameLocalDay(value, now)) return time;
  if (isYesterday(value, now)) return `Yesterday, ${time}`;

  const date = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: value.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(value);
  return `${date}, ${time}`;
}

export function MessageTime({
  value,
  variant = "message",
  className = "",
}: {
  value: string;
  variant?: "message" | "relative";
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const date = new Date(value);
  const valid = !Number.isNaN(date.getTime());

  useEffect(() => {
    if (variant !== "relative") return;
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [variant]);

  if (!valid) return null;

  const nowDate = new Date(now);
  const label =
    variant === "relative"
      ? formatRelative(date, nowDate)
      : formatMessageTime(date, nowDate);
  const fullTimestamp = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);

  return (
    <time
      dateTime={value}
      title={fullTimestamp}
      className={className}
      suppressHydrationWarning
    >
      {label}
    </time>
  );
}
