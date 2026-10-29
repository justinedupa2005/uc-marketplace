const b2Codes = new Set([
  "B2_ENDPOINT_REQUIRED", "B2_ENDPOINT_INVALID", "B2_BUCKET_NAME_INVALID", "B2_ENDPOINT_ACCOUNT_MISMATCH", "B2_ACCOUNT_INVALID", "B2_TOKEN_INVALID",
  "B2_SINGLE_BUCKET_KEY_REQUIRED", "B2_BUCKET_KEY_MISMATCH", "B2_RESTIC_CAPABILITIES_REQUIRED", "B2_ADMINISTRATIVE_KEY_REFUSED", "B2_BUCKET_ACCOUNT_MISMATCH",
  "B2_BUCKET_ID_MISMATCH", "B2_BUCKET_NAME_MISMATCH", "B2_PRIVATE_BUCKET_REQUIRED", "B2_SAFE_PREFIX_REQUIRED", "B2_METADATA_REQUEST_FAILED",
  "B2_METADATA_TOO_LARGE", "B2_KEY_ID_REQUIRED", "B2_KEY_ID_INVALID", "B2_APPLICATION_KEY_REQUIRED", "B2_APPLICATION_KEY_INVALID", "B2_BUCKET_NAME_REQUIRED", "B2_NATIVE_ENDPOINT_INVALID", "B2_BUCKET_NOT_UNIQUE",
  "B2_AUTHENTICATION_FAILED", "B2_METADATA_PERMISSION_DENIED", "B2_REQUEST_FORBIDDEN", "B2_REQUEST_THROTTLED", "B2_SERVICE_UNAVAILABLE", "B2_CONFIRMATION_REQUIRED", "B2_SUPABASE_CREDENTIAL_REFUSED",
]);
const phases = new Set(["configuration", "b2-preflight", "tool-verification", "repository-init", "repository-verification", "media-backup", "verification-backup",
  "media-restore", "verification-restore", "integrity-read", "wrong-key-denial", "failed-producer-denial", "complete"]);
const resticPatterns = [
  [/AccessDenied|Access Denied|not authorized|unauthorized|forbidden/i, "S3_ACCESS_DENIED"],
  [/InvalidAccessKeyId|invalid application key/i, "S3_KEY_INVALID"],
  [/SignatureDoesNotMatch|InvalidSignature|signature.*(?:invalid|does not match)/i, "S3_SIGNATURE_REJECTED"],
  [/NoSuchBucket|bucket .*does not exist/i, "S3_BUCKET_MISSING"],
  [/RequestTimeTooSkewed|RequestExpired/i, "S3_CLOCK_SKEW"],
  [/ObjectLock|Object Lock/i, "S3_OBJECT_LOCK_REVIEW"],
  [/deadline exceeded|i\/o timeout|request timed out/i, "S3_TIMEOUT"],
  [/x509|certificate verification|certificate signed by unknown/i, "TLS_VERIFICATION_FAILED"],
  [/dial tcp|no such host|connection refused|network is unreachable/i, "NETWORK_CONNECTION_FAILED"],
  [/repository.*already.*(?:exist|initializ)/i, "REPOSITORY_ALREADY_EXISTS"],
  [/wrong password or no key found|no key found|unable to open config file/i, "REPOSITORY_CREDENTIAL_OR_CONFIG_REJECTED"],
];
const resticCodes = new Set(resticPatterns.map(([, code]) => code));

export function resticFailureCodes(privateDiagnostic) {
  // Return only fixed categories. Never return a matching fragment, provider
  // response, bucket/endpoint/key, command, Error, stack or signed URL.
  return resticPatterns.filter(([pattern]) => pattern.test(privateDiagnostic)).map(([, code]) => code);
}

export function backblazeFailure(error, phase) {
  const firstLine = typeof error?.message === "string" ? error.message.split(/\r?\n/, 1)[0] : "";
  return { failureCode: b2Codes.has(firstLine) ? firstLine : "B2_OPERATION_FAILED",
    failurePhase: phases.has(phase) ? phase : "configuration",
    operationCodes: Array.isArray(error?.operationCodes) ? [...resticCodes].filter(code => error.operationCodes.includes(code)) : [] };
}
