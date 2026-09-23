import { isAuthRetryableFetchError } from "@supabase/supabase-js";

type AuthErrorShape = {
  code?: unknown;
  name?: unknown;
  status?: unknown;
};

export function isAuthServiceUnavailable(error: unknown) {
  if (!error) {
    return false;
  }

  if (isAuthRetryableFetchError(error)) {
    return true;
  }

  const authError = error as AuthErrorShape;
  const status =
    typeof authError.status === "number" ? authError.status : null;

  return (
    authError.code === "request_timeout" ||
    authError.name === "AuthRetryableFetchError" ||
    authError.name === "AuthUnknownError" ||
    status === 0 ||
    (status !== null && status >= 500)
  );
}
