import { emitRequireLogin } from './session';
import { ApiError, isUnknownRecord, problemRetryAfter } from './contracts';
import { abortableSleep, isRetryableProblem, retryWaitMs } from './retry';

// Prefer relative base during development to avoid browser CORS via Vite proxy
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

export type ApiRequestInit = RequestInit & {
  /**
   * Handle a 401/403 locally instead of letting it sign the user out.
   * Used by the boot-time session check, which expects failure as a normal
   * outcome and resolves it itself.
   */
  suppressAuthEvent?: boolean;
  /**
   * Backoff policy for the server's typed "not ready yet" problems. Applied by
   * default; pass `{ maxAttempts: 1 }` to see the first rejection immediately.
   */
  retry?: { maxAttempts?: number; baseDelayMs?: number };
};

/**
 * Endpoints that report their own failures.
 *
 * A 401 from `/auth/login` means the password was wrong, not that the current
 * session died — treating it as the latter used to sign out an already
 * signed-in user the moment they mistyped. A 401 from `/auth/logout` used to
 * pop the sign-in dialog straight back open after signing out.
 */
const SELF_REPORTING_PATHS = new Set([
  '/auth/login',
  '/auth/logout',
  '/auth/refresh',
  '/auth/register',
  '/auth/check-availability',
]);

function isSelfReporting(path: string): boolean {
  return SELF_REPORTING_PATHS.has(path.split('?')[0]);
}

