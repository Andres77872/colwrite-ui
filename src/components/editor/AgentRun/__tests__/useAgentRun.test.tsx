import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { runAgentTurn, type AgentChatOptions, type AgentChatResult } from '@/api/assistant/agentChat';
import { AgentSocketError } from '@/api/assistant/agentSocket';
import type { AgentEventHandlers } from '@/api/assistant/streamParser';
import { agentSource } from '@/__tests__/agentSource';
import { TestWorkspace, TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { useAgentRun, type AgentRunDocument, type AgentRunSurface } from '../useAgentRun';

vi.mock('@/api/assistant/agentChat', () => ({ runAgentTurn: vi.fn() }));
const stream = vi.mocked(runAgentTurn);

const done: AgentChatResult = { done: null, terminal: 'done' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}
const wrapper = ({ children }: { children: ReactNode }) => <TestWorkspace>{children}</TestWorkspace>;

let page: AgentRunDocument;
beforeEach(() => {
  stream.mockReset();
  page = {
    documentId: 'doc-1',
    ensureRemoteDocument: vi.fn(async () => 'doc-1'),
    hasPendingEdits: vi.fn(() => false),
    saveRemote: vi.fn(async () => {}),
  };
});
afterEach(cleanup);

const render = (surface: AgentRunSurface) => renderHook(() => useAgentRun({ surface, document: page }), { wrapper });
/** The handlers and options the driver handed the transport, once it has. */
const sent = () => {
  const call = stream.mock.calls[0];
  if (!call) throw new Error('No run was started');
  return { params: call[0], handlers: call[1], options: call[2] as AgentChatOptions };
};

describe('the review driver', () => {
  it('does not write kept edits for a viewer and uses the chat engine surface', async () => {
    page.readOnly = true;
    vi.mocked(page.hasPendingEdits).mockReturnValue(true);
    stream.mockResolvedValue(done);
    const { result } = render('review');
    await act(async () => { await result.current.start({ request: { message: '', review: 'claims', effort: 'standard' } }); });
    expect(page.saveRemote).not.toHaveBeenCalled();
    expect(page.ensureRemoteDocument).not.toHaveBeenCalled();
    expect(sent().params).toMatchObject({ profile: 'review', review: 'claims', effort: 'standard', message: '' });
    expect(sent().params).not.toHaveProperty('apply_mode');
    expect(sent().params).not.toHaveProperty('chat_id');
  });

  it('detaches on unmount, suppresses late comments, and only explicit Stop cancels', async () => {
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const onComments = vi.fn();
    const { result, unmount } = render('review');
    act(() => { void result.current.start({ request: { message: '', review: 'proofread' }, handlers: { onComments } }); });
    await act(async () => {});
    unmount();
    expect(sent().options.abortBehavior).toBe('detach');
    expect(sent().options.signal?.aborted).toBe(true);
    expect(sent().options.signal?.reason).not.toBe('cancel');
    sent().handlers.onComments?.([{ comment_id: 'c', block_id: 'p', quote: 'Old quote', kind: 'claim', severity: 'must_fix' }]);
    expect(onComments).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(done); });
  });
});

