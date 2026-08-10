import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamAgentChat } from '../agentChat';
import { ApiError } from '../contracts';
import * as session from '../session';

// ── Helpers ──

function createSSEResponse(events: { event?: string; data: string }[]): Response {
  const encoder = new TextEncoder();
  const bytes = events
    .map((e) => {
      const eventLine = e.event ? `event: ${e.event}\n` : '';
      return `${eventLine}data: ${e.data}\n\n`;
    })
    .join('');
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(bytes));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}

// ── Setup ──

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('streamAgentChat', () => {
  it('1. successful request returns AgentChatResult with chatId, threadId, usage', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSSEResponse([
        { event: 'token', data: JSON.stringify({ content: 'Hello' }) },
        {
          event: 'done',
          data: JSON.stringify({
            chat_id: 'abc-123',
            thread_id: 42,
            usage: { prompt_tokens: 250, completion_tokens: 500 },
          }),
        },
      ]),
    );

    const onToken = vi.fn();
    const result = await streamAgentChat(
      { message: 'Hi', document_id: 'doc-1' },
      { onToken },
    );

    expect(result).toEqual({
      chatId: 'abc-123',
      threadId: 42,
      usage: { promptTokens: 250, completionTokens: 500 },
      terminal: 'done',
    });
    expect(onToken).toHaveBeenCalledWith('Hello');

    // Verify request shape
    const callBody = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(callBody).toEqual({ message: 'Hi', document_id: 'doc-1' });

    fetchSpy.mockRestore();
  });

  it('2. existing chat sends chat_id and thread_id in body (not messages[])', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSSEResponse([
        {
          event: 'done',
          data: JSON.stringify({
            chat_id: 'abc-123',
            thread_id: 5,
            usage: { prompt_tokens: 10, completion_tokens: 20 },
          }),
        },
      ]),
    );

    await streamAgentChat(
      { message: 'Continue', document_id: 'doc-1', chat_id: 'abc-123', thread_id: 5 },
      {},
    );

    const callBody = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    // Body has individual fields, NOT messages[]
    expect(callBody).toEqual({
      message: 'Continue',
      document_id: 'doc-1',
      chat_id: 'abc-123',
      thread_id: 5,
    });
    expect(callBody).not.toHaveProperty('messages');

    fetchSpy.mockRestore();
  });

  it('3. 401 response triggers emitRequireLogin() and throws', async () => {
    const emitRequireLoginSpy = vi.spyOn(session, 'emitRequireLogin');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
    );

    await expect(
      streamAgentChat({ message: 'Hi', document_id: 'doc-1' }, {}),
    ).rejects.toThrow('Unauthorized');

    expect(emitRequireLoginSpy).toHaveBeenCalledOnce();
  });

  it('4. 422 (validation error) thrown as error, emitRequireLogin NOT called', async () => {
    const emitRequireLoginSpy = vi.spyOn(session, 'emitRequireLogin');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'document_id is required' }), {
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      streamAgentChat({ message: 'Hi', document_id: '' }, {}),
    ).rejects.toThrow('document_id is required');

    expect(emitRequireLoginSpy).not.toHaveBeenCalled();
  });

  it('5. AbortSignal cancels fetch', async () => {
    const ac = new AbortController();
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);

    ac.abort();

    await expect(
      streamAgentChat({ message: 'Hi', document_id: 'doc-1' }, {}, { signal: ac.signal }),
    ).rejects.toThrow('The operation was aborted.');
  });

  it('6. non-OK problem+json body becomes a typed ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'document_rate_limit_exceeded',
          retryable: true,
          detail: 'Too many requests',
        }),
        {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'Content-Type': 'application/problem+json' },
        },
      ),
    );

    let caught: unknown;
    try {
      await streamAgentChat(
        { message: 'Hi', document_id: 'doc-1' },
        {},
        { retry: { maxAttempts: 1 } },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const apiError = caught as ApiError;
    expect(apiError.status).toBe(429);
    expect((apiError.data as { code: string }).code).toBe('document_rate_limit_exceeded');
    expect(apiError.message).toBe('Too many requests');
  });

  it('7. a terminal error event reaches the caller instead of being replayed', async () => {
    // The turn was accepted, so only the caller knows what to say about it —
    // and a second POST would bill the author for a reply they never saw.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSSEResponse([
        {
          event: 'error',
          data: JSON.stringify({
            error_code: 'DOCUMENT_NOT_FOUND',
            message: 'No such document',
          }),
        },
      ]),
    );

    const onError = vi.fn();
    const result = await streamAgentChat({ message: 'Hi', document_id: 'doc-1' }, { onError });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('DOCUMENT_NOT_FOUND', 'No such document');
    expect(result.terminal).toBe('error');
  });
});

describe('streamAgentChat retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const doneEvent = {
    event: 'done',
    data: JSON.stringify({
      chat_id: 'c1',
      thread_id: 1,
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    }),
  };

  /** A retryable rejection, fresh each call: `text()` consumes the body. */
  function rateLimited(retryAfter?: number): Response {
    return new Response(
      // `retryable` as the server actually sends it: the shared gate wants the
      // flag *and* a code it knows, so a future retryable problem is never
      // replayed on a guess.
      JSON.stringify({
        code: 'document_rate_limit_exceeded',
        retryable: true,
        ...(retryAfter !== undefined ? { retry_after: retryAfter } : {}),
      }),
      { status: 429, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  it('replays a retryable rejection and honours retry_after', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(rateLimited(2))
      .mockResolvedValueOnce(createSSEResponse([doneEvent]));

    const promise = streamAgentChat({ message: 'Hi', document_id: 'doc-1' }, {});
    // The first replay is scheduled from the server's 2 s hint.
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.terminal).toBe('done');
  });

  it('replays history_not_ready, which is a 409 rather than a 503', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'history_not_ready', retryable: true }), {
          status: 409,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
      )
      .mockResolvedValueOnce(createSSEResponse([doneEvent]));

    const promise = streamAgentChat({ message: 'Hi', document_id: 'doc-1' }, {});
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.terminal).toBe('done');
  });

  it('gives up after the third attempt and throws the last error', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => rateLimited());

    const promise = streamAgentChat({ message: 'Hi', document_id: 'doc-1' }, {});
    const expectation = expect(promise).rejects.toBeInstanceOf(ApiError);
    await vi.runAllTimersAsync();
    await expectation;

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('an abort during the backoff sleep rejects instead of retrying', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => rateLimited());

    const ac = new AbortController();
    const promise = streamAgentChat(
      { message: 'Hi', document_id: 'doc-1' },
      {},
      { signal: ac.signal },
    );
    const expectation = expect(promise).rejects.toThrow('Aborted');
    await vi.advanceTimersByTimeAsync(100);
    ac.abort();
    await expectation;
  });
});