export function buildUrl(path: string): string {
  const base = API_BASE.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function apiError(res: Response, data: unknown): ApiError {
  const payload = isUnknownRecord(data) ? data : null;
  let msg = res.statusText;
  if (payload) {
    if (typeof payload.message === 'string') msg = payload.message;
    else if (Array.isArray(payload.detail)) {
      // FastAPI validation errors arrive as a list of per-field objects.
      msg = payload.detail
        .map((detail) => {
          if (!isUnknownRecord(detail)) return JSON.stringify(detail);
          if (typeof detail.msg === 'string') return detail.msg;
          if (typeof detail.message === 'string') return detail.message;
          return JSON.stringify(detail);
        })
        .join('; ');
    } else if (typeof payload.detail === 'string') msg = payload.detail;
    else if (
      isUnknownRecord(payload.detail)
      && typeof payload.detail.message === 'string'
    ) {
      msg = payload.detail.message;
    }
  }
  return new ApiError(msg, res.status, data);
}

let refreshInFlight: Promise<boolean> | null = null;
const SESSION_LOCK = `colwrite:session:${buildUrl('/auth/refresh')}`;
const REFRESH_MARKER_KEY = `${SESSION_LOCK}:completion:v1`;
const REFRESH_FRESHNESS_MS = 5_000;
type RefreshMarker = { generation: string; completedAt: number; ok: boolean };

function sessionLocks(): LockManager | undefined {
  return typeof navigator !== 'undefined' ? navigator.locks : undefined;
}

function readRefreshMarker(): RefreshMarker | null {
  try {
    const raw = window.localStorage.getItem(REFRESH_MARKER_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (isUnknownRecord(value) && typeof value.generation === 'string' &&
      value.generation.length > 0 && value.generation.length <= 100 &&
      typeof value.completedAt === 'number' && Number.isFinite(value.completedAt) &&
      typeof value.ok === 'boolean') {
      return value as RefreshMarker;
    }
  } catch { /* Blocked storage does not prevent exclusive cookie rotation. */ }
  return null;
}

/** Capture before an authenticated request so a late 401 can adopt a peer refresh. */
export function getRefreshGeneration(): string | null {
  return readRefreshMarker()?.generation ?? null;
}

function recordRefreshCompletion(ok: boolean): void {
  // This is coordination metadata only. Credentials stay in HttpOnly cookies.
  const marker: RefreshMarker = {
    generation: typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    completedAt: Date.now(),
    ok,
  };
  try { window.localStorage.setItem(REFRESH_MARKER_KEY, JSON.stringify(marker)); }
  catch { /* The Web Lock still prevents overlapping rotations. */ }
}

async function exclusiveSessionMutation<T>(mutate: () => Promise<T>): Promise<T> {
  const locks = sessionLocks();
  if (!locks) return mutate();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    // The signal only limits waiting for the lock. Once acquired, hold it
    // until fetch settles; never release a still-running token rotation.
    return await locks.request(SESSION_LOCK, {
      mode: 'exclusive', signal: controller.signal,
    }, mutate);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Single-flight in this context and exclusive across same-origin tabs.
 *
 * Web Locks (HTTPS or localhost) serialize cookie writes; the shared successful
 * generation avoids repeating a rotation already completed by another tab.
 * No access/refresh tokens are readable or persisted by this coordinator.
 * Production without Web Locks fails closed to sign-in. Development retains
 * one-context refresh support; concurrent tabs there require a secure context.
 * See https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API.
 */
export function ensureRefreshed(
  observedGeneration: string | null = getRefreshGeneration(),
): Promise<boolean> {
  if (!refreshInFlight) {
    const locks = sessionLocks();
    refreshInFlight = (async () => {
      if (!locks && import.meta.env.PROD) return false;
      return exclusiveSessionMutation(async () => {
        // Without shared locks keep the original development behavior. A
        // localStorage timestamp alone is never a mutual-exclusion lock.
        if (locks) {
          const marker = readRefreshMarker();
          const age = marker ? Date.now() - marker.completedAt : Infinity;
          if (marker && (marker.generation !== observedGeneration ||
            (age >= 0 && age <= REFRESH_FRESHNESS_MS))) return marker.ok;
        }
        try {
          const response = await fetch(buildUrl('/auth/refresh'), {
            method: 'POST', credentials: 'include',
          });
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

/** Serialize all cookie-changing endpoints with refresh, without recursion. */
async function fetchWithSessionBoundary(
  path: string, url: string, init: RequestInit,
): Promise<Response> {
  const endpoint = path.split('?')[0];
  if (!['/auth/login', '/auth/register', '/auth/logout', '/auth/refresh'].includes(endpoint)) {
    return fetch(url, init);
  }
  return exclusiveSessionMutation(async () => {
    try {
      const response = await fetch(url, init);
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

/**
 * A parsed response body plus its headers.
 *
 * Most endpoints put their whole contract in the body, but the v2 document
 * endpoints carry the concurrency token in a strong `ETag` header that every
 * subsequent write must echo back as `If-Match` — dropping headers there
 * makes writes impossible, not just lossy.
 */
export type ApiResponse<T> = { data: T; headers: Headers };

/** Total attempts, including the first, for a problem the server calls retryable. */
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;

/** `Retry-After` in seconds. This API never sends the HTTP-date form. */
function retryAfterHeader(headers: Headers): number | null {
  const raw = headers.get('Retry-After');
  if (!raw) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init?: ApiRequestInit,
): Promise<T> {
  const { data } = await requestWithHeaders<T>(method, path, body, init);
  return data;
}

async function requestWithHeaders<T>(
  method: string,
  path: string,
  body?: unknown,
  init?: ApiRequestInit,
): Promise<ApiResponse<T>> {
  const { suppressAuthEvent, headers: initHeaders, retry, ...rest } = init ?? {};

  // A multipart body carries its own generated boundary in the Content-Type
  // header, so it has to go through untouched — JSON-encoding it would send
  // `{}`, and setting the header by hand would omit the boundary. Note the
  // 401 replay below re-sends this same object; that is safe for FormData
  // (fetch builds a fresh stream per call) but would not be for a stream.
  const isMultipart = typeof FormData !== 'undefined' && body instanceof FormData;

  const requestInit: RequestInit = {
    ...rest,
    method,
    // The session lives in an HttpOnly cookie, so every request — including
    // the auth endpoints, which either set or consume that cookie — needs it.
    credentials: 'include',
    headers:
      body !== undefined && !isMultipart
        ? { 'Content-Type': 'application/json', ...(initHeaders || {}) }
        : initHeaders,
    ...(body !== undefined
      ? { body: isMultipart ? (body as FormData) : JSON.stringify(body) }
      : {}),
  };

  const url = buildUrl(path);
  const maxAttempts = Math.max(1, retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = retry?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;

  for (let attempt = 1; ; attempt += 1) {
    const observedGeneration = getRefreshGeneration();
    let res = await fetchWithSessionBoundary(path, url, requestInit);

    // The access cookie's lifetime tracks the short access-token TTL, so an
    // expired session mid-visit is routine. Rotate once and replay before
    // treating it as a real sign-out.
    if (res.status === 401 && !isSelfReporting(path) && (await ensureRefreshed(observedGeneration))) {
      res = await fetch(url, requestInit);
    }

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.ok) return { data: data as T, headers: res.headers };

    const error = apiError(res, data);

    // The problems we replay — rate limiting, history still being prepared —
    // are rejected before the handler does any work, so nothing was written
    // and any verb is safe to replay. An `Idempotency-Key` the caller minted
    // rides along in `requestInit` and stays the same across attempts, so a
    // write that did land somehow still cannot be applied twice.
    if (attempt < maxAttempts && isRetryableProblem(error)) {
      const wait = retryWaitMs(
        attempt,
        baseDelayMs,
        retryAfterHeader(res.headers) ?? problemRetryAfter(error),
      );
      if (wait !== null) {
        await abortableSleep(wait, rest.signal ?? undefined);
        continue;
      }
    }

    if ((res.status === 401 || res.status === 403) && !suppressAuthEvent && !isSelfReporting(path)) {
      emitRequireLogin(res.status === 403 ? 'forbidden' : 'expired');
    }
    throw error;
  }
}

export async function get<T>(path: string, init?: ApiRequestInit): Promise<T> {
  return request<T>('GET', path, undefined, init);
}

export async function post<T>(path: string, body?: unknown, init?: ApiRequestInit): Promise<T> {
  return request<T>('POST', path, body, init);
}

export async function put<T>(path: string, body?: unknown, init?: ApiRequestInit): Promise<T> {
  return request<T>('PUT', path, body, init);
}

export async function del<T>(path: string, init?: ApiRequestInit): Promise<T> {
  return request<T>('DELETE', path, undefined, init);
}

export async function getWithHeaders<T>(
  path: string,
  init?: ApiRequestInit,
): Promise<ApiResponse<T>> {
  return requestWithHeaders<T>('GET', path, undefined, init);
}

export async function postWithHeaders<T>(
  path: string,
  body?: unknown,
  init?: ApiRequestInit,
): Promise<ApiResponse<T>> {
  return requestWithHeaders<T>('POST', path, body, init);
}

export { ApiError } from './contracts';
