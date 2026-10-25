import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { isStrongRecoverySecret } from "./recovery-secret.mjs";

export const RECOVERY_GRANT_MAX_AGE_SECONDS = 15 * 60;
const identityPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const purpose = "password_recovery";

type GrantOptions = { secret?: string; now?: number };
type GrantPayload = {
  version: 1;
  purpose: typeof purpose;
  userId: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
};

export type RecoveryCallback =
  | { kind: "token_hash"; tokenHash: string }
  | { kind: "pkce"; code: string; flowId?: string };

function signingKey(secret: string | undefined) {
  // Configure 32-64 cryptographically random bytes encoded as hex. There is
  // deliberately no generated/default key or reuse of a Supabase credential.
  if (!secret || !isStrongRecoverySecret(secret)) return null;
  return Buffer.from(secret, "hex");
}

export function hasRecoveryGrantSecret(secret = process.env.AUTH_RECOVERY_SECRET) {
  return signingKey(secret) !== null;
}

export function issueRecoveryGrant(
  userId: string,
  sessionId: string,
  { secret = process.env.AUTH_RECOVERY_SECRET, now = Date.now() }: GrantOptions = {},
) {
  const key = signingKey(secret);
  const issuedAt = Math.floor(now / 1000);
  if (!key || !identityPattern.test(userId) || !identityPattern.test(sessionId)
    || !Number.isSafeInteger(issuedAt) || issuedAt < 1) return null;
  const payload: GrantPayload = {
    version: 1, purpose, userId, sessionId, issuedAt,
    expiresAt: issuedAt + RECOVERY_GRANT_MAX_AGE_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyRecoveryGrant(
  marker: unknown,
  userId: string,
  sessionId: string,
  { secret = process.env.AUTH_RECOVERY_SECRET, now = Date.now() }: GrantOptions = {},
) {
  const key = signingKey(secret);
  if (!key || !identityPattern.test(userId) || !identityPattern.test(sessionId)
    || typeof marker !== "string" || marker.length > 1024) return false;
  const parts = marker.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]{1,768}$/.test(parts[0])
    || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return false;
  const [encoded, signature] = parts;
  const received = Buffer.from(signature, "base64url");
  const expected = createHmac("sha256", key).update(encoded).digest();
  if (received.length !== expected.length || received.toString("base64url") !== signature
    || !timingSafeEqual(received, expected)) return false;

  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) return false;
    const value: unknown = JSON.parse(decoded.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const fields = value as Record<string, unknown>;
    const current = Math.floor(now / 1000);
    if (fields.version !== 1 || fields.purpose !== purpose || fields.userId !== userId
      || fields.sessionId !== sessionId || !Number.isSafeInteger(fields.issuedAt)
      || !Number.isSafeInteger(fields.expiresAt) || !Number.isSafeInteger(current)) return false;
    const issuedAt = fields.issuedAt as number;
    const expiresAt = fields.expiresAt as number;
    if (issuedAt < 1 || issuedAt > current || expiresAt <= current
      || expiresAt - issuedAt !== RECOVERY_GRANT_MAX_AGE_SECONDS) return false;
    const canonical: GrantPayload = { version: 1, purpose, userId, sessionId, issuedAt, expiresAt };
    // Reject duplicate/extra/reordered fields and noncanonical JSON encodings.
    return JSON.stringify(canonical) === decoded.toString("utf8");
  } catch {
    return false;
  }
}

export function hasAuthenticationMethod(claims: unknown, method: "otp" | "recovery") {
  if (!claims || typeof claims !== "object") return false;
  const amr = (claims as { amr?: unknown }).amr;
  return Array.isArray(amr) && amr.some((entry) => entry === method
    || (entry !== null && typeof entry === "object" && entry.method === method));
}

/** Accept live, verified claims only; callback provenance decides the AMR gate. */
export function getRecoverySessionIdentity(claims: unknown, userId: string, kind: RecoveryCallback["kind"]) {
  if (!identityPattern.test(userId) || !claims || typeof claims !== "object") return null;
  const fields = claims as { sub?: unknown; session_id?: unknown };
  if (fields.sub !== userId || typeof fields.session_id !== "string" || !identityPattern.test(fields.session_id)) return null;
  const allowed = hasAuthenticationMethod(claims, "recovery")
    || (kind === "token_hash" && hasAuthenticationMethod(claims, "otp"));
  return allowed ? { userId, sessionId: fields.session_id } : null;
}

/** Reject ambiguous query provenance before calling either Auth operation. */
export function parseRecoveryCallback(parameters: URLSearchParams): RecoveryCallback | null {
  if ([...parameters.keys()].some((key) => parameters.getAll(key).length !== 1)) return null;
  // `token` belongs to Auth's verification endpoint, never this app callback.
  // Ignoring it beside a code/hash would leave ambiguous recovery provenance.
  if (parameters.has("token")) return null;
  const type = parameters.get("type");
  if (type !== null && type !== "recovery") return null;
  const hasToken = parameters.has("token_hash");
  const hasCode = parameters.has("code");
  if (hasToken === hasCode) return null;
  if (hasToken) {
    const tokenHash = parameters.get("token_hash");
    if (type !== "recovery" || !tokenHash || !/^[A-Za-z0-9_-]{20,4096}$/.test(tokenHash)
      || parameters.has("sb_flow_id")) return null;
    return { kind: "token_hash", tokenHash };
  }
  const code = parameters.get("code");
  const flowId = parameters.get("sb_flow_id");
  if (!code || !/^[A-Za-z0-9._~-]{1,4096}$/.test(code)
    || (flowId !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(flowId))) return null;
  return { kind: "pkce", code, ...(flowId && { flowId }) };
}
