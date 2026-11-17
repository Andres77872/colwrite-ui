/** Ephemeral composer choices belong to one workspace, page session and conversation. */
export type ConversationScope = {
  workspace: string;
  /** A draft gaining a server id is still the same page session. */
  page: string;
  chat: string | null;
  /** Explicit New chat resets choices even when the chat is already new. */
  chatEpoch: number;
};

export function conversationScopeKey(scope: ConversationScope): string {
  return JSON.stringify([scope.workspace, scope.page, scope.chatEpoch, scope.chat]);
}
