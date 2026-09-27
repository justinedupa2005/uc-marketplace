"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type KeyboardEvent,
} from "react";

import {
  markConversationRead,
  sendMessage,
  type SendMessageState,
} from "@/app/(marketplace)/messages/actions";
import { MessageTime } from "@/components/messages/message-time";
import { ParticipantAvatar } from "@/components/messages/participant-avatar";
import {
  MESSAGE_MAX_LENGTH,
  MESSAGE_PAGE_SIZE,
  isValidMessageBody,
  mergeConversationMessages,
  normalizeMessageBody,
  type ConversationMessage,
} from "@/lib/message-utils";
import { createClient } from "@/lib/supabase/client";

type RealtimeMessageRow = {
  id?: unknown;
  conversation_id?: unknown;
  sender_id?: unknown;
  body?: unknown;
  created_at?: unknown;
  read_at?: unknown;
};

const emptySendState: SendMessageState = {
  message: null,
  error: false,
  sentMessage: null,
};

const subscribeToHydration = () => () => {};

function parseRealtimeMessage(
  value: RealtimeMessageRow,
  conversationId: string,
): ConversationMessage | null {
  if (
    value.conversation_id !== conversationId ||
    typeof value.id !== "string" ||
    typeof value.sender_id !== "string" ||
    typeof value.body !== "string" ||
    typeof value.created_at !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    senderId: value.sender_id,
    body: value.body,
    createdAt: value.created_at,
    readAt: typeof value.read_at === "string" ? value.read_at : null,
  };
}

function localDayKey(value: string, useLocalTime = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "invalid";
  if (!useLocalTime) return date.toISOString().slice(0, 10);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dateSeparatorLabel(value: string, useLocalTime: boolean) {
  const date = new Date(value);
  const now = new Date();
  const today = localDayKey(now.toISOString(), useLocalTime);
  const yesterday = new Date(now);
  if (useLocalTime) {
    yesterday.setDate(now.getDate() - 1);
  } else {
    yesterday.setUTCDate(now.getUTCDate() - 1);
  }

  if (localDayKey(value, useLocalTime) === today) return "Today";
  if (
    localDayKey(value, useLocalTime) ===
    localDayKey(yesterday.toISOString(), useLocalTime)
  ) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    timeZone: useLocalTime ? undefined : "UTC",
  }).format(date);
}