describe.each(['chat', 'inline'] as const)('the run driver, for %s', (surface) => {
  it('saves pending edits first, then asks about the saved page', async () => {
    vi.mocked(page.hasPendingEdits).mockReturnValue(true);
    stream.mockResolvedValue(done);
    const { result } = render(surface);

    let outcome;
    await act(async () => { outcome = await result.current.start({ request: { message: 'Hello' } }); });

    expect(page.saveRemote).toHaveBeenCalledOnce();
    expect(vi.mocked(page.saveRemote).mock.invocationCallOrder[0]).toBeLessThan(stream.mock.invocationCallOrder[0] ?? 0);
    expect(sent().params).toMatchObject({ workspace_id: TEST_WORKSPACE_ID, document_id: 'doc-1', message: 'Hello' });
    expect(outcome).toMatchObject({ status: 'done', documentId: 'doc-1' });
  });

  it('does not ask when that save fails, and says why', async () => {
    vi.mocked(page.hasPendingEdits).mockReturnValue(true);
    vi.mocked(page.saveRemote).mockRejectedValue(new Error('offline'));
    const { result } = render(surface);

    let outcome;
    await act(async () => { outcome = await result.current.start({ request: { message: 'Hello' } }); });

    expect(stream).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'failed', error: { message: expect.stringContaining('could not be saved'), retryable: true } });
  });

  it('creates a page that exists only in this browser before the run', async () => {
    page.documentId = null;
    vi.mocked(page.ensureRemoteDocument).mockResolvedValue('created-doc');
    stream.mockResolvedValue(done);
    const { result } = render(surface);

    await act(async () => { await result.current.start({ request: { message: 'Hello' } }); });
    expect(sent().params.document_id).toBe('created-doc');
  });

  it('saves nothing when it reattaches to a run under way', async () => {
    vi.mocked(page.hasPendingEdits).mockReturnValue(true);
    stream.mockResolvedValue(done);
    const { result } = render(surface);

    await act(async () => { await result.current.start({ request: { message: 'Hello' }, resume: { sessionId: 's1', runId: 'r1' } }); });
    expect(page.saveRemote).not.toHaveBeenCalled();
    expect(sent().options.resume).toEqual({ sessionId: 's1', runId: 'r1' });
  });

  it('stops the run when its surface unmounts, and ignores what arrives after', async () => {
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const onToken = vi.fn();
    const { result, unmount } = render(surface);
    let outcome: unknown;
    act(() => { void result.current.start({ request: { message: 'Hello' }, handlers: { onToken } }).then((value) => { outcome = value; }); });
    await act(async () => {});

    unmount();
    const { handlers, options } = sent();
    expect(options.signal?.aborted).toBe(true);
    // The chat's run is durable and is only left; an inline run is cancelled.
    expect(options.abortBehavior).toBe(surface === 'chat' ? 'detach' : 'cancel');
    handlers.onToken?.('late');
    expect(onToken).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(done); });
    expect(outcome).toEqual({ status: 'stopped' });
  });

  it('merges sources by handle, and hands the surface each one once with the passages as sent', async () => {
    const s1 = agentSource('S1', { key: 'k1', title: 'One' });
    const s2 = agentSource('S2', { key: 'k2', title: 'Two' });
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const onEvidence = vi.fn();
    const { result } = render(surface);
    act(() => { void result.current.start({ request: { message: 'Hello' }, handlers: { onEvidence } }); });
    await act(async () => {});

    act(() => {
      sent().handlers.onEvidence?.({ sources: [s1], passages: [{ id: 'S1.1', level: 'abstract' }] });
      sent().handlers.onEvidence?.({ sources: [s1, s2], passages: [] });
      // Nothing new: the surface hears nothing.
      sent().handlers.onEvidence?.({ sources: [s2], passages: [] });
      // A passage of a source already held still reaches it.
      sent().handlers.onEvidence?.({ sources: [s2], passages: [{ id: 'S2.1', level: 'full_text' }] });
    });
    expect(result.current.sources.map((source) => source.handle)).toEqual(['S1', 'S2']);
    expect(onEvidence.mock.calls).toEqual([
      [{ sources: [s1], passages: [{ id: 'S1.1', level: 'abstract' }] }],
      [{ sources: [s2], passages: [] }],
      [{ sources: [], passages: [{ id: 'S2.1', level: 'full_text' }] }],
    ]);
    await act(async () => { pending.resolve(done); });
  });

  it('replaces a source when a later entry repeats its handle, where it stands', async () => {
    // A paper first named by its Semantic Scholar id, then by its DOI: the
    // later entry, with the same handle, replaces the earlier one.
    const byS2 = agentSource('S1', { key: 's2:204e3073', title: 'Attention', provider: 'semantic_scholar' });
    const s2 = agentSource('S2', { key: 'k2', title: 'Two' });
    const doi = '10.5555/3295222.3295349';
    const byDoi = agentSource('S1', { key: `doi:${doi}`, title: 'Attention', provider: 'semantic_scholar', doi });
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const onEvidence = vi.fn();
    const { result } = render(surface);
    act(() => { void result.current.start({ request: { message: 'Hello' }, handlers: { onEvidence } }); });
    await act(async () => {});

    act(() => {
      sent().handlers.onEvidence?.({ sources: [byS2, s2], passages: [] });
      sent().handlers.onEvidence?.({ sources: [byDoi], passages: [] });
      // Replayed as it now stands: nothing changes.
      sent().handlers.onEvidence?.({ sources: [byDoi, s2], passages: [] });
    });
    expect(result.current.sources).toEqual([byDoi, s2]);
    expect(onEvidence.mock.calls.map(([evidence]) => evidence.sources)).toEqual([[byS2, s2], [byDoi]]);
    await act(async () => { pending.resolve(done); });
  });

  it('names what the run is doing, and keeps a late duplicate end off text being written', async () => {
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const { result } = render(surface);
    act(() => { void result.current.start({ request: { message: 'Hello' } }); });
    await act(async () => {});
    const handlers = (): AgentEventHandlers => sent().handlers;

    expect(result.current.progress).toMatchObject({ phase: 'thinking', label: 'Thinking…' });
    // The start's display names a tool this run's catalog (none, here) does not list.
    const display = { label: 'Searched the web', running_label: 'Searching the web', icon: 'globe', detail_templates: [], value_labels: {} };
    act(() => handlers().onToolCallStart?.('web_search', 'c1', display));
    expect(result.current.progress).toMatchObject({ phase: 'tool', label: 'Searching the web…' });
    const end = { tool: 'web_search', toolCallId: 'c1', durationMs: 5, isError: false, error: null, errorType: null, outputPreview: null, outputChars: 0, outputTruncated: false, argumentsPreview: '', argumentsTruncated: false };
    act(() => handlers().onToolCallEnd?.(end));
    expect(result.current.progress).toMatchObject({ phase: 'thinking' });
    act(() => handlers().onToken?.('Answer'));
    act(() => handlers().onToolCallEnd?.(end));
    expect(result.current.progress).toMatchObject({ phase: 'writing' });
    await act(async () => { pending.resolve(done); });
    expect(result.current.progress).toBeNull();
    expect(result.current.running).toBe(false);
  });

  it('words a reported error once, with its code', async () => {
    stream.mockImplementation(async (_params, handlers) => {
      handlers.onError?.('MODEL_CONTEXT_TOO_LARGE', 'Too large');
      return { ...done, terminal: 'error' };
    });
    const { result } = render(surface);
    let outcome;
    await act(async () => { outcome = await result.current.start({ request: { message: 'Hello' } }); });
    expect(outcome).toMatchObject({ status: 'failed', code: 'MODEL_CONTEXT_TOO_LARGE', error: { retryable: false } });
  });

  it('says a run cut off without an ending may be incomplete', async () => {
    stream.mockResolvedValue({ ...done, terminal: null });
    const { result } = render(surface);
    let outcome;
    await act(async () => { outcome = await result.current.start({ request: { message: 'Hello' } }); });
    expect(outcome).toMatchObject({ status: 'failed', code: 'INCOMPLETE_STREAM', error: { message: expect.stringContaining('may be incomplete') } });
  });

  it('turns a refused connection into an action, not a retry', async () => {
    stream.mockRejectedValue(new AgentSocketError('Server explanation', 'unauthorized'));
    const { result } = render(surface);
    let outcome;
    await act(async () => { outcome = await result.current.start({ request: { message: 'Hello' } }); });
    expect(outcome).toMatchObject({ status: 'failed', error: { message: expect.stringContaining('Sign in again'), retryable: false, detail: 'Server explanation' } });
  });

  it('cancels on Stop at once', async () => {
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const { result } = render(surface);
    act(() => { void result.current.start({ request: { message: 'Hello' } }); });
    await act(async () => {});

    act(() => result.current.stop());
    expect(sent().options.signal?.reason).toBe('cancel');
    expect(result.current.running).toBe(false);
    expect(result.current.isRunning()).toBe(false);
    await act(async () => { pending.resolve(done); });
  });
});

describe('what each surface sends', () => {
  it('runs inline AI as a one-shot rewrite, and the chat as it asks', async () => {
    stream.mockResolvedValue(done);
    const inline = render('inline');
    await act(async () => { await inline.result.current.start({ request: { message: '', preset: 'shorter' } }); });
    expect(sent().params).toMatchObject({ profile: 'inline', preset: 'shorter', message: '' });

    stream.mockClear();
    const chat = render('chat');
    await act(async () => { await chat.result.current.start({ request: { message: 'Hi' } }); });
    expect(sent().params).toMatchObject({ profile: 'chat' });
    expect(sent().params).not.toHaveProperty('preset');
  });
});
