export const MESSAGE_MAX_LENGTH = 2_000;
export const MESSAGE_PAGE_SIZE = 50;

export type ConversationMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

export function normalizeMessageBody(value: string) {
  return value.trim();
}

export function isValidMessageBody(value: string) {
  const body = normalizeMessageBody(value);
  return body.length > 0 && body.length <= MESSAGE_MAX_LENGTH;
}

function compareMessages(
  first: ConversationMessage,
  second: ConversationMessage,
) {
  const timeDifference =
    new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime();

  return timeDifference || first.id.localeCompare(second.id);
}

export function mergeConversationMessages(
  current: ConversationMessage[],
  incoming: ConversationMessage[],
) {
  const messagesById = new Map(
    current.map((message) => [message.id, message] as const),
  );

  for (const message of incoming) {
    const existing = messagesById.get(message.id);
    messagesById.set(
      message.id,
      existing
        ? {
            ...existing,
            readAt: message.readAt ?? existing.readAt,
          }
        : message,
    );
  }

  return [...messagesById.values()].sort(compareMessages);
}
