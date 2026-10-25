// Shared application/provider policy. Whitespace alone is not a symbol.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
export const PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";
export const SUPABASE_PASSWORD_CHARACTERS = [
  "abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "0123456789",
  PASSWORD_SYMBOLS.replaceAll(":", "\\:"),
].join(":");
