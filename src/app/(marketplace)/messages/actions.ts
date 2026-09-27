"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireVerifiedActiveStudent } from "@/lib/auth/authorization";
import {
  MESSAGE_MAX_LENGTH,
  type ConversationMessage,
} from "@/lib/message-utils";

export type SendMessageState = {
  message: string | null;
  error: boolean;
  sentMessage: ConversationMessage | null;
};

const messageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z
    .string()
    .trim()
    .min(1, "Write a message first.")
    .max(
      MESSAGE_MAX_LENGTH,
      `Keep messages within ${MESSAGE_MAX_LENGTH.toLocaleString("en-US")} characters.`,
    ),
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
    return {
      message: parsed.error.issues[0]?.message ?? "Check your message.",
      error: true,
      sentMessage: null,
    };
  }

  const { supabase } = await requireVerifiedActiveStudent(
    `/messages/${parsed.data.conversationId}`,
  );
  const { data: messageId, error } = await supabase.rpc(
    "send_conversation_message",
    {
    p_conversation_id: parsed.data.conversationId,
    p_body: parsed.data.body,
    },
  );

  if (error || typeof messageId !== "string") {
    console.warn("Unable to send conversation message", {
      code: error?.code ?? "invalid_result",
    });
    return {
      message: "Message could not be sent. Please try again.",
      error: true,
      sentMessage: null,
    };
  }

  const { data: insertedMessage, error: insertedMessageError } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at, read_at")
    .eq("id", messageId)
    .eq("conversation_id", parsed.data.conversationId)
    .maybeSingle();

  if (insertedMessageError) {
    console.warn("Message sent but its row could not be refreshed", {
      code: insertedMessageError.code,
    });
  }

  revalidatePath(`/messages/${parsed.data.conversationId}`);
  revalidatePath("/messages");
  return {
    message: null,
    error: false,
    sentMessage: insertedMessage
      ? {
          id: String(insertedMessage.id),
          senderId: String(insertedMessage.sender_id),
          body: String(insertedMessage.body),
          createdAt: String(insertedMessage.created_at),
          readAt:
            typeof insertedMessage.read_at === "string"
              ? insertedMessage.read_at
              : null,
        }
      : null,
  };
}

const conversationIdSchema = z.string().uuid();

export async function markConversationRead(conversationId: string) {
  const parsedId = conversationIdSchema.safeParse(conversationId);
  if (!parsedId.success) return false;

  const { supabase } = await requireVerifiedActiveStudent(
    `/messages/${parsedId.data}`,
  );
  const { data: updatedCount, error } = await supabase.rpc(
    "mark_conversation_read",
    {
      p_conversation_id: parsedId.data,
    },
  );

  if (error) {
    console.warn("Unable to mark conversation as read", { code: error.code });
    return false;
  }

  if (typeof updatedCount === "number" && updatedCount > 0) {
    revalidatePath(`/messages/${parsedId.data}`);
    revalidatePath("/messages");
  }
  return true;
}
