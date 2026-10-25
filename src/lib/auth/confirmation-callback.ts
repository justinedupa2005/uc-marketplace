export type ConfirmationCallback =
  | { kind: "token_hash"; tokenHash: string; type: "email" | "signup" | "email_change" }
  | { kind: "pkce"; code: string; flowId?: string };

/** Never resolve ambiguous or error-bearing callbacks by choosing one token. */
export function parseConfirmationCallback(parameters: URLSearchParams): ConfirmationCallback | null {
  if ([...parameters.keys()].some((key) => parameters.getAll(key).length !== 1)
    || ["token", "error", "error_code", "error_description"].some((key) => parameters.has(key))) return null;
  const type = parameters.get("type");
  if (type !== null && !["email", "signup", "email_change"].includes(type)) return null;
  if (parameters.has("token_hash") === parameters.has("code")) return null;
  if (parameters.has("token_hash")) {
    const tokenHash = parameters.get("token_hash");
    if (!tokenHash || !/^[A-Za-z0-9_-]{20,4096}$/.test(tokenHash) || parameters.has("sb_flow_id")
      || (type !== "email" && type !== "signup" && type !== "email_change")) return null;
    return { kind: "token_hash", tokenHash, type };
  }
  const code = parameters.get("code");
  const flowId = parameters.get("sb_flow_id");
  if (!code || !/^[A-Za-z0-9._~-]{1,4096}$/.test(code)
    || (flowId !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(flowId))) return null;
  return { kind: "pkce", code, ...(flowId && { flowId }) };
}
