// Centralized session and auth event utilities

export const UNAUTHORIZED_EVENT = 'colwrite:auth:unauthorized';

export function setSessionTokenCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 7): void {
  try {
    const secure = window.location.protocol === 'https:';
    const cookie = [
      `session_token=${encodeURIComponent(token)}`,
      `Path=/`,
      `Max-Age=${maxAgeSeconds}`,
      `SameSite=Lax`,
      secure ? 'Secure' : '',
    ].filter(Boolean).join('; ');
    document.cookie = cookie;
  } catch {
    // no-op
  }
}

export function clearSessionTokenCookie(): void {
  try {
    document.cookie = 'session_token=; Path=/; Max-Age=0; SameSite=Lax';
  } catch {
    // no-op
  }
}

// Throttle unauthorized prompts to avoid spamming the UI multiple times in quick succession
let lastUnauthorizedAt = 0;
const UNAUTHORIZED_THROTTLE_MS = 1500;

export function emitRequireLogin(): void {
  try {
    clearSessionTokenCookie();
  } catch {
    // ignore
  }
  const now = Date.now();
  if (now - lastUnauthorizedAt < UNAUTHORIZED_THROTTLE_MS) return;
  lastUnauthorizedAt = now;
  try {
    const evt = new Event(UNAUTHORIZED_EVENT);
    window.dispatchEvent(evt);
  } catch {
    // ignore
  }
}
