// Centralized session and auth event utilities

export const UNAUTHORIZED_EVENT = 'colwrite:auth:unauthorized';

export type UnauthorizedReason = 'expired' | 'forbidden';

export type UnauthorizedDetail = { reason: UnauthorizedReason; message: string };

const REASON_MESSAGES: Record<UnauthorizedReason, string> = {
  expired: 'Your session expired. Please sign in again.',
  forbidden: 'This account does not have access to this workspace.',
};

/**
 * Purge a `session_token` cookie written by an older build of this app.
 *
 * The real session cookie is HttpOnly and set by the server — JavaScript can
 * neither read nor delete it. This only removes the non-HttpOnly cookie of the
 * same name that we used to write ourselves. Leaving one behind is not
 * harmless: the browser would send both on every request and the server keeps
 * whichever it parses last, so a stale value can shadow the live session.
 */
export function clearLegacySessionCookie(): void {
  try {
    document.cookie = 'session_token=; Path=/; Max-Age=0; SameSite=Lax';
  } catch {
    // no-op
  }
}

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