export function ConversationThread({
  conversationId,
  currentUserId,
  otherStudentName,
  otherStudentAvatarUrl,
  initialMessages,
  hasOlderMessages,
  canSend,
  readOnlyMessage,
}: {
  conversationId: string;
  currentUserId: string;
  otherStudentName: string;
  otherStudentAvatarUrl: string | null;
  initialMessages: ConversationMessage[];
  hasOlderMessages: boolean;
  canSend: boolean;
  readOnlyMessage: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState(() =>
    mergeConversationMessages([], initialMessages),
  );
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [realtimeState, setRealtimeState] = useState<
    "connecting" | "connected" | "offline"
  >("connecting");
  const [sending, startSending] = useTransition();
  const [, startMarkingRead] = useTransition();
  const hasHydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const displayedMessages = useMemo(
    () => mergeConversationMessages(messages, initialMessages),
    [initialMessages, messages],
  );
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const sendingRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const initialScrollRef = useRef(true);
  const previousNewestIdRef = useRef(initialMessages.at(-1)?.id ?? null);
  const markReadTimerRef = useRef<number | null>(null);
  const canMarkReadRef = useRef(false);

  const requestMarkRead = useCallback(() => {
    if (
      !canMarkReadRef.current ||
      document.visibilityState !== "visible" ||
      !document.hasFocus()
    ) {
      return;
    }
    if (markReadTimerRef.current !== null) {
      window.clearTimeout(markReadTimerRef.current);
    }

    markReadTimerRef.current = window.setTimeout(() => {
      markReadTimerRef.current = null;
      if (
        !canMarkReadRef.current ||
        document.visibilityState !== "visible" ||
        !document.hasFocus()
      ) {
        return;
      }
      startMarkingRead(async () => {
        try {
          await markConversationRead(conversationId);
        } catch {
          // A later focus, visibility change, or incoming message retries this.
        }
      });
    }, 150);
  }, [conversationId, startMarkingRead]);

  useEffect(() => {
    function markWhenActive() {
      if (document.visibilityState === "visible") requestMarkRead();
    }

    window.addEventListener("focus", markWhenActive);
    document.addEventListener("visibilitychange", markWhenActive);
    return () => {
      window.removeEventListener("focus", markWhenActive);
      document.removeEventListener("visibilitychange", markWhenActive);
      if (markReadTimerRef.current !== null) {
        window.clearTimeout(markReadTimerRef.current);
      }
    };
  }, [requestMarkRead]);

  useEffect(() => {
    let subscribed = true;
    let channelConnected = false;
    let catchUpInFlight = false;
    let catchUpAttempts = 0;
    let catchUpRetryTimer: number | null = null;

    function scheduleCatchUpRetry() {
      if (!subscribed || catchUpRetryTimer !== null) return;
      catchUpAttempts += 1;
      const delay = Math.min(
        1_000 * 2 ** Math.min(catchUpAttempts - 1, 5),
        30_000,
      );
      catchUpRetryTimer = window.setTimeout(() => {
        catchUpRetryTimer = null;
        void catchUpMessages();
      }, delay);
    }

    async function catchUpMessages() {
      if (catchUpInFlight) return;
      if (catchUpRetryTimer !== null) {
        window.clearTimeout(catchUpRetryTimer);
        catchUpRetryTimer = null;
      }
      catchUpInFlight = true;

      try {
        const { data, error } = await supabase
          .from("messages")
          .select("id, conversation_id, sender_id, body, created_at, read_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(MESSAGE_PAGE_SIZE);

        if (!subscribed) return;
        if (error) {
          setRealtimeState("offline");
          scheduleCatchUpRetry();
          return;
        }

        const caughtUpMessages = (
          (data ?? []) as RealtimeMessageRow[]
        ).flatMap((row) => {
          const message = parseRealtimeMessage(row, conversationId);
          return message ? [message] : [];
        }).reverse();

        setMessages((current) =>
          mergeConversationMessages(current, caughtUpMessages),
        );
        catchUpAttempts = 0;
        canMarkReadRef.current = true;
        if (channelConnected) setRealtimeState("connected");
        requestMarkRead();
      } catch {
        if (subscribed) {
          setRealtimeState("offline");
          scheduleCatchUpRetry();
        }
      } finally {
        catchUpInFlight = false;
      }
    }

    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (!subscribed) return;
          const message = parseRealtimeMessage(
            payload.new as RealtimeMessageRow,
            conversationId,
          );
          if (!message) return;

          setMessages((current) =>
            mergeConversationMessages(current, [message]),
          );
          if (message.senderId !== currentUserId) requestMarkRead();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (!subscribed) return;
          const message = parseRealtimeMessage(
            payload.new as RealtimeMessageRow,
            conversationId,
          );
          if (!message) return;
          setMessages((current) =>
            mergeConversationMessages(current, [message]),
          );
        },
      )
      .subscribe((status) => {
        if (!subscribed) return;
        if (status === "SUBSCRIBED") {
          channelConnected = true;
          setRealtimeState("connected");
          void catchUpMessages();
        }
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          channelConnected = false;
          setRealtimeState("offline");
          void catchUpMessages();
        }
      });

    return () => {
      subscribed = false;
      canMarkReadRef.current = false;
      if (catchUpRetryTimer !== null) {
        window.clearTimeout(catchUpRetryTimer);
      }
      void supabase.removeChannel(channel);
    };
  }, [conversationId, currentUserId, requestMarkRead, supabase]);

  useEffect(() => {
    const newest = displayedMessages.at(-1);
    const isNewMessage = newest?.id !== previousNewestIdRef.current;
    const shouldScroll =
      initialScrollRef.current ||
      stickToBottomRef.current ||
      (isNewMessage && newest?.senderId === currentUserId);

    if (shouldScroll) {
      endRef.current?.scrollIntoView({
        block: "end",
        behavior: initialScrollRef.current ? "auto" : "smooth",
      });
    }

    initialScrollRef.current = false;
    previousNewestIdRef.current = newest?.id ?? null;
  }, [currentUserId, displayedMessages]);

  function handleScroll() {
    const area = scrollAreaRef.current;
    if (!area) return;
    stickToBottomRef.current =
      area.scrollHeight - area.scrollTop - area.clientHeight < 96;
  }

  function submitMessage(formData: FormData) {
    if (sendingRef.current) return;

    const normalizedBody = normalizeMessageBody(body);
    if (!isValidMessageBody(normalizedBody)) {
      setFeedback(
        normalizedBody.length === 0
          ? "Write a message first."
          : `Keep messages within ${MESSAGE_MAX_LENGTH.toLocaleString("en-US")} characters.`,
      );
      return;
    }

    setFeedback(null);
    sendingRef.current = true;
    stickToBottomRef.current = true;
    startSending(async () => {
      try {
        const result = await sendMessage(emptySendState, formData);
        if (result.error) {
          setFeedback(result.message ?? "Message could not be sent. Please try again.");
          return;
        }

        const sentMessage = result.sentMessage;
        if (sentMessage) {
          setMessages((current) =>
            mergeConversationMessages(current, [sentMessage]),
          );
        }
        setBody("");
        setFeedback(null);
      } catch {
        setFeedback("Message could not be sent. Please try again.");
      } finally {
        sendingRef.current = false;
      }
    });
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    if (!sendingRef.current) formRef.current?.requestSubmit();
  }

  return (
    <>
      <div
        ref={scrollAreaRef}
        onScroll={handleScroll}
        aria-label={`Conversation with ${otherStudentName}`}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto bg-[#f9faff] px-4 py-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0038a8] sm:px-6"
      >
        {hasOlderMessages && (
          <p className="mx-auto mb-5 w-fit rounded-full border border-[#d9e3f7] bg-white px-3 py-1 text-xs text-[#5b6070]">
            Showing the latest {initialMessages.length} messages
          </p>
        )}

        {displayedMessages.length > 0 ? (
          <div className="space-y-3">
            {displayedMessages.map((message, index) => {
              const isMine = message.senderId === currentUserId;
              const showDateSeparator =
                index === 0 ||
                localDayKey(
                  displayedMessages[index - 1]!.createdAt,
                  hasHydrated,
                ) !== localDayKey(message.createdAt, hasHydrated);

              return (
                <Fragment key={message.id}>
                  {showDateSeparator && (
                    <div
                      role="separator"
                      className="flex items-center gap-3 py-2 text-xs font-medium text-[#747685]"
                    >
                      <span className="h-px flex-1 bg-[#e1e2ea]" />
                      <span suppressHydrationWarning>
                        {dateSeparatorLabel(message.createdAt, hasHydrated)}
                      </span>
                      <span className="h-px flex-1 bg-[#e1e2ea]" />
                    </div>
                  )}

                  <article
                    className={`flex items-end gap-2 ${
                      isMine ? "justify-end" : "justify-start"
                    }`}
                  >
                    {!isMine && (
                      <ParticipantAvatar
                        name={otherStudentName}
                        avatarUrl={otherStudentAvatarUrl}
                        size="sm"
                      />
                    )}
                    <div
                      className={`max-w-[82%] sm:max-w-[72%] ${
                        isMine ? "text-right" : "text-left"
                      }`}
                    >
                      <p className="mb-1 px-1 text-[11px] font-semibold text-[#5b6070]">
                        {isMine ? "You" : otherStudentName}
                      </p>
                      <div
                        className={`rounded-2xl px-4 py-3 shadow-sm ${
                          isMine
                            ? "rounded-br-md bg-[#0038a8] text-white"
                            : "rounded-bl-md border border-[#e1e2ea] bg-white text-[#121c2a]"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words text-left text-sm leading-6">
                          {message.body}
                        </p>
                        <div
                          className={`mt-1.5 flex items-center gap-2 text-[11px] ${
                            isMine
                              ? "justify-end text-white/75"
                              : "text-[#747685]"
                          }`}
                        >
                          <MessageTime value={message.createdAt} />
                          {isMine && (
                            <span aria-label={message.readAt ? "Read" : "Sent"}>
                              {message.readAt ? "Read" : "Sent"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                </Fragment>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-52 flex-col items-center justify-center text-center">
            <div
              className="flex size-12 items-center justify-center rounded-full bg-[#e6eeff] text-[#002576]"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.8 4v-4.35A2.5 2.5 0 0 1 4 13.5v-8Z" />
              </svg>
            </div>
            <p className="mt-3 text-sm font-semibold text-[#444653]">
              No messages yet
            </p>
            <p className="mt-1 text-xs text-[#747685]">
              Say hello and ask about the item.
            </p>
          </div>
        )}
        <div ref={endRef} aria-hidden="true" />
      </div>

      {realtimeState === "offline" && (
        <p
          role="status"
          className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900"
        >
          Live updates are temporarily unavailable. {canSend
            ? "You can still send messages; refresh to check for replies."
            : "Refresh to check for updates."}
        </p>
      )}

      {canSend ? (
        <form
          ref={formRef}
          action={submitMessage}
          className="border-t border-[#e1e2ea] bg-white p-3 sm:p-4"
        >
          <input type="hidden" name="conversationId" value={conversationId} />
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="message-body" className="sr-only">
                Message {otherStudentName}
              </label>
              <textarea
                id="message-body"
                name="body"
                required
                maxLength={MESSAGE_MAX_LENGTH}
                rows={2}
                value={body}
                disabled={sending}
                onChange={(event) => {
                  setBody(event.target.value);
                  if (feedback) setFeedback(null);
                }}
                onKeyDown={handleComposerKeyDown}
                aria-describedby="message-composer-help message-composer-feedback"
                placeholder="Write a message…"
                className="min-h-12 w-full resize-none rounded-xl border border-[#c4c5d5] bg-white px-4 py-3 text-sm outline-none focus:border-[#0038a8] focus:ring-2 focus:ring-[#0038a8]/15 disabled:cursor-wait disabled:bg-[#f2f3f8]"
              />
            </div>
            <button
              type="submit"
              disabled={sending || !isValidMessageBody(body)}
              className="min-h-12 shrink-0 rounded-xl bg-[#0038a8] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#002576] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
          <div className="mt-1.5 flex min-h-5 items-start justify-between gap-3 px-1 text-xs">
            <p id="message-composer-help" className="text-[#747685]">
              Enter to send · Shift+Enter for a new line
            </p>
            <span className="shrink-0 text-[#747685]">
              {body.length.toLocaleString("en-US")}/{MESSAGE_MAX_LENGTH.toLocaleString("en-US")}
            </span>
          </div>
          <p
            id="message-composer-feedback"
            role={feedback ? "alert" : undefined}
            className={`mt-1 min-h-5 px-1 text-sm ${
              feedback ? "text-red-700" : "text-transparent"
            }`}
          >
            {feedback ?? ""}
          </p>
        </form>
      ) : (
        <p className="border-t border-[#e1e2ea] bg-red-50 px-5 py-4 text-sm text-red-800">
          {readOnlyMessage}
        </p>
      )}
    </>
  );
}
