import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ApiError, get, post, put, del } from '../api';
import * as session from '../session';

beforeEach(() => {
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Resolve on a later macrotask, so concurrent callers all see it in flight. */
function slow(res: Response): Promise<Response> {
  return new Promise((resolve) => setTimeout(() => resolve(res), 0));
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockRoutes(route: Route) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(route(String(input), init)),
    );
}

describe('credentials policy', () => {
  it('sends the session cookie on every verb, including auth endpoints', async () => {
    const fetchSpy = mockRoutes(() => json({ ok: true }));

    await get('/document/load/1');
    await post('/auth/login', { username: 'a', password: 'b' });
    await put('/document/save/1', {});
    await del('/document/delete/1');

    // `/auth/*` used to default to 'omit', which would silently discard the
    // Set-Cookie that login exists to deliver.
    for (const [, opts] of fetchSpy.mock.calls) {
      expect((opts as RequestInit).credentials).toBe('include');
    }
  });

  it('does not leak suppressAuthEvent into the fetch init', async () => {
    const fetchSpy = mockRoutes(() => json({ ok: true }));

    await get('/users/profile', { suppressAuthEvent: true });

    const [, opts] = fetchSpy.mock.calls[0];
    expect('suppressAuthEvent' in (opts as object)).toBe(false);
  });
});

describe('401 handling on application endpoints', () => {
  it('rotates the session and replays the request once', async () => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    let listCalls = 0;
    let refreshCalls = 0;
    mockRoutes((url) => {
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1;
        return json({ authenticated: true });
      }
      listCalls += 1;
      return listCalls === 1 ? json({ detail: 'Missing session token' }, 401) : json({ count: 3 });
    });

    const result = await post<{ count: number }>('/document/list', { page: 1 });

    expect(result.count).toBe(3);
    expect(refreshCalls).toBe(1);
    expect(listCalls).toBe(2);
    // Recovered silently — the user is never bounced to the landing page.
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('rotates once for concurrent 401s', async () => {
    let refreshCalls = 0;
    let listCalls = 0;
    mockRoutes((url) => {
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1;
        // Each rotation invalidates the previous refresh token, so a second
        // concurrent rotation would look like token reuse and revoke the
        // whole family.
        return slow(json({ authenticated: true }));
      }
      listCalls += 1;
      return listCalls <= 2 ? json({ detail: 'expired' }, 401) : json({ count: 1 });
    });

    await Promise.all([post('/document/list', {}), post('/document/list', {})]);

    expect(refreshCalls).toBe(1);
    expect(listCalls).toBe(4);
  });

  it('gives up and requires login when the rotation also fails', async () => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    let refreshCalls = 0;
    mockRoutes((url) => {
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1;
        return json({ detail: 'Invalid refresh token' }, 401);
      }
      return json({ detail: 'Missing session token' }, 401);
    });

    await expect(post('/document/list', {})).rejects.toThrow('Missing session token');

    expect(refreshCalls).toBe(1);
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('expired');
  });

  it('does not try to rotate on 403 — the session is valid, the access is not', async () => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    let refreshCalls = 0;
    mockRoutes((url) => {
      if (url.includes('/auth/refresh')) refreshCalls += 1;
      return json({ detail: 'Session is not valid for this project' }, 403);
    });

    await expect(get('/document/load/1')).rejects.toThrow('Session is not valid for this project');

    expect(refreshCalls).toBe(0);
    expect(emitSpy).toHaveBeenCalledWith('forbidden');
  });

  it('respects suppressAuthEvent', async () => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    mockRoutes(() => json({ detail: 'Missing session token' }, 401));

    await expect(get('/users/profile', { suppressAuthEvent: true })).rejects.toThrow();

    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe('401 handling on auth endpoints', () => {
  it.each(['/auth/login', '/auth/logout', '/auth/refresh', '/auth/register'])(
    '%s reports its own failure without a rotation or a sign-out',
    async (path) => {
      const emitSpy = vi.spyOn(session, 'emitRequireLogin');
      const fetchSpy = mockRoutes(() => json({ detail: 'nope' }, 401));

      await expect(post(path, {})).rejects.toThrow('nope');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy).not.toHaveBeenCalled();
    },
  );
});

describe('typed API errors', () => {
  it('retains the HTTP status and parsed response metadata', async () => {
    const payload = {
      detail: [{ loc: ['body', 'name'], msg: 'Name is required' }],
      request_id: 'req-42',
    };
    mockRoutes(() => json(payload, 422));

    const error = await post('/document/create', {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      data: payload,
      message: 'Name is required',
    });
  });

  it('safely extracts a message nested in an object-valued detail', async () => {
    const payload = {
      detail: {
        provider: 'semantic_scholar',
        operation: 'search_papers',
        message: 'Semantic Scholar is temporarily unavailable.',
        retryable: true,
      },
    };
    mockRoutes(() => json(payload, 503));

    const error = await get('/research/semantic-scholar/search?query=test')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 503,
      data: payload,
      message: 'Semantic Scholar is temporarily unavailable.',
    });
  });
});

