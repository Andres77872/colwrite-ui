import { describe, it, expect, vi, beforeEach } from 'vitest';
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
