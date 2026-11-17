import { AgentSocketError } from '@/api/assistant/agentSocket';
import type { ChatError } from '../ChatAssistant/chatUtils';

/** A run whose connection closed with neither `done` nor `error`: what is on screen may be cut off. */
export const INCOMPLETE_RUN: ChatError = {
  message: 'The connection dropped before the assistant finished, so what it wrote may be incomplete.',
  retryable: true,
};

/**
 * What a socket command's failure means for the author, by its code
 * (`ColWrite-api/docs/assistant-websocket.md#errors`). These have an action
 * of their own, so the same run is not offered again.
 */
const SOCKET_ACTIONS: Record<string, (serverMessage: string) => string> = {
  unauthorized: () => 'Sign in again to resume this conversation.',
  forbidden: () => 'The assistant cannot access this conversation. Check your access before reconnecting.',
  not_found: () => 'This saved conversation or run is no longer available. Open another conversation or start a new one.',
  conflict: () =>
    'This conversation already has a reply in progress. Wait for it to finish, then send again; reopen the conversation to follow it.',
  run_not_resumable: (serverMessage) =>
    serverMessage || 'This run has no checkpoint available. Open its plan to continue the remaining work.',
  // The server's sentence says which limit: replies in progress, or saved conversations.
  limit_exceeded: (serverMessage) =>
    serverMessage || 'The assistant is at a limit for this account. Wait for a reply in progress to finish, then send again.',
};

/** A run that threw instead of reporting an `error` event: a lost or refused connection. */
export function thrownRunError(error: unknown): ChatError {
  const raw = error instanceof Error ? error.message : '';
  const action = error instanceof AgentSocketError && Object.hasOwn(SOCKET_ACTIONS, error.code)
    ? SOCKET_ACTIONS[error.code]?.(raw)
    : undefined;
  return {
    message: action || 'The assistant connection was interrupted. Reconnect to check the saved run.',
    detail: raw || undefined,
    retryable: !action,
  };
}
