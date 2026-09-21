import "server-only";

// Keep the link flow until the hosted Confirm sign up template and OTP expiry
// have both been changed. The default email provider cannot send custom codes.
export function usesCodeConfirmation() {
  return process.env.EMAIL_CONFIRMATION_MODE === "code";
}
