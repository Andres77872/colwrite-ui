import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamAgentChat } from '../agentChat';
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
});
