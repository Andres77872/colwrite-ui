import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as session from '@/api/authEvents';
import type { DocumentListResponse, ErrorCode, ProblemDetails } from '@/api/schema';
import { HttpResponse, agentHttp, delay, http, pathOf, problem, recordRequests, server } from '@/__tests__/server';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { me } from '@/dev/msw/fixtures';
import { api, authApi, sessionCheckApi, unwrap } from '../client';
import { ApiError } from '../errors';

beforeEach(() => {
  vi.restoreAllMocks();
});

const isRefresh = (request: Request) => new URL(request.url).pathname.endsWith('/auth/refresh');

const WS = TEST_WORKSPACE_ID;
const WORKSPACE = { path: { workspace_id: WS } };
const LIST: DocumentListResponse = { items: [], next_cursor: 'more' };
const SESSION = { user_id: 'u', user: {}, project: { project_hash: 'p' }, authenticated: true, remember_me: false, success: true, token_type: 'Bearer' } as const;
const PAGE_PATH = { path: { workspace_id: WS, document_id: '1' } };

/** The page list, the read these tests send. */
const list = () => api.GET('/workspaces/{workspace_id}/documents', { params: WORKSPACE });
const answerList = (answer: (call: number) => Response | Promise<Response>) => {
  let calls = 0;
  server.use(http.get('/workspaces/{workspace_id}/documents', async ({ response }) => response.untyped(await answer(++calls))));
  return () => calls;
};
const answerRefresh = (answer: () => Response | Promise<Response>) => {
  let calls = 0;
  server.use(http.post('/auth/refresh', async ({ response }) => {
    calls += 1;
    return response.untyped(await answer());
  }));
  return () => calls;
};

