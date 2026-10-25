/** Pure validation shared by build/startup checks and the server-only signer. */
export function isStrongRecoverySecret(secret) {
  if (typeof secret !== "string" || !/^(?:[0-9a-fA-F]{2}){32,64}$/.test(secret)) return false;
  const bytes = secret.toLowerCase().match(/../g);
  // Reject obvious placeholders. This is not an entropy proof: generate the
  // value once with a cryptographic RNG, never on application startup.
  return new Set(bytes).size >= 16 && !/^(.{2,32})\1+$/.test(secret.toLowerCase());
}
