// Centralized session and auth event utilities

export const UNAUTHORIZED_EVENT = 'colwrite:auth:unauthorized';

export type UnauthorizedReason = 'expired' | 'forbidden';

export type UnauthorizedDetail = { reason: UnauthorizedReason; message: string };

const REASON_MESSAGES: Record<UnauthorizedReason, string> = {
  expired: 'Your session expired. Please sign in again.',
  forbidden: 'This account does not have access to this workspace.',
};

// Throttle unauthorized prompts to avoid spamming the UI multiple times in quick succession
let lastUnauthorizedAt = 0;
const UNAUTHORIZED_THROTTLE_MS = 1500;

/**
 * Announce that the session is gone and the user has to sign in again.
 *
 * Callers must only reach this after a refresh attempt has already failed —
 * an expired access token is routine and recoverable, and bouncing on it
 * would sign people out every fifteen minutes.
 */
export function emitRequireLogin(reason: UnauthorizedReason = 'expired'): void {
  const now = Date.now();
  if (now - lastUnauthorizedAt < UNAUTHORIZED_THROTTLE_MS) return;
  lastUnauthorizedAt = now;
  try {
    const evt = new CustomEvent<UnauthorizedDetail>(UNAUTHORIZED_EVENT, {
      detail: { reason, message: REASON_MESSAGES[reason] },
    });
    window.dispatchEvent(evt);
  } catch {
    // ignore
  }
}
