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
  [/repository is already locked|unable to create lock|repository.*locked exclusively/i, "REPOSITORY_LOCKED"],
  [/wrong password or no key found|no key found|unable to open config file/i, "REPOSITORY_CREDENTIAL_OR_CONFIG_REJECTED"],
];
const resticCodes = new Set(resticPatterns.map(([, code]) => code));
export const capturePhases = Object.freeze(["capture-policy", "capture-vault", "capture-connect", "capture-snapshot", "capture-inventory",
  "capture-manifest", "capture-database", "capture-media", "capture-verification", "capture-consistency", "capture-integrity", "capture-bundle"]);
const dumpPatterns = [
  [/password authentication failed|authentication failed/i, "DATABASE_AUTHENTICATION_REJECTED"],
  [/permission denied|query would be affected by row-level security/i, "DATABASE_PERMISSION_DENIED"],
  [/invalid snapshot identifier|invalid snapshot data|snapshot.*does not exist|snapshot.*must be called|must be called before any query/i, "DUMP_SNAPSHOT_REJECTED"],
  [/server version.*pg_dump version|aborting because of server version mismatch/i, "DUMP_VERSION_REJECTED"],
  [/certificate verify failed|certificate verification failed|root certificate|SSL error|server does not support SSL/i, "DUMP_TLS_REJECTED"],
  [/could not translate host name|could not connect|connection.*(?:refused|timed out)|network is unreachable/i, "DATABASE_NETWORK_UNAVAILABLE"],
  [/timeout expired|statement timeout|lock timeout|canceling statement/i, "DATABASE_QUERY_TIMEOUT"],
  [/Cannot connect to the Docker daemon|permission denied.*docker.sock/i, "DUMP_DOCKER_UNAVAILABLE"],
  [/pull access denied|manifest unknown|toomanyrequests|unauthenticated pull rate limit/i, "DUMP_IMAGE_UNAVAILABLE"],
  [/read-only transaction/i, "DUMP_READ_ONLY_REFUSAL"],
];
const producerCodes = new Set([...dumpPatterns.map(([, code]) => code), "DATABASE_CONNECTION_LIMIT", "DATABASE_PREFLIGHT_FAILED",
  "DUMP_DATABASE_CONNECT_FAILED", "DUMP_SNAPSHOT_FAILED", "DUMP_TOOL_FAILED", "DUMP_COMMAND_FAILED", "BACKUP_PRODUCER_FAILED"]);

export function dumpFailureCodes(privateDiagnostic) {
  const codes = dumpPatterns.filter(([pattern]) => pattern.test(privateDiagnostic)).map(([, code]) => code);
  return codes.length ? codes : ["DUMP_COMMAND_FAILED"];
}

export function producerFailureCodes(error) {
  const codes = Array.isArray(error?.operationCodes) ? [...producerCodes].filter(code => error.operationCodes.includes(code)) : [];
  return codes.length ? codes : ["BACKUP_PRODUCER_FAILED"];
}

export function producerFailureMarker(error) {
  return `UCM_BACKUP_FAILURE:${producerFailureCodes(error).join(",")}\n`;
}

export function databaseFailureCode(error) {
  // No username, host, URL, SQL, password, server response or Error message.
  const codes = { "28P01": "DATABASE_AUTHENTICATION_REJECTED", "28000": "DATABASE_AUTHENTICATION_REJECTED", "42501": "DATABASE_PERMISSION_DENIED",
    "53300": "DATABASE_CONNECTION_LIMIT", "57014": "DATABASE_QUERY_TIMEOUT", ENOTFOUND: "DATABASE_NETWORK_UNAVAILABLE", ECONNREFUSED: "DATABASE_NETWORK_UNAVAILABLE",
    ECONNRESET: "DATABASE_NETWORK_UNAVAILABLE", ETIMEDOUT: "DATABASE_NETWORK_UNAVAILABLE" };
  return Object.hasOwn(codes, error?.code) ? codes[error.code] : "DATABASE_PREFLIGHT_FAILED";
}

export function resticFailureCodes(privateDiagnostic) {
  // Return only fixed categories. Never return a matching fragment, provider
  // response, bucket/endpoint/key, command, Error, stack or signed URL.
  const codes = resticPatterns.filter(([pattern]) => pattern.test(privateDiagnostic)).map(([, code]) => code);
  for (const match of privateDiagnostic.matchAll(/UCM_BACKUP_FAILURE:([A-Z_,]+)/g)) {
    for (const code of match[1].split(",")) if (producerCodes.has(code)) codes.push(code);
  }
  return [...new Set(codes)];
}

export function backblazeFailure(error, phase) {
  const firstLine = typeof error?.message === "string" ? error.message.split(/\r?\n/, 1)[0] : "";
  return { failureCode: b2Codes.has(firstLine) ? firstLine : "B2_OPERATION_FAILED",
    failurePhase: phases.has(phase) ? phase : "configuration",
    operationCodes: Array.isArray(error?.operationCodes) ? [...resticCodes].filter(code => error.operationCodes.includes(code)) : [] };
}
