import "server-only";
import { reportOperationalEvent, type OperationalEvent } from "./events";

export function observedSupabaseFetch(origin: string, fetcher: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    let event: OperationalEvent = "upstream_request_failed";
    try {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === new URL(origin).origin) {
        if (url.pathname.startsWith("/auth/")) event = "auth_request_failed";
        else if (url.pathname.startsWith("/rest/")) event = "database_request_failed";
        else if (url.pathname.startsWith("/storage/")) event = "storage_request_failed";
        else if (url.pathname.startsWith("/realtime/")) event = "realtime_request_failed";
      }
    } catch { /* Never include the URL or input in diagnostics. */ }
    try {
      const response = await fetcher(input, init);
      if (!response.ok) reportOperationalEvent(event, { status: response.status });
      return response; // Do not consume the body or change SDK retry behavior.
    } catch {
      reportOperationalEvent(event);
      // Do not let an arbitrary network/provider message containing a token or
      // signed URL become an uncaught Next.js log entry.
      throw new Error("Upstream request unavailable.");
    }
  };
}
