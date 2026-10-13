import { setTimeout as pause } from "node:timers/promises";

// Keep SMTP capture usable by Playwright without importing runner configuration
// (which uses import.meta and owns privileged fixture-process environment).
const isLoopback = (hostname) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);

const safeId = (id) => typeof id === "string" && id !== "latest" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Refuse hosted origins and URL components that could redirect a capture request. */
export function validateLocalEmailOrigin(value, label = "Email capture") {
  let origin;
  try { origin = new URL(value); } catch { throw new Error(`${label} requires an explicit local origin.`); }
  if (!isLoopback(origin.hostname) || !["http:", "https:"].includes(origin.protocol)
    || !origin.port || origin.username || origin.password || origin.search || origin.hash
    || !["", "/"].includes(origin.pathname)) {
    throw new Error(`${label} requires a loopback HTTP(S) origin with an explicit port and no credentials, path, or query.`);
  }
  return origin.origin;
}

export function assertRunEmail(email, runId) {
  if (typeof runId !== "string" || !uuid.test(runId) || typeof email !== "string"
    || !email.startsWith(`qa-${runId}-`) || !email.endsWith("@example.test")
    || !/^[a-z0-9-]+@example\.test$/.test(email)
    || !/^[a-z0-9-]{1,40}$/.test(email.slice(`qa-${runId}-`.length, -"@example.test".length))) {
    throw new Error("Email acceptance requires an exact fixture address owned by this QA run.");
  }
  return email;
}

export function isExactMailRecipient(message, email) {
  if (!Array.isArray(message?.To) || !message.To.length) return false;
  const recipients = [];
  for (const name of ["To", "Cc", "Bcc"]) {
    const addresses = message[name];
    if (addresses == null) continue;
    if (!Array.isArray(addresses)) return false;
    recipients.push(...addresses.map((address) => address?.Address));
  }
  return recipients.length > 0 && recipients.every((address) => typeof address === "string" && address.toLowerCase() === email);
}

/**
 * Read the actual local SMTP capture through Mailpit's v1 API. Tokens and bodies
 * remain in memory. Cleanup always supplies nonempty explicit IDs, because an
 * empty Mailpit DELETE request deletes the entire inbox.
 */
export function createMailpitCapture({ url, runId, fetchImpl = fetch, wait = pause, now = Date.now }) {
  const origin = validateLocalEmailOrigin(url, "Mailpit");
  if (typeof runId !== "string" || !uuid.test(runId)) throw new Error("Mailpit requires the current QA run identity.");
  const captured = new Map();

  async function request(pathname, { method = "GET", body, json = true } = {}) {
    let response;
    try {
      response = await fetchImpl(`${origin}${pathname}`, {
        method, redirect: "error", signal: AbortSignal.timeout(3000),
        headers: { Accept: "application/json", ...(body && { "Content-Type": "application/json" }) },
        ...(body && { body: JSON.stringify(body) }),
      });
    } catch { throw new Error("Local Mailpit capture is unavailable; no email acceptance result was obtained."); }
    if (!response.ok) {
      const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : "invalid";
      throw new Error(`Local Mailpit capture request failed (HTTP ${status}).`);
    }
    if (!json) return;
    try { return await response.json(); }
    catch { throw new Error("Local Mailpit capture returned an invalid JSON response."); }
  }

  async function search(email) {
    assertRunEmail(email, runId);
    const parameters = new URLSearchParams({ query: `to:"${email}"`, limit: "100" });
    const result = await request(`/api/v1/search?${parameters}`);
    if (!Array.isArray(result?.messages) || result.messages.some((message) => !safeId(message?.ID))) {
      throw new Error("Local Mailpit capture returned an invalid message list.");
    }
    // Searches may match substrings: validate every recipient before reading.
    return result.messages.filter((message) => isExactMailRecipient(message, email));
  }

  async function read(id, email) {
    assertRunEmail(email, runId);
    if (!safeId(id)) throw new Error("Mailpit refuses an invalid or unscoped message identity.");
    const message = await request(`/api/v1/message/${encodeURIComponent(id)}`);
    if (message?.ID !== id || !isExactMailRecipient(message, email)
      || (typeof message.Text !== "string" && typeof message.HTML !== "string")) {
      throw new Error("Mailpit refuses a message whose identity, recipient, or body does not match this fixture.");
    }
    return message;
  }

  return {
    async snapshot(email) { return new Set((await search(email)).map((message) => message.ID)); },
    async waitForMessage({ email, afterIds = new Set(), timeoutMs = 20000, intervalMs = 200 }) {
      assertRunEmail(email, runId);
      if (!(afterIds instanceof Set) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000
        || !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 1000) {
        throw new Error("Mailpit polling requires bounded timing and an explicit previous-message snapshot.");
      }
      const deadline = now() + timeoutMs;
      do {
        const summaries = await search(email);
        for (const summary of summaries) {
          if (afterIds.has(summary.ID)) continue;
          const message = await read(summary.ID, email);
          captured.set(summary.ID, email);
          return message;
        }
        if (now() >= deadline) break;
        await wait(Math.min(intervalMs, deadline - now()));
      } while (now() < deadline);
      throw new Error("No new SMTP message for the run-owned fixture arrived in local Mailpit before the deadline.");
    },
    async deleteCapturedMessages() {
      const ids = [...captured.keys()];
      if (!ids.length) return;
      // Recheck exact recipients immediately before the only mutation.
      for (const id of ids) await read(id, captured.get(id));
      await request("/api/v1/messages", { method: "DELETE", body: { IDs: ids }, json: false });
      captured.clear();
    },
  };
}
