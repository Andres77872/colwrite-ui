import createClient, { type Middleware } from 'openapi-fetch';
import { uid } from '@/lib/uid';
import { emitRequireLogin } from './authEvents';
import { abortableSleep, mayReplay, retryWaitMs } from './retry';
import type { paths } from './schema';
import { apiErrorFrom, problemCode, problemRetryAfter } from './errors';
import { ensureRefreshed, getRefreshGeneration, sessionFetch } from './session';
import { API_BASE } from './url';

/**
 * The one client for ColWrite-api, typed by the contract
 * (`src/api/schema.d.ts`, generated from `ColWrite-api/contract/openapi.json`).
 *
 * Every request carries the session cookies and an `X-Request-Id`. A response
 * that is not 2xx rejects with an `ApiError` holding the problem body, so a
 * resolved call always has `data`. Before that:
 *
 * - a 401 refreshes the session once (shared between tabs) and replays;
 * - a problem the server marks retryable (the per-document rate limit) is
 *   replayed after the server's `Retry-After`;
 * - a 401 that survives, or a 403 about the session itself, signs the author
 *   out, except on the clients below that report their own failures. A 403
 *   about one action (a role, an invitation for another address, a policy)
 *   is the caller's to say.
 */

/** Total attempts, including the first, for a problem the server calls retryable. */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

type Policy = {
  /** Refresh the session on a 401 and replay the request. */
  refresh: boolean;
  /** A 401 or 403 that survives ends the session for the whole app. */
  signOut: boolean;
};

/**
 * The 403s that are about the session, not one action: a session scoped to
 * another project (`ColWrite-api/docs/auth.md#error-behavior`). Every other
 * 403 (`workspace_role_required`, `invitation_email_mismatch`,
 * `workspace_policy`, …) refuses one request of a signed-in account.
 */
const SESSION_FORBIDDEN: ReadonlySet<string> = new Set(['forbidden', 'project_access_denied']);

function endsSession(status: number, error: unknown): boolean {
  if (status === 401) return true;
  if (status !== 403) return false;
  const code = problemCode(error);
  return code === null || SESSION_FORBIDDEN.has(code);
}

/** A request as it left, so it can be sent again, and the session it was sent under. */
type Sent = { request: Request; generation: string | null };

/** `Retry-After` in seconds. This API never sends the HTTP-date form. */
function retryAfterHeader(headers: Headers): number | null {
  const seconds = Number.parseInt(headers.get('Retry-After') ?? '', 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Joins a reported failure to the server's record of the request (`docs/errors.md`). */
const requestIdHeader: Middleware = {
  onRequest({ request }) {
    if (!request.headers.has('X-Request-Id')) request.headers.set('X-Request-Id', uid());
  },
};

/**
 * The API serves its agent routes at `/api/agent/*` itself. Behind the `/api`
 * proxy, which forwards those unchanged, that prefix is not doubled.
 */
const agentRoutes: Middleware = {
  onRequest({ request, schemaPath }) {
    if (!API_BASE.endsWith('/api') || !schemaPath.startsWith('/api/')) return undefined;
    return new Request(request.url.replace('/api/api/', '/api/'), request);
  },
};

/** A 401 on a session that can be refreshed: refresh once, then send the request again. */
function refreshOn401(sent: Map<string, Sent>): Middleware {
  return {
    async onResponse({ response, id }) {
      const original = sent.get(id);
      if (response.status !== 401 || !original || !(await ensureRefreshed(original.generation))) return undefined;
      try {
        return await sessionFetch(original.request.clone());
      } catch (error) {
        sent.delete(id);
        throw error;
      }
    },
  };
}

/**
 * Every non-2xx becomes an `ApiError`, after a problem the server calls
 * retryable has been given its wait and its replays.
 */
function problemToApiError(policy: Policy, sent: Map<string, Sent>): Middleware {
  return {
    onRequest({ request, id }) {
      sent.set(id, { request: request.clone(), generation: getRefreshGeneration() });
    },
    async onResponse({ response, id }) {
      const original = sent.get(id);
      sent.delete(id);
      let current = response;
      for (let attempt = 1; !current.ok && original && attempt < MAX_ATTEMPTS; attempt += 1) {
        const error = apiErrorFrom(current, await readBody(current.clone()));
        if (!mayReplay(original.request, error)) break;
        const wait = retryWaitMs(attempt, RETRY_BASE_DELAY_MS, retryAfterHeader(current.headers) ?? problemRetryAfter(error));
        if (wait === null) break;
        await abortableSleep(wait, original.request.signal);
        current = await sessionFetch(original.request.clone());
      }

      if (current.ok) return current === response ? undefined : current;

      const error = apiErrorFrom(current, await readBody(current));
      if (policy.signOut && endsSession(current.status, error)) {
        emitRequireLogin(current.status === 403 ? 'forbidden' : 'expired');
      }
      throw error;
    },
    onError({ id }) {
      sent.delete(id);
    },
  };
}

/**
 * `API_BASE` as an absolute URL. A `Request` needs one; in the browser this is
 * the same address the relative base names.
 */
function absoluteBase(): string {
  return new URL(API_BASE || '/', window.location.href).href;
}

function client(policy: Policy) {
  const sent = new Map<string, Sent>();
  const created = createClient<paths>({
    baseUrl: absoluteBase(),
    credentials: 'include',
    fetch: sessionFetch,
  });
  // `onResponse` runs in the reverse order: the refresh sees a 401 before it
  // becomes an error.
  created.use(requestIdHeader, agentRoutes, problemToApiError(policy, sent));
  if (policy.refresh) created.use(refreshOn401(sent));
  return created;
}

/** Everything the app reads and writes. */
export const api = client({ refresh: true, signOut: true });

/**
 * Sign-in, sign-out and refresh: a 401 there means a wrong password or a
 * spent session, which the caller reports itself.
 */
export const authApi = client({ refresh: false, signOut: false });

/** The boot-time session check, which expects failure and resolves it itself. */
export const sessionCheckApi = client({ refresh: true, signOut: false });

export type ApiClient = typeof api;

/** What a call settles to. A non-2xx has already rejected in the middleware. */
type Settled<T> = { data?: T; response: Response };

/** The body of a successful call. */
export async function unwrap<T>(call: Promise<Settled<T>>): Promise<T> {
  return (await unwrapWithHeaders(call)).data;
}

/** The body and the headers of a successful call (the v2 `ETag`, `Content-Disposition`). */
export async function unwrapWithHeaders<T>(call: Promise<Settled<T>>): Promise<{ data: T; headers: Headers }> {
  const { data, response } = await call;
  if (data === undefined) throw new Error('The server sent an empty response.');
  return { data, headers: response.headers };
}

/**
 * A multipart body. The contract types a binary part as `string`
 * (`format: binary`), which a `File` is not, so the caller builds the form and
 * it goes out as the body the route declares. The client sends `FormData`
 * untouched, and the browser writes its boundary into the `Content-Type`.
 */
export function multipartBody<T>(form: FormData): T {
  return form as unknown as T;
}
