import { FormNotification } from "@/components/form-notification";
import type { ProfileActionState } from "@/features/profiles/types";

export const INITIAL_PROFILE_ACTION_STATE: ProfileActionState = {
  status: "idle",
  message: "",
};

export function ProfileFeedback({ state }: { state: ProfileActionState }) {
  if (!state.message || state.status === "idle") return null;

  return (
    <FormNotification variant={state.status === "success" ? "success" : "error"}>
      {state.message}
    </FormNotification>
  );
}