/**
 * A few endpoints fail closed on work the server is still finishing — the
 * history backfill for a document read this way for the first time, and the
 * per-document rate limiter shedding a burst. Both clear on their own in about
 * a second; waiting them out here is what keeps three panels from showing the
 * author a permanent failure for a transient one.
 */
describe('retryable problem backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function problem(body: unknown, status = 409, headers?: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/problem+json', ...headers },
    });
  }

  /** The exact body the server sends while a document's history is backfilling. */
  const HISTORY_NOT_READY = {
    type: 'https://colwrite.com/problems/history_not_ready',
    title: 'History Not Ready',
    status: 409,
    detail: 'Document history is not ready',
    instance: '/v2/documents/doc-1/revisions',
    code: 'history_not_ready',
    retryable: true,
    retry_after: 1,
  };

  it('replays a history_not_ready rejection and returns the eventual success', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(problem(HISTORY_NOT_READY))
      .mockResolvedValueOnce(json({ revisions: [], count: 0 }));

    const promise = get<{ count: number }>('/v2/documents/doc-1/revisions');
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({ revisions: [], count: 0 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('waits exactly as long as the Retry-After header asks', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        problem({ code: 'document_rate_limit_exceeded', retryable: true }, 429, {
          'Retry-After': '2',
        }),
      )
      .mockResolvedValueOnce(json({ ok: true }));

    const promise = get('/v2/documents/doc-1/revisions');
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to the body hint when no header is present', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        problem({ code: 'history_not_ready', retryable: true, retry_after: 3 }),
      )
      .mockResolvedValueOnce(json({ ok: true }));

    const promise = get('/v2/documents/doc-1/revisions');
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries on the problem code rather than the status', async () => {
    // `history_not_ready` is a 409 and rate limiting is a 429, so a
    // status-code test would have missed both.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(problem({ code: 'document_rate_limit_exceeded', retryable: true }, 429))
      .mockResolvedValueOnce(json({ chats: [], count: 0 }));

    const promise = get('/document/doc-1/chats');
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('gives up after the third attempt and surfaces one error', async () => {
    // A fresh Response per call: `text()` consumes the body, so a shared one
    // would be unusable on the replay.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(problem(HISTORY_NOT_READY)));

    const promise = get('/v2/documents/doc-1/revisions');
    const expectation = expect(promise).rejects.toBeInstanceOf(ApiError);
    await vi.runAllTimersAsync();
    await expectation;

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it.each([
    [
      'a plain 503 with no problem code',
      { detail: 'PDF compile capacity exceeded' },
      503,
    ],
    [
      'a problem the server does not call retryable',
      { code: 'stale_head', retryable: false },
      412,
    ],
    [
      'an unrecognised code, even when flagged retryable',
      { code: 'some_future_problem', retryable: true },
      503,
    ],
    [
      'a hint longer than we are willing to hold the request open',
      { code: 'document_rate_limit_exceeded', retryable: true, retry_after: 60 },
      429,
    ],
  ])('does not replay %s', async (_label, body, status) => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(problem(body, status)));

    const promise = get('/document/doc-1/chats');
    const expectation = expect(promise).rejects.toBeInstanceOf(ApiError);
    await vi.runAllTimersAsync();
    await expectation;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('honours an opt-out from the caller', async () => {
    // A fresh Response per call: `text()` consumes the body, so a shared one
    // would be unusable on the replay.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(problem(HISTORY_NOT_READY)));

    const promise = get('/v2/documents/doc-1/revisions', { retry: { maxAttempts: 1 } });
    const expectation = expect(promise).rejects.toBeInstanceOf(ApiError);
    await vi.runAllTimersAsync();
    await expectation;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Ours to read, not something to hand to fetch.
    expect('retry' in (fetchSpy.mock.calls[0][1] as object)).toBe(false);
  });

  it('replays a write under its original idempotency key', async () => {
    // A fresh key per attempt would let the server apply the same write twice.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(problem(HISTORY_NOT_READY))
      .mockResolvedValueOnce(json({ ok: true }));

    const promise = post('/v2/documents/doc-1/change-sets/cs-1/accept', undefined, {
      headers: { 'Idempotency-Key': 'idk-1', 'If-Match': 'cw:1' },
    });
    await vi.runAllTimersAsync();
    await promise;

    const keys = fetchSpy.mock.calls.map(
      ([, init]) => (init as RequestInit).headers as Record<string, string>,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]['Idempotency-Key']).toBe('idk-1');
    expect(keys[1]['Idempotency-Key']).toBe('idk-1');
  });

  it('an abort during the backoff rejects instead of replaying', async () => {
    // A fresh Response per call: `text()` consumes the body, so a shared one
    // would be unusable on the replay.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(problem(HISTORY_NOT_READY)));

    const controller = new AbortController();
    const promise = get('/v2/documents/doc-1/revisions', { signal: controller.signal });
    const expectation = expect(promise).rejects.toThrow('Aborted');
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await expectation;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
