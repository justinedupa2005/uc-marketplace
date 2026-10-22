import { createHash, X509Certificate } from "node:crypto";

// Public provider CA, not a database password/key. Pin the reviewed download so
// rotation fails closed until an operator checks the new certificate.
export const caSource = "https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt";
export const caSha256 = "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7";
export function validateStagingCa(pem) {
  if (typeof pem !== "string" || createHash("sha256").update(pem).digest("hex") !== caSha256) throw new Error("Unreviewed staging CA certificate.");
  const certificate = new X509Certificate(pem);
  if (!certificate.ca || Date.parse(certificate.validTo) <= Date.now() || Date.parse(certificate.validFrom) > Date.now()) throw new Error("Invalid staging CA certificate.");
  return pem;
}
export async function getStagingCa(fetcher = fetch) {
  const response = await fetcher(caSource, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Staging CA download failed.");
  const pem = await response.text();
  return validateStagingCa(pem);
}