describe('what every request carries', () => {
  it('sends the session cookie on every verb, including the auth endpoints', async () => {
    const sent = recordRequests();
    server.use(
      http.get('/workspaces/{workspace_id}/documents/{document_id}', ({ response }) => response.untyped(HttpResponse.json({}))),
      http.put('/workspaces/{workspace_id}/documents/{document_id}', ({ response }) => response.untyped(HttpResponse.json({}))),
      http.delete('/workspaces/{workspace_id}/trash', ({ response }) => response.untyped(HttpResponse.json({}))),
    );
    const write = { 'If-Match': 'cw:1', 'Idempotency-Key': 'k' };

    await api.GET('/workspaces/{workspace_id}/documents/{document_id}', { params: PAGE_PATH });
    await authApi.POST('/auth/login', { body: { username: 'a', password: 'b', remember_me: false } });
    await api.PUT('/workspaces/{workspace_id}/documents/{document_id}', {
      params: { ...PAGE_PATH, header: write },
      body: { content: { schema_version: 1, name: 'x', blocks: [] } },
    });
    await api.DELETE('/workspaces/{workspace_id}/trash', { params: { ...WORKSPACE, query: { confirm: 'empty' } } });

    // `/auth/*` used to default to 'omit', which would silently discard the
    // Set-Cookie that login exists to deliver.
    expect(sent).toHaveLength(4);
    for (const request of sent) expect(request.credentials).toBe('include');
  });

  it('builds the path, the query and the JSON body from the contract', async () => {
    const sent = recordRequests();
    server.use(
      http.get('/workspaces/{workspace_id}/resources', ({ response }) => response(200).json({ items: [], next_cursor: null })),
      http.patch('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}', ({ response }) => response.untyped(HttpResponse.json({}))),
    );

    await api.GET('/workspaces/{workspace_id}/resources', { params: { ...WORKSPACE, query: { document_id: 'a b/c', limit: 7 } } });
    await api.PATCH('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}', {
      params: { path: { workspace_id: WS, document_id: 'a b/c', chat_id: 'c' } },
      body: { title: 'Renamed' },
    });

    expect(pathOf(sent[0])).toBe(`/api/workspaces/${WS}/resources?document_id=a%20b%2Fc&limit=7`);
    const patch = sent[1];
    expect(pathOf(patch)).toBe(`/api/workspaces/${WS}/documents/a%20b%2Fc/chats/c`);
    expect(patch?.method).toBe('PATCH');
    expect(patch?.headers.get('Content-Type')).toBe('application/json');
    expect(await patch?.json()).toEqual({ title: 'Renamed' });
  });

  it('sends an X-Request-Id, and keeps it when the request is replayed', async () => {
    const sent = recordRequests();
    answerList((call) => (call === 1 ? problem('unauthorized') : HttpResponse.json(LIST)));

    await list();

    const lists = sent.filter((request) => !isRefresh(request));
    expect(lists).toHaveLength(2);
    expect(lists[0]?.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(lists[1]?.headers.get('X-Request-Id')).toBe(lists[0]?.headers.get('X-Request-Id'));
  });

  it('serves the agent routes at /api/agent/* without doubling the proxy prefix', async () => {
    const sent = recordRequests();
    server.use(agentHttp.get('/api/agent/engines', ({ response }) =>
      response(200).json({ runtime: 'local', default_engine: 'gateway', engines: [], gateway_models: { main: [], lite: [] } })));

    await api.GET('/api/agent/engines');

    expect(pathOf(sent[0])).toBe('/api/agent/engines');
  });

  it('resolves with the body of a 2xx and rejects every other status', async () => {
    answerList(() => HttpResponse.json(LIST));
    await expect(unwrap(list())).resolves.toMatchObject({ next_cursor: 'more' });

    await expect(api.GET('/workspaces/{workspace_id}/documents/{document_id}', {
      params: { path: { workspace_id: WS, document_id: 'x' } },
    })).rejects.toBeInstanceOf(ApiError);
  });
});

describe('a 401 on an application endpoint', () => {
  it('rotates the session and replays the request once', async () => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    const refreshCalls = answerRefresh(() => HttpResponse.json(SESSION));
    const listCalls = answerList((call) => (call === 1 ? problem('unauthorized', 'Missing session token') : HttpResponse.json(LIST)));

    const result = await unwrap(list());

    expect(result.next_cursor).toBe('more');
    expect(refreshCalls()).toBe(1);
    expect(listCalls()).toBe(2);
    // Recovered silently — the user is never bounced to the landing page.
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('rotates once for concurrent 401s', async () => {
    // Each rotation invalidates the previous refresh token, so a second
    // concurrent rotation would look like token reuse and revoke the whole
    // family.
    const refreshCalls = answerRefresh(async () => {
      await delay(0);
      return HttpResponse.json(SESSION);
    });
    const listCalls = answerList((call) => (call <= 2 ? problem('unauthorized') : HttpResponse.json(LIST)));

    await Promise.all([list(), list()]);

    expect(refreshCalls()).toBe(1);
    expect(listCalls()).toBe(4);
  });

  it('replays a body that was already sent once', async () => {
    const bodies: unknown[] = [];
    server.use(http.patch('/users/me', async ({ request, response }) => {
      bodies.push(await request.json());
      return bodies.length === 1 ? problem('unauthorized') : response(200).json(me());
    }));

    await api.PATCH('/users/me', { body: { headline: 'Researcher' } });

    expect(bodies).toEqual([{ headline: 'Researcher' }, { headline: 'Researcher' }]);
  });

  it('gives up and requires sign-in when the rotation also fails', async () => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    const refreshCalls = answerRefresh(() => problem('unauthorized', 'Invalid refresh token'));
    answerList(() => problem('unauthorized', 'Missing session token'));

    await expect(list()).rejects.toThrow('Missing session token');

    expect(refreshCalls()).toBe(1);
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('expired');
  });

  it('does not rotate on 403: the session is valid, the access is not', async () => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    const refreshCalls = answerRefresh(() => HttpResponse.json(SESSION));
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}', () => problem('forbidden', 'Session is not valid for this project')));

    await expect(api.GET('/workspaces/{workspace_id}/documents/{document_id}', { params: PAGE_PATH }))
      .rejects.toThrow('Session is not valid for this project');

    expect(refreshCalls()).toBe(0);
    expect(emitSpy).toHaveBeenCalledWith('forbidden');
  });

  it.each([
    ['workspace_role_required', { required_role: 'editor' }],
    ['invitation_email_mismatch', {}],
    ['workspace_policy', { policy: 'web_search' }],
  ] as const)('leaves a 403 about one action (%s) to its caller: the account stays signed in', async (code, extra) => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}', () => problem(code, 'Not this', extra)));

    await expect(api.GET('/workspaces/{workspace_id}/documents/{document_id}', { params: PAGE_PATH })).rejects.toThrow('Not this');
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe('the boot-time session check', () => {
  it('refreshes like any request but leaves a failure to its caller', async () => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    const refreshCalls = answerRefresh(() => problem('unauthorized'));
    server.use(http.get('/users/me', () => problem('unauthorized', 'Missing session token')));

    await expect(sessionCheckApi.GET('/users/me')).rejects.toThrow('Missing session token');

    expect(refreshCalls()).toBe(1);
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe('the auth endpoints', () => {
  it.each([
    ['/auth/login', () => authApi.POST('/auth/login', { body: { username: 'a', password: 'b', remember_me: false } })],
    ['/auth/logout', () => authApi.POST('/auth/logout')],
    ['/auth/refresh', () => authApi.POST('/auth/refresh')],
  ] as const)('%s reports its own failure without a rotation or a sign-out', async (path, call) => {
    const emitSpy = vi.spyOn(session, 'emitRequireLogin');
    const sent = recordRequests();
    server.use(http.post(path, () => problem('invalid_credentials', 'nope')));

    await expect(call()).rejects.toThrow('nope');

    expect(sent).toHaveLength(1);
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe('problems become ApiErrors', () => {
  it('keeps the status, the body and the request id, and reads a refused body’s field errors', async () => {
    const errors = [{ loc: ['body', 'content'], msg: 'Field required', type: 'missing' }];
    server.use(http.post('/workspaces/{workspace_id}/documents', () =>
      problem('invalid_request', 'Request validation failed', { instance: '/documents', errors }, { headers: { 'X-Request-Id': 'req-42' } })));

    const error = await api.POST('/workspaces/{workspace_id}/documents', {
      params: { ...WORKSPACE, header: { 'Idempotency-Key': 'k' } },
      body: { content: { schema_version: 1, name: 'x', blocks: [] } },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      data: { code: 'invalid_request', detail: 'Request validation failed', errors },
      message: 'Field required',
      requestId: 'req-42',
    });
  });

  it('reads the string detail of a research problem, whose provider is a top-level member', async () => {
    server.use(http.get('/workspaces/{workspace_id}/papers/search', () => problem('provider_unavailable', 'Semantic Scholar is temporarily unavailable.', {
      provider: 'semantic_scholar', operation: 'search_papers', retry_after: 30,
    })));

    const error = await api.GET('/workspaces/{workspace_id}/papers/search', {
      params: { path: { workspace_id: 'wsp-test' }, query: { query: 'test' } },
    })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      status: 503,
      data: { provider: 'semantic_scholar', operation: 'search_papers', retry_after: 30 },
      message: 'Semantic Scholar is temporarily unavailable.',
    });
  });
});

/**
 * A rate limit or a store that is briefly down clears on its own in about a
 * second; waiting it out here keeps panels from showing the author a
 * permanent failure for a transient one.
 */
describe('retryable problem backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const rateLimited = (extra: Partial<ProblemDetails> = { retry_after: 1 }, headers?: Record<string, string>) =>
    problem('document_rate_limit_exceeded', 'Document rate limit exceeded', { instance: '/documents/doc-1/revisions', ...extra }, { headers });
  const revisions = (init: { signal?: AbortSignal } = {}) =>
    api.GET('/workspaces/{workspace_id}/documents/{document_id}/revisions', {
      params: { path: { workspace_id: WS, document_id: 'doc-1' } },
      ...init,
    });
  /** The timeline answers `first` once, then `then` every time after. */
  const answerRevisions = (first: () => Response, then: () => Response) => {
    const sent = recordRequests();
    server.use(
      http.get('/workspaces/{workspace_id}/documents/{document_id}/revisions', ({ response }) => response.untyped(first()), { once: true }),
      http.get('/workspaces/{workspace_id}/documents/{document_id}/revisions', ({ response }) => response.untyped(then())),
    );
    return sent;
  };
  const always = (answer: () => Response) => answerRevisions(answer, answer);

  it('replays a rate-limited rejection and returns the eventual success', async () => {
    const sent = answerRevisions(() => rateLimited(), () => HttpResponse.json({ revisions: [], next_cursor: null }));

    const promise = unwrap(revisions());
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({ revisions: [], next_cursor: null });
    expect(sent).toHaveLength(2);
  });

  it('waits exactly as long as the Retry-After header asks', async () => {
    const sent = answerRevisions(() => rateLimited({ retry_after: null }, { 'Retry-After': '2' }), () => HttpResponse.json({ revisions: [] }));

    const promise = revisions();
    await vi.advanceTimersByTimeAsync(1999);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(sent).toHaveLength(2);
  });

  it('falls back to the body hint when no header is present', async () => {
    const sent = answerRevisions(() => rateLimited({ retry_after: 3 }), () => HttpResponse.json({ revisions: [] }));

    const promise = revisions();
    await vi.advanceTimersByTimeAsync(2999);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(sent).toHaveLength(2);
  });

  it('retries on the problem code rather than the status', async () => {
    // Rate limiting is a 429, which a status-code test for 503 would miss.
    const sent = recordRequests();
    server.use(
      http.get('/workspaces/{workspace_id}/documents/{document_id}/chats', () => rateLimited(), { once: true }),
      http.get('/workspaces/{workspace_id}/documents/{document_id}/chats', ({ response }) => response(200).json({ items: [], next_cursor: null })),
    );

    const promise = api.GET('/workspaces/{workspace_id}/documents/{document_id}/chats', {
      params: { path: { workspace_id: WS, document_id: 'doc-1' } },
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(sent).toHaveLength(2);
  });

  it('gives up after the third attempt and surfaces one error', async () => {
    const sent = always(() => rateLimited());

    const promise = revisions();
    const expectation = expect(promise).rejects.toBeInstanceOf(ApiError);
    await vi.runAllTimersAsync();
    await expectation;

    expect(sent).toHaveLength(3);
  });

  it.each([
    ['a problem the server does not call retryable', () => problem('stale_head')],
    ['an unrecognised code, even when flagged retryable', () => HttpResponse.json(
      { ...problemBody('unavailable'), code: 'some_future_problem', retryable: true },
      { status: 503, headers: { 'Content-Type': 'application/problem+json' } },
    )],
    ['a hint longer than we are willing to hold the request open', () => rateLimited({ retry_after: 60 })],
  ] as const)('does not replay %s', async (_label, answer) => {
    const sent = recordRequests();
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/chats', ({ response }) => response.untyped(answer())));

    const promise = api.GET('/workspaces/{workspace_id}/documents/{document_id}/chats', {
      params: { path: { workspace_id: WS, document_id: 'doc-1' } },
    });
    const expectation = expect(promise).rejects.toBeInstanceOf(ApiError);
    await vi.runAllTimersAsync();
    await expectation;

    expect(sent).toHaveLength(1);
  });

  it('replays a write under its original idempotency key', async () => {
    // A fresh key per attempt would let the server apply the same write twice.
    const sent = recordRequests();
    server.use(
      http.post('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}/restore', () => rateLimited(), { once: true }),
      http.post('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}/restore', ({ response }) => response.untyped(HttpResponse.json({}))),
    );

    const promise = api.POST('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}/restore', {
      params: {
        path: { workspace_id: WS, document_id: 'doc-1', revision_id: 'rev-1' },
        header: { 'Idempotency-Key': 'idk-1', 'If-Match': 'cw:1' },
      },
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(sent).toHaveLength(2);
    expect(sent.map((request) => request.headers.get('Idempotency-Key'))).toEqual(['idk-1', 'idk-1']);
    expect(sent.map((request) => request.headers.get('If-Match'))).toEqual(['cw:1', 'cw:1']);
  });

  it('waits out a store that is briefly down on a read', async () => {
    const sent = answerRevisions(
      () => problem('unavailable', 'The store is unavailable', {}, { headers: { 'Retry-After': '1' } }),
      () => HttpResponse.json({ revisions: [], next_cursor: null }),
    );

    const promise = unwrap(revisions());
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({ revisions: [], next_cursor: null });
    expect(sent).toHaveLength(2);
  });

  /** Moves the page; the move carries `If-Match` and no `Idempotency-Key`. */
  const movePage = () => api.POST('/workspaces/{workspace_id}/documents/{document_id}/move', {
    params: { path: { workspace_id: WS, document_id: 'doc-1' }, header: { 'If-Match': '"cwp:1"' } },
    body: { collection_id: null },
  });

  it('does not replay a write without an idempotency key after a timeout, which may have applied it', async () => {
    const sent = recordRequests();
    server.use(http.post('/workspaces/{workspace_id}/documents/{document_id}/move', () => problem('timeout', 'Timed out')));

    const promise = movePage();
    const expectation = expect(promise).rejects.toBeInstanceOf(ApiError);
    await vi.runAllTimersAsync();
    await expectation;

    expect(sent).toHaveLength(1);
  });

  it('replays a write without an idempotency key after a rate limit, which refused it before any work', async () => {
    const sent = recordRequests();
    server.use(
      http.post('/workspaces/{workspace_id}/documents/{document_id}/move', () => problem('rate_limited', 'Slow down', { retry_after: 1 }), { once: true }),
      http.post('/workspaces/{workspace_id}/documents/{document_id}/move', () => problem('unchanged', 'Already there')),
    );

    const promise = movePage();
    const expectation = expect(promise).rejects.toMatchObject({ status: 409 });
    await vi.runAllTimersAsync();
    await expectation;

    expect(sent).toHaveLength(2);
  });

  it('replays a keyed write after a timeout, since the server deduplicates it', async () => {
    const sent = recordRequests();
    server.use(
      http.post('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}/restore', () => problem('timeout', 'Timed out'), { once: true }),
      http.post('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}/restore', ({ response }) => response.untyped(HttpResponse.json({}))),
    );

    const promise = api.POST('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}/restore', {
      params: {
        path: { workspace_id: WS, document_id: 'doc-1', revision_id: 'rev-1' },
        header: { 'Idempotency-Key': 'idk-2', 'If-Match': 'cw:1' },
      },
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(sent).toHaveLength(2);
  });

  it('an abort during the backoff rejects instead of replaying', async () => {
    const sent = always(() => rateLimited());

    const controller = new AbortController();
    const promise = revisions({ signal: controller.signal });
    const expectation = expect(promise).rejects.toThrow('Aborted');
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await expectation;

    expect(sent).toHaveLength(1);
  });
});

/** A problem body for a code, to build a response off the contract from. */
function problemBody(code: ErrorCode): Record<string, unknown> {
  return { type: `https://colwrite-api.novus.chat/problems/${code}`, title: code, status: 503, detail: code, instance: '/', code, retryable: false };
}
