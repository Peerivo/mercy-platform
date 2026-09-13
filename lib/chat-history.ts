export type ChatMessage = {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  client_nonce: string;
};

export type ChatCursor = Pick<ChatMessage, "created_at" | "id">;

export const CHAT_PAGE_SIZE = 100;

export function compareMessages(a: ChatCursor, b: ChatCursor) {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

/**
 * Drain a keyset-paginated history. The cursor only advances through completed
 * database pages; Realtime messages are deliberately merged elsewhere.
 */
export async function drainChatHistory({
  cursor,
  loadPage,
  acceptPage,
  isCurrent,
}: {
  cursor?: ChatCursor;
  loadPage: (cursor: ChatCursor | undefined) => Promise<ChatMessage[]>;
  acceptPage: (rows: ChatMessage[]) => void;
  isCurrent: () => boolean;
}) {
  let completedCursor = cursor;
  while (isCurrent()) {
    const rows = await loadPage(completedCursor);
    if (!isCurrent()) return completedCursor;
    const ordered = [...rows].sort(compareMessages);
    acceptPage(ordered);
    if (ordered.length === 0) return completedCursor;
    completedCursor = ordered.at(-1);
    if (ordered.length < CHAT_PAGE_SIZE) return completedCursor;
  }
  return completedCursor;
}
