import { readJson, sessionRefreshKey, writeJson } from '@/lib/storageKeys';
import { resolveApiPath } from './url';

/**
 * The session cookies, refreshed once at a time.
 *
 * The provider rotates a refresh token exactly once: replaying a spent token
 * revokes the whole token family (`ColWrite-api/docs/auth.md`). So a refresh
 * is single-flight in this tab and exclusive across same-origin tabs, through
 * a Web Lock (HTTPS or localhost). A tab that waited for the lock adopts the
 * rotation another tab just finished instead of repeating it. No token is
 * readable or stored here: the credentials stay in HttpOnly cookies.
 * Production without Web Locks fails closed to sign-in; development keeps
 * one-tab refresh. See https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API.
 */

const REFRESH_URL = resolveApiPath('/auth/refresh');
const SESSION_LOCK = `colwrite:session:${REFRESH_URL}`;
const REFRESH_MARKER_KEY = sessionRefreshKey(REFRESH_URL);
const REFRESH_FRESHNESS_MS = 5_000;

/** The endpoints that set or consume the session cookies. */
const COOKIE_ENDPOINTS = ['/auth/login', '/auth/logout', '/auth/refresh'] as const;

function cookieEndpoint(request: Request): (typeof COOKIE_ENDPOINTS)[number] | null {
  const path = new URL(request.url).pathname;
  return COOKIE_ENDPOINTS.find((endpoint) => path.endsWith(endpoint)) ?? null;
}

type RefreshMarker = { generation: string; completedAt: number; ok: boolean };

let refreshInFlight: Promise<boolean> | null = null;

function sessionLocks(): LockManager | undefined {
  return typeof navigator !== 'undefined' ? navigator.locks : undefined;
}

function readRefreshMarker(): RefreshMarker | null {
  // Blocked storage does not prevent exclusive cookie rotation.
  const value = readJson(REFRESH_MARKER_KEY) as Partial<RefreshMarker> | null | undefined;
  if (
    value && typeof value === 'object'
    && typeof value.generation === 'string' && value.generation.length > 0 && value.generation.length <= 100
    && typeof value.completedAt === 'number' && Number.isFinite(value.completedAt)
    && typeof value.ok === 'boolean'
  ) {
    return value as RefreshMarker;
  }
  return null;
}

/** Capture before an authenticated request so a late 401 can adopt a peer refresh. */
export function getRefreshGeneration(): string | null {
  return readRefreshMarker()?.generation ?? null;
}

function recordRefreshCompletion(ok: boolean): void {
  // Coordination metadata only. A refused write is fine: the Web Lock still
  // prevents overlapping rotations.
  writeJson(REFRESH_MARKER_KEY, {
    generation: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    completedAt: Date.now(),
    ok,
  } satisfies RefreshMarker);
}

async function exclusiveSessionMutation<T>(mutate: () => Promise<T>): Promise<T> {
  const locks = sessionLocks();
  if (!locks) return mutate();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    // The signal only limits waiting for the lock. Once acquired, hold it
    // until fetch settles; never release a still-running token rotation.
    return await locks.request(SESSION_LOCK, { mode: 'exclusive', signal: controller.signal }, mutate);
  } finally {
    clearTimeout(timeout);
  }
}

/** Refresh the session cookies, sharing a rotation already done by this or another tab. */
export function ensureRefreshed(observedGeneration: string | null = getRefreshGeneration()): Promise<boolean> {
  if (!refreshInFlight) {
    const locks = sessionLocks();
    refreshInFlight = (async () => {
      if (!locks && import.meta.env.PROD) return false;
      return exclusiveSessionMutation(async () => {
        if (locks) {
          const marker = readRefreshMarker();
          const age = marker ? Date.now() - marker.completedAt : Infinity;
          if (marker && (marker.generation !== observedGeneration || (age >= 0 && age <= REFRESH_FRESHNESS_MS))) {
            return marker.ok;
          }
        }
        try {
          const response = await fetch(REFRESH_URL, { method: 'POST', credentials: 'include' });
          if (locks) recordRefreshCompletion(response.ok);
          return response.ok;
        } catch {
          if (locks) recordRefreshCompletion(false);
          return false;
        }
      });
    })().catch(() => false).finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

/**
 * `fetch` for every API request: the endpoints that change the session
 * cookies run inside the same exclusive lock as a refresh, so a sign-in
 * never interleaves with a rotation in another tab.
 */
export async function sessionFetch(request: Request): Promise<Response> {
  const endpoint = cookieEndpoint(request);
  if (!endpoint) return fetch(request);
  return exclusiveSessionMutation(async () => {
    try {
      const response = await fetch(request);
      if (sessionLocks() && (response.ok || endpoint === '/auth/logout' || endpoint === '/auth/refresh')) {
        recordRefreshCompletion(endpoint !== '/auth/logout' && response.ok);
      }
      return response;
    } catch (error) {
      if (sessionLocks() && endpoint === '/auth/logout') recordRefreshCompletion(false);
      throw error;
    }
  });
}
