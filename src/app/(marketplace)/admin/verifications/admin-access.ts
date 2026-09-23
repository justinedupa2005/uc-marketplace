import "server-only";

export {
  getActiveAdmin,
  requireActiveAdmin,
} from "@/lib/auth/authorization";

export const VERIFICATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
