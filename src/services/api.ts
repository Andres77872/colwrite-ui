import { emitRequireLogin } from './session';
import { ApiError, isUnknownRecord } from './contracts';

// Prefer relative base during development to avoid browser CORS via Vite proxy
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

export type ApiRequestInit = RequestInit & {
  /**
   * Handle a 401/403 locally instead of letting it sign the user out.
   * Used by the boot-time session check, which expects failure as a normal
   * outcome and resolves it itself.
   */
  suppressAuthEvent?: boolean;
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

/**
 * Rotate the access cookie, at most one rotation at a time.
 *
 * The app fires several requests the moment it mounts, and each rotation
 * invalidates the previous refresh token — firing them in parallel would look
 * like token reuse to the auth service and revoke the whole family. Everyone
 * who asks while a rotation is in flight waits on that same rotation.
 *
 * Uses a bare `fetch` rather than going through `request()` so a failing
 * refresh cannot recurse into another refresh.
 */
export function ensureRefreshed(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(buildUrl('/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
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
  const { suppressAuthEvent, headers: initHeaders, ...rest } = init ?? {};

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
  let res = await fetch(url, requestInit);

  // The access cookie's lifetime tracks the short access-token TTL, so an
  // expired session mid-visit is routine. Rotate once and replay before
  // treating it as a real sign-out.
  if (res.status === 401 && !isSelfReporting(path) && (await ensureRefreshed())) {
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

  if ((res.status === 401 || res.status === 403) && !suppressAuthEvent && !isSelfReporting(path)) {
    emitRequireLogin(res.status === 403 ? 'forbidden' : 'expired');
  }
  throw apiError(res, data);
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
