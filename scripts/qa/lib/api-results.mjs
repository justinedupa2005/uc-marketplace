// Negative permission tests must reject outages and broken API contracts. A
// generic error is not evidence that an authorization rule worked.
const statusOf = (result) => {
  // StorageApiError.status is HTTP, while statusCode may contain a symbolic
  // Storage code (AccessDenied, NoSuchKey) rather than a numeric status.
  for (const value of [result?.status, result?.error?.status, result?.error?.statusCode]) {
    if (value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
};

export function isExpectedDataDenial(result, codes = ["42501", "P0002"]) {
  if (!result?.error || !codes.includes(result.error.code)) return false;
  const status = statusOf(result);
  // PostgREST maps transaction rollback (40001) and PL/pgSQL no-data-found
  // (P0002) to 500. These exact expected SQLSTATEs are not service outages.
  const expectedServerState = status === 500 && ["40001", "P0002"].includes(result.error.code);
  return status === null || expectedServerState || (Number.isFinite(status) && status >= 400 && status < 500);
}

export function isSuccessfulApiResult(result) {
  const status = statusOf(result);
  return Boolean(result) && !result.error
    && (status === null || (Number.isFinite(status) && status >= 200 && status < 300));
}

export function isSuccessfulEmptyResult(result) {
  return isSuccessfulApiResult(result) && Array.isArray(result.data) && result.data.length === 0;
}

export function isInvisibleDataResult(result, codes = ["42501"]) {
  return isSuccessfulEmptyResult(result) || isExpectedDataDenial(result, codes);
}

export function isExpectedStorageDenial(result) {
  if (!result?.error) return false;
  const status = statusOf(result);
  if ([401, 403, 404].includes(status)) return true;
  // Some Storage versions map RLS denials and hidden objects to HTTP 400.
  // Do not accept unrelated validation failures, collisions, or transport errors.
  return status === 400 && /row.level security|permission denied|access denied|not found/i.test(result.error.message ?? "");
}

export function isUnchangedStorageResult(result) {
  return isSuccessfulEmptyResult(result) || isExpectedStorageDenial(result);
}
