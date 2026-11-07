import { isDeepStrictEqual } from "node:util";

export const fingerprintFormat = "postgres-jsonb-c-v1";
export const fingerprintSettingsSql = `select set_config('TimeZone','UTC',false),
  set_config('DateStyle','ISO, MDY',false), set_config('IntervalStyle','postgres',false),
  set_config('extra_float_digits','3',false), set_config('bytea_output','hex',false)`;

function refuse(code) {
  throw Object.assign(new Error("Restored database comparison failed; private details withheld."), { operationCodes: [code] });
}

export function verifyTableFingerprints(actual, expected) {
  const names = Object.keys(expected).sort();
  if (!isDeepStrictEqual(Object.keys(actual).sort(), names)) refuse("RESTORE_TABLE_SET_MISMATCH");
  if (names.some(name => actual[name].count !== expected[name].count)) refuse("RESTORE_TABLE_ROW_COUNT_MISMATCH");
  if (names.some(name => actual[name].fingerprint !== expected[name].fingerprint)) refuse("RESTORE_TABLE_DATA_MISMATCH");
}
