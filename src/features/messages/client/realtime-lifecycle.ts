export type ConversationRealtimeState = "connecting" | "connected" | "offline";

/** A channel join and a PostgreSQL listener become ready independently. */
export function createConversationRealtimeLifecycle<T>({
  load,
  apply,
  onState,
  setTimer,
  clearTimer,
}: {
  load: () => Promise<T>;
  apply: (messages: T) => void;
  onState: (state: ConversationRealtimeState) => void;
  setTimer: (callback: () => void, delay: number) => number;
  clearTimer: (timer: number) => void;
}) {
  let active = true;
  let joined = false;
  let postgresReady = false;
  let state: ConversationRealtimeState = "connecting";
  let revision = 0;
  let inFlight = false;
  let pending = false;
  let retryAttempts = 0;
  let retryTimer: number | null = null;
  let readinessTimer: number | null = null;

  function updateState(next: ConversationRealtimeState) {
    if (!active || state === next) return;
    state = next;
    onState(next);
  }

  function clearReadinessTimer() {
    if (readinessTimer !== null) clearTimer(readinessTimer);
    readinessTimer = null;
  }

  function watchReadiness() {
    if (!active || readinessTimer !== null || (joined && postgresReady)) return;
    readinessTimer = setTimer(() => {
      readinessTimer = null;
      if (!active || (joined && postgresReady)) return;
      updateState("offline");
      requestCatchUp();
    }, 15_000);
  }

  function scheduleRetry() {
    if (!active || retryTimer !== null) return;
    retryAttempts += 1;
    const delay = Math.min(1_000 * 2 ** Math.min(retryAttempts - 1, 5), 30_000);
    retryTimer = setTimer(() => {
      retryTimer = null;
      requestCatchUp();
    }, delay);
  }

  async function catchUp() {
    inFlight = true;
    const requestedRevision = revision;
    try {
      const messages = await load();
      if (!active) return;
      apply(messages);
      if (requestedRevision === revision && joined && postgresReady) {
        retryAttempts = 0;
        clearReadinessTimer();
        updateState("connected");
      }
    } catch {
      if (active) updateState("offline");
    } finally {
      inFlight = false;
      if (active && pending) {
        pending = false;
        void catchUp();
      } else if (active && state === "offline") {
        // Successful REST reads do not prove that CDC recovered. Keep a bounded
        // polling fallback, with backoff, until the live listener is ready.
        scheduleRetry();
      }
    }
  }

  function requestCatchUp() {
    if (!active) return;
    revision += 1;
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = null;
    if (inFlight) {
      pending = true;
      return;
    }
    void catchUp();
  }

  watchReadiness();

  return {
    channelStatus(status: string) {
      if (!active) return;
      if (status === "SUBSCRIBED") {
        joined = true;
        watchReadiness();
        requestCatchUp();
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        joined = false;
        postgresReady = false;
        clearReadinessTimer();
        updateState("offline");
        requestCatchUp();
      }
    },
    system(payload: unknown) {
      if (!active || !payload || typeof payload !== "object") return;
      const event = payload as { extension?: unknown; status?: unknown };
      if (event.extension !== "postgres_changes") return;
      postgresReady = event.status === "ok";
      if (!postgresReady) {
        clearReadinessTimer();
        updateState("offline");
      }
      // A ready event during an initial fetch queues a second fetch. The first
      // snapshot may predate writes in the channel-join -> CDC-ready gap.
      requestCatchUp();
    },
    dispose() {
      active = false;
      pending = false;
      clearReadinessTimer();
      if (retryTimer !== null) clearTimer(retryTimer);
      retryTimer = null;
    },
  };
}
