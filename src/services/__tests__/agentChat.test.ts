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
        JSON.stringify({ code: 'projection_pending', retryable: true, detail: 'not ready' }),
        {
          status: 503,
          statusText: 'Service Unavailable',
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
    expect(apiError.status).toBe(503);
    expect((apiError.data as { code: string }).code).toBe('projection_pending');
    expect(apiError.message).toBe('not ready');
  });
});

describe('streamAgentChat pending retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const pendingEvent = {
    event: 'error',
    data: JSON.stringify({
      error_code: 'PROJECTION_PENDING',
      message: 'still preparing',
      readiness_status: 'pending',
      retry_after: 1,
    }),
  };
  const doneEvent = {
    event: 'done',
    data: JSON.stringify({
      chat_id: 'c1',
      thread_id: 1,
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    }),
  };

  it('retries a PROJECTION_PENDING stream and surfaces no error on success', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(createSSEResponse([pendingEvent]))
      .mockResolvedValueOnce(createSSEResponse([pendingEvent]))
      .mockResolvedValueOnce(createSSEResponse([{ event: 'token', data: '{"content":"ok"}' }, doneEvent]));

    const onError = vi.fn();
    const onToken = vi.fn();
    const promise = streamAgentChat(
      { message: 'Hi', document_id: 'doc-1' },
      { onError, onToken },
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
    expect(onToken).toHaveBeenCalledWith('ok');
    expect(result.terminal).toBe('done');
  });

  it('surfaces the error exactly once after retries are exhausted', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => createSSEResponse([pendingEvent]));

    const onError = vi.fn();
    const promise = streamAgentChat(
      { message: 'Hi', document_id: 'doc-1' },
      { onError },
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      'PROJECTION_PENDING',
      'still preparing',
      expect.objectContaining({ readinessStatus: 'pending', retryAfterSeconds: 1 }),
    );
    expect(result.terminal).toBe('error');
  });

  it('never replays a turn that already produced output', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSSEResponse([
        { event: 'token', data: '{"content":"partial"}' },
        pendingEvent,
      ]),
    );

    const onError = vi.fn();
    const promise = streamAgentChat(
      { message: 'Hi', document_id: 'doc-1' },
      { onError },
    );
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('retries an HTTP 503 projection_pending problem and honours retry_after', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 'projection_pending', retry_after: 2 }),
          { status: 503, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      )
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

  it('an abort during the backoff sleep rejects instead of retrying', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(createSSEResponse([pendingEvent]));

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
