"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";

export type SendMessageState = { message: string | null; error: boolean };

const messageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1, "Write a message first.").max(2000, "Keep messages within 2,000 characters."),
});

export async function sendMessage(
  _previousState: SendMessageState,
  formData: FormData,
): Promise<SendMessageState> {
  const parsed = messageSchema.safeParse({
    conversationId: formData.get("conversationId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Check your message.", error: true };
  }

  const { supabase } = await requireVerifiedActiveStudent(
    `/messages/${parsed.data.conversationId}`,
  );
  const { error } = await supabase.rpc("send_conversation_message", {
    p_conversation_id: parsed.data.conversationId,
    p_body: parsed.data.body,
  });

  if (error) {
    console.warn("Unable to send conversation message", { code: error.code });
    return { message: "Unable to send your message. Please try again.", error: true };
  }

  revalidatePath(`/messages/${parsed.data.conversationId}`);
  revalidatePath("/messages");
  return { message: "Message sent.", error: false };
}
