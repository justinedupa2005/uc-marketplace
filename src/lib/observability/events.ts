const events = ["server_exception", "auth_request_failed", "email_request_failed", "database_request_failed", "storage_request_failed",
  "realtime_request_failed", "upstream_request_failed", "reservation_failed", "profile_upload_failed"] as const;
export type OperationalEvent = typeof events[number];
const codes = new Set(["42501", "23505", "23503", "23514", "40001", "40P01", "P0002", "PT409", "22023", "22P02", "57014", "53300",
  "invalid_credentials", "over_request_rate_limit", "over_email_send_rate_limit", "email_not_confirmed", "signup_disabled", "email_address_not_authorized",
  "request_timeout", "unexpected_failure", "email_provider_disabled", "weak_password", "user_already_exists", "email_exists", "captcha_failed"]);
const operations = new Set(["request", "accept", "reject", "cancel", "complete", "meetup", "conversation", "register", "recover", "resend", "login", "avatar"]);
const routes = ["admin", "auth", "marketplace", "listing", "sell", "messages", "reservations", "profile", "verification", "login", "register", "forgot-password", "reset-password"];

export function operationalRecord(event: OperationalEvent, metadata: { code?: unknown; status?: unknown; operation?: unknown; route?: unknown; method?: unknown } = {}) {
  // Construct a fresh allowlisted object. Never spread an Error, request, form,
  // URL, headers, user object, message, stack, digest or arbitrary provider code.
  return {
    schema: "ucm.ops.v1", event: events.includes(event) ? event : "upstream_request_failed",
    level: event === "server_exception" || typeof metadata.status === "number" && metadata.status >= 500 ? "error" : "warn",
    code: typeof metadata.code === "string" && codes.has(metadata.code) ? metadata.code : "unknown",
    status: typeof metadata.status === "number" && Number.isInteger(metadata.status) && metadata.status >= 100 && metadata.status <= 599 ? metadata.status : null,
    operation: typeof metadata.operation === "string" && operations.has(metadata.operation) ? metadata.operation : "unknown",
    route: typeof metadata.route === "string" && routes.includes(metadata.route) ? metadata.route : "other",
    method: typeof metadata.method === "string" && ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"].includes(metadata.method) ? metadata.method : "other",
  };
}

export function reportOperationalEvent(event: OperationalEvent, metadata?: Parameters<typeof operationalRecord>[1]) {
  try {
    const record = operationalRecord(event, metadata);
    if (record.level === "error") console.error(JSON.stringify(record));
    else console.warn(JSON.stringify(record));
  } catch { /* Telemetry must never turn a successful operation into a failure. */ }
}

export function routeGroup(route: string) {
  const segments = route.split("/").filter(segment => segment && !segment.startsWith("("));
  return routes.includes(segments[0]) ? segments[0] : "other";
}
