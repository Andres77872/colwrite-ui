import { agentSource } from '@/__tests__/agentSource';
import { agentDone } from '@/__tests__/agentDone';
import { itemAt } from '@/lib/itemAt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, useRef, useState, type ReactNode } from 'react';
import { runAgentTurn, type AgentChatResult } from '@/api/assistant/agentChat';
import { findActiveAgentRun, type AssistantSnapshot } from '@/api/assistant/agentSessionChat';
import { listMessages, type ChatMessage as WireMessage } from '@/data/chats';
import { AgentSocketError } from '@/api/assistant/agentSocket';
import { ApiError } from '@/api/errors';
import type { ProposalsContextValue } from '@/editor/proposalsContextState';
import { useAgentTurn } from '../useAgentTurn';
import { useConversationLoader } from '../useConversationLoader';
import { emptyMessage } from '../chatUtils';
import { assistantSnapshot } from './assistantSnapshot';
import { TestWorkspace, TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/__tests__/queryClient';
import { assistantRun } from '@/__tests__/assistantRun';

vi.mock('@/api/assistant/agentChat', () => ({ runAgentTurn: vi.fn() }));
vi.mock('@/api/assistant/agentSessionChat', async (original) => ({
  ...await original<typeof import('@/api/assistant/agentSessionChat')>(), findActiveAgentRun: vi.fn(),
}));
vi.mock('@/data/chats', async () => ({
  ...(await vi.importActual<typeof import('@/data/chats')>('@/data/chats')),
  listMessages: vi.fn(),
}));

const stream = vi.mocked(runAgentTurn);
const activeRun = vi.mocked(findActiveAgentRun);
const messages = vi.mocked(listMessages);
const saveRemote = vi.fn(async () => {});
const ensureRemoteDocument = vi.fn(async () => 'doc-1');
const hasPendingEdits = vi.fn(() => false);
const onChatCreated = vi.fn();
const proposals: ProposalsContextValue = {
  sets: [], pending: [], pendingCount: 0, invites: [],
  receive: vi.fn(),
  accept: vi.fn(), reject: vi.fn(), acceptAll: vi.fn(), rejectAll: vi.fn(),
  acceptWording: vi.fn(), acceptGroup: vi.fn(), rejectGroup: vi.fn(),
  ready: () => true, blocker: () => null, focusChange: vi.fn(), focusedChangeId: null,
  dismissInvite: vi.fn(), error: null, clearError: vi.fn(),
  autoApplied: [], undoAutoApplied: vi.fn(() => false), revealAutoApplied: vi.fn(),
  waiting: [], applyWaiting: vi.fn(),
};
const result: AgentChatResult = { done: null, terminal: null };
let nextMessageId = 1;
/** A stored message of the selected branch. */
function stored(role: WireMessage['role'], content: string, extra: Partial<WireMessage> = {}): WireMessage {
  const id = nextMessageId++;
  return { id, parent_id: id > 1 ? id - 1 : null, role, content, attachments: [], run_id: null,
    created_at: '2026-11-14T10:00:00Z', record: null, ...extra };
}
/** The test workspace, inside StrictMode when a test asks for it. */
/** The test workspace with a query cache: the hook refreshes the tree when the assistant makes a page. */
function Workspace({ children }: { children: ReactNode }) {
  const [client] = useState(createTestQueryClient);
  return <QueryClientProvider client={client}><TestWorkspace>{children}</TestWorkspace></QueryClientProvider>;
}
function strictWorkspace({ children }: { children: ReactNode }) {
  return <StrictMode>{<Workspace>{children}</Workspace>}</StrictMode>;
}
const snapshot = (): AssistantSnapshot => assistantSnapshot({
  session: { id: 'session-1', document_id: 'doc-1', chat_id: 'chat-1', title: 'Chat',
    profile: 'chat', last_seq: 3, active_run_id: 'run-1' },
  run: { id: 'run-1', session_id: 'session-1', request_id: 'request-1', status: 'running',
    request: { document_id: 'doc-1', chat_id: 'chat-1', message: 'Explain this', profile: 'chat' } },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type HarnessProps = { chat?: string | null; thread?: number | null; loading?: string | null; restore?: number };
function useHarness({ chat = null, thread = null, loading = null, restore = 0 }: HarnessProps = {}) {
  const [selectedChatId, setSelectedChatId] = useState(chat);
  const [selectedLeafId, setSelectedLeafId] = useState(thread);
  const [, setInput] = useState('');
  const [, setAtBottom] = useState(true);
  const pinnedToBottom = useRef(true);
  const refPickerRef = useRef(null);
  const loadedConversationRef = useRef<string | null>(null);
  const turn = useAgentTurn({ documentId: 'doc-1', loadingDocumentId: loading, restoreEpoch: restore,
    ensureRemoteDocument, hasPendingEdits, saveRemote, selectedChatId, selectedLeafId,
    setSelectedChatId, setSelectedLeafId, proposals, setInput, setAtBottom,
    pinnedToBottomRef: pinnedToBottom, refPickerRef, loadedConversationRef, onChatCreated });
  const loader = useConversationLoader({ workspaceId: TEST_WORKSPACE_ID, documentId: 'doc-1', selectedChatId, selectedLeafId,
    setSelectedLeafId, detachRun: turn.detach, loadedConversationRef,
    setMessages: turn.setMessages, onResumeRun: turn.resumeRun,
    onChatGone: () => { setSelectedChatId(null); setSelectedLeafId(null); } });
  return { turn, loader, selectedChatId, selectedLeafId, setSelectedChatId, loadedConversationRef };
}

beforeEach(() => {
  vi.clearAllMocks();
  stream.mockReset();
  nextMessageId = 1;
  messages.mockResolvedValue({ items: [], leaf_id: 7 });
  activeRun.mockResolvedValue(null);
  hasPendingEdits.mockReturnValue(false);
});
afterEach(cleanup);

describe('durable assistant hook lifecycle', () => {
  it('resumes a checkpoint with its original choices and a stable retry action, preserving the interrupted rows', async () => {
    const old = snapshot();
    const summary = assistantRun({
      id: 'old-run', session_id: 'session-1', chat_id: 'chat-1', document_id: 'doc-1',
      request: { ...old.run!.request, effort: 'deep', web: false, plan_id: 'approved-plan' },
    });
    messages.mockResolvedValue({ items: [stored('user', 'Original question', { run_id: 'old-run' }),
      stored('assistant', 'Old partial answer', { run_id: 'old-run' })], leaf_id: 7 });
    stream.mockRejectedValueOnce(new Error('Acknowledgement lost'));
    const hook = renderHook(() => useHarness({ chat: 'chat-1', thread: 7 }), { wrapper: Workspace });
    await waitFor(() => expect(hook.result.current.turn.messages).toHaveLength(2));
    await act(async () => { await hook.result.current.turn.resumeCheckpoint(summary, 'stable-action'); });
    expect(stream.mock.calls[0]?.[0]).toMatchObject({ message: 'Explain this', effort: 'deep', web: false, plan_id: 'approved-plan' });
    expect(stream.mock.calls[0]?.[2]?.checkpoint).toEqual({ sessionId: 'session-1', runId: 'old-run', requestId: 'stable-action' });
    expect(hook.result.current.turn.messages.map((row) => row.content)).toContain('Old partial answer');
    stream.mockResolvedValueOnce({ done: null, terminal: 'done' });
    await act(async () => { hook.result.current.turn.onRetry(); });
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    expect(stream.mock.calls[1]?.[2]?.checkpoint).toEqual({ sessionId: 'session-1', runId: 'old-run', requestId: 'stable-action' });
    expect(stream.mock.calls[1]?.[2]?.resume).toBeUndefined();
  });

  it('drops a selected chat the page no longer has, without an error notice', async () => {
    messages.mockRejectedValueOnce(new ApiError('Chat not found', 404, { detail: 'Chat not found' }));
    const { result: hook } = renderHook(() => useHarness({ chat: 'gone-chat', thread: 3 }), { wrapper: Workspace });
    await waitFor(() => expect(hook.current.selectedChatId).toBeNull());
    expect(hook.current.selectedLeafId).toBeNull();
    expect(hook.current.loader.conversationNotice).toBeNull();
  });

  it('keeps the notice for a conversation that failed to load for another reason', async () => {
    messages.mockRejectedValueOnce(new ApiError('Server error', 500, { detail: 'Server error' }));
    const { result: hook } = renderHook(() => useHarness({ chat: 'chat-1', thread: 3 }), { wrapper: Workspace });
    await waitFor(() => expect(hook.current.loader.conversationNotice).not.toBeNull());
    expect(hook.current.selectedChatId).toBe('chat-1');
  });

  it('resumes a saved run even before the chat has its first stored message', async () => {
    activeRun.mockResolvedValue(snapshot());
    messages.mockResolvedValue({ items: [], leaf_id: null });
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness({ chat: 'chat-1' }), { wrapper: Workspace });
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(messages).toHaveBeenCalledExactlyOnceWith(TEST_WORKSPACE_ID, 'doc-1', 'chat-1', null, expect.anything());
    expect(hook.result.current.selectedLeafId).toBeNull();
    expect(stream.mock.calls[0]?.[2]?.resume).toEqual({ sessionId: 'session-1', runId: 'run-1', afterSeq: 0 });
    expect(hook.result.current.turn.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    await act(async () => { pending.resolve({ ...result, terminal: 'done' }); });
  });

  it('keeps the running stream when its early session.chat selects the new chat', async () => {
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness(), { wrapper: Workspace });
    act(() => { void hook.result.current.turn.send('Explain this'); });
    const [, handlers, options] = itemAt(stream.mock.calls, 0);
    act(() => { handlers?.onSessionChat?.('chat-1'); });
    expect(hook.result.current.selectedChatId).toBe('chat-1');
    expect(options?.signal?.aborted).toBe(false);
    expect(hook.result.current.turn.isStreaming).toBe(true);
    expect(activeRun).not.toHaveBeenCalled();
    expect(onChatCreated).toHaveBeenCalledExactlyOnceWith('chat-1', 'Explain this');
    act(() => { handlers?.onToken?.('A reply'); handlers?.onDone?.(agentDone('chat-1', 8, { promptTokens: 1, completionTokens: 1 })); });
    expect(hook.result.current.selectedLeafId).toBe(8);
    expect(messages).not.toHaveBeenCalled();
    expect(onChatCreated).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve({ ...result, terminal: 'done' }); });
    expect(hook.result.current.turn.messages.at(-1)?.content).toBe('A reply');
  });

  it.each(['user', 'assistant'] as const)('replays into one assistant row after a saved %s row without saving or starting another turn', async (lastRole) => {
    activeRun.mockResolvedValue(snapshot());
    const items = [
      stored('user', 'Explain this', { run_id: 'run-1' }),
      ...(lastRole === 'assistant' ? [stored('assistant', 'Earlier partial text')] : []),
    ];
    messages.mockResolvedValue({ items, leaf_id: items.at(-1)?.id ?? null });
    hasPendingEdits.mockReturnValue(true);
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness({ chat: 'chat-1', thread: 7 }), { wrapper: Workspace });
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    const [, handlers, options] = itemAt(stream.mock.calls, 0);
    expect(options?.resume).toEqual({ sessionId: 'session-1', runId: 'run-1', afterSeq: 0 });
    expect(saveRemote).not.toHaveBeenCalled();
    expect(ensureRemoteDocument).not.toHaveBeenCalled();
    act(() => { hook.result.current.turn.resumeRun(snapshot()); handlers?.onToken?.('Replayed reply'); });
    expect(stream).toHaveBeenCalledOnce();
    expect(hook.result.current.turn.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'Explain this'], ['assistant', 'Replayed reply'],
    ]);
    await act(async () => { pending.resolve({ ...result, terminal: 'done' }); });
  });

  it.each(['CHAT_NOT_FOUND', 'MESSAGE_NOT_FOUND'])('does not recover a resumed %s by resetting the conversation', async (code) => {
    activeRun.mockResolvedValue(snapshot());
    stream.mockImplementation(async (_params, handlers) => {
      handlers?.onError?.(code, 'The saved run can no longer access its chat.');
      return { ...result, terminal: 'error' };
    });
    const hook = renderHook(() => useHarness({ chat: 'chat-1', thread: 7 }), { wrapper: Workspace });
    await waitFor(() => expect(hook.result.current.turn.error).not.toBeNull());
    expect(stream).toHaveBeenCalledOnce();
    expect(hook.result.current.selectedChatId).toBe('chat-1');
    expect(hook.result.current.selectedLeafId).toBe(7);
  });

  it('marks Stop as cancellation and ignores late callbacks from that run', async () => {
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness(), { wrapper: Workspace });
    act(() => { void hook.result.current.turn.send('Explain this'); });
    const [, handlers, options] = itemAt(stream.mock.calls, 0);
    act(() => { handlers?.onToken?.('Before stop'); hook.result.current.turn.onStop(); });
    expect(options?.abortBehavior).toBe('detach');
    expect(options?.signal?.reason).toBe('cancel');
    expect(hook.result.current.turn.isStreaming).toBe(false);
    act(() => { handlers?.onToken?.('Late text'); handlers?.onSessionChat?.('late-chat'); });
    expect(hook.result.current.turn.messages.at(-1)?.content).toBe('Before stop');
    expect(hook.result.current.selectedChatId).toBeNull();
    await act(async () => { pending.resolve(result); });
  });

  it.each(['loading', 'restore', 'chat', 'unmount'] as const)('detaches on %s navigation without cancelling the durable run', async (boundary) => {
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook((props: HarnessProps) => useHarness(props), { initialProps: {}, wrapper: Workspace });
    act(() => { void hook.result.current.turn.send('Explain this'); });
    const [, handlers, options] = itemAt(stream.mock.calls, 0);
    if (boundary === 'loading') hook.rerender({ loading: 'doc-2' });
    if (boundary === 'restore') hook.rerender({ restore: 1 });
    if (boundary === 'chat') act(() => { hook.result.current.setSelectedChatId('chat-2'); });
    if (boundary === 'unmount') hook.unmount();
    expect(options?.abortBehavior).toBe('detach');
    expect(options?.signal?.aborted).toBe(true);
    expect(options?.signal?.reason).not.toBe('cancel');
    act(() => { handlers?.onSessionChat?.('late-chat'); });
    expect(onChatCreated).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(result); });
  });

  it('does not let a stopped run completion clear a newer active turn', async () => {
    const first = deferred<AgentChatResult>();
    const second = deferred<AgentChatResult>();
    stream.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const hook = renderHook(() => useHarness(), { wrapper: Workspace });
    act(() => { void hook.result.current.turn.send('First'); });
    act(() => { hook.result.current.turn.onStop(); });
    act(() => { void hook.result.current.turn.send('Second'); });
    const activeId = hook.result.current.turn.activeMessageId;
    await act(async () => { first.resolve(result); });
    expect(hook.result.current.turn.isStreaming).toBe(true);
    expect(hook.result.current.turn.activeMessageId).toBe(activeId);
    act(() => { itemAt(stream.mock.calls, 1)[1]?.onToken?.('Second reply'); });
    expect(hook.result.current.turn.messages.at(-1)?.content).toBe('Second reply');
    await act(async () => { second.resolve({ ...result, terminal: 'done' }); });
  });

  it('claims the returned leaf before selecting it and reattaching', async () => {
    activeRun.mockResolvedValue(snapshot());
    messages.mockResolvedValue({ items: [stored('user', 'Explain this', { id: 8 })], leaf_id: 8 });
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness({ chat: 'chat-1', thread: 7 }), { wrapper: Workspace });
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(hook.result.current.selectedLeafId).toBe(8);
    expect(hook.result.current.loadedConversationRef.current).toBe('doc-1:chat-1:8');
    expect(stream.mock.calls[0]?.[2]?.signal?.aborted).toBe(false);
    expect(messages).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve({ ...result, terminal: 'done' }); });
  });

  it('abandons a delayed restore after switching to another chat', async () => {
    const lookup = deferred<AssistantSnapshot | null>();
    activeRun.mockReturnValueOnce(lookup.promise).mockResolvedValue(null);
    const hook = renderHook(() => useHarness({ chat: 'chat-1', thread: 7 }), { wrapper: Workspace });
    await waitFor(() => expect(activeRun).toHaveBeenCalledOnce());
    act(() => { hook.result.current.setSelectedChatId('chat-2'); });
    await act(async () => { lookup.resolve(snapshot()); });
    expect(stream).not.toHaveBeenCalled();
    expect(hook.result.current.selectedChatId).toBe('chat-2');
  });

  it('releases the abandoned load claim under StrictMode and attaches only once', async () => {
    activeRun.mockResolvedValue(snapshot());
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness({ chat: 'chat-1', thread: 7 }), { wrapper: strictWorkspace });
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(hook.result.current.turn.messages.filter((message) => message.role === 'user')).toHaveLength(1);
    await act(async () => { pending.resolve({ ...result, terminal: 'done' }); });
  });

  it.each([
    ['unauthorized', 'Sign in again'],
    ['forbidden', 'Check your access'],
    ['not_found', 'Open another conversation'],
    ['conflict', 'then send again'],
    // The server's own sentence says which limit was reached.
    ['limit_exceeded', 'Server explanation'],
  ])('shows an actionable %s socket error without offering a futile same-run retry', async (code, action) => {
    stream.mockRejectedValue(new AgentSocketError('Server explanation', code));
    const hook = renderHook(() => useHarness(), { wrapper: Workspace });
    await act(async () => { await hook.result.current.turn.send('Explain this'); });
    expect(hook.result.current.turn.error).toMatchObject({ retryable: false, detail: 'Server explanation' });
    expect(hook.result.current.turn.error?.message).toContain(action);
    expect(stream).toHaveBeenCalledOnce();
  });

  it('merges the reply’s sources by handle and its passages by id, however often the stream repeats them', async () => {
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness(), { wrapper: Workspace });
    act(() => { void hook.result.current.turn.send('Explain this'); });
    await act(async () => {});
    const [, handlers] = itemAt(stream.mock.calls, 0);
    const s1 = agentSource('S1', { key: 'k1', title: 'One' });
    const s2 = agentSource('S2', { key: 'k2', title: 'Two' });
    act(() => {
      handlers?.onEvidence?.({ sources: [s1], passages: [{ id: 'S1.1', level: 'abstract' }] });
      handlers?.onEvidence?.({ sources: [s1, s2], passages: [{ id: 'S1.1', level: 'abstract' }, { id: 'S2.1', level: 'snippet' }] });
      handlers?.onEvidence?.({ sources: [s2], passages: [] });
    });
    const reply = hook.result.current.turn.messages.at(-1);
    expect(reply?.sources?.map((source) => source.handle)).toEqual(['S1', 'S2']);
    expect(reply?.passages).toEqual([{ id: 'S1.1', level: 'abstract' }, { id: 'S2.1', level: 'snippet' }]);
    await act(async () => { pending.resolve({ ...result, terminal: 'done' }); });
  });

  it('keeps the later record of a source whose handle the stream repeats, in the reply’s order', async () => {
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness(), { wrapper: Workspace });
    act(() => { void hook.result.current.turn.send('Explain this'); });
    await act(async () => {});
    const [, handlers] = itemAt(stream.mock.calls, 0);
    // The paper first by its Semantic Scholar id, then by its DOI.
    const byS2 = agentSource('S1', { key: 's2:204e3073', title: 'Attention', provider: 'semantic_scholar' });
    const s2 = agentSource('S2', { key: 'k2', title: 'Two' });
    const byDoi = agentSource('S1', { key: 'doi:10.5555/3295222.3295349', title: 'Attention', provider: 'semantic_scholar', doi: '10.5555/3295222.3295349' });
    act(() => {
      handlers?.onEvidence?.({ sources: [byS2, s2], passages: [] });
      handlers?.onEvidence?.({ sources: [byDoi], passages: [] });
    });
    expect(hook.result.current.turn.messages.at(-1)?.sources).toEqual([byDoi, s2]);
    await act(async () => { pending.resolve({ ...result, terminal: 'done' }); });
  });

  it('saves pending edits before the turn is sent', async () => {
    hasPendingEdits.mockReturnValue(true);
    stream.mockResolvedValue({ ...result, terminal: 'done' });
    const hook = renderHook(() => useHarness(), { wrapper: Workspace });
    await act(async () => { await hook.result.current.turn.send('Explain this'); });
    expect(saveRemote).toHaveBeenCalledOnce();
    expect(saveRemote.mock.invocationCallOrder[0]).toBeLessThan(itemAt(stream.mock.invocationCallOrder, 0));
  });

  it('retries an uncertain start with its saved locator and one user row', async () => {
    stream.mockImplementationOnce(async (_params, _handlers, options) => {
      options?.onRunStarted?.({ sessionId: 'session-1', requestId: 'request-1' });
      throw new Error('Acknowledgement lost');
    });
    const retry = deferred<AgentChatResult>();
    stream.mockReturnValueOnce(retry.promise);
    const hook = renderHook(() => useHarness(), { wrapper: Workspace });
    act(() => { hook.result.current.turn.setMessages([emptyMessage('assistant', 'Earlier conversation')]); });
    await act(async () => { await hook.result.current.turn.send('Explain this', { effort: 'quick', web: true }); });
    act(() => { hook.result.current.turn.onRetry(); });
    expect(stream.mock.calls.map(([request]) => request.effort)).toEqual(['quick', 'quick']);
    expect(stream.mock.calls.map(([request]) => request.web)).toEqual([true, true]);
    expect(hook.result.current.turn.messages.find((message) => message.role === 'user')?.effort).toBe('quick');
    expect(stream.mock.calls[1]?.[2]?.resume).toEqual({ sessionId: 'session-1', requestId: 'request-1' });
    expect(hook.result.current.turn.messages.map((message) => [message.role, message.content])).toEqual([
      ['assistant', 'Earlier conversation'], ['user', 'Explain this'], ['assistant', ''],
    ]);
    await act(async () => { retry.resolve({ ...result, terminal: 'done' }); });
  });

  it('observes a preset-only run with its original effort instead of dropping its empty message', async () => {
    const running = snapshot();
    running.run!.request = { ...running.run!.request, message: '', preset: 'review-page', effort: 'quick', web: true };
    activeRun.mockResolvedValue(running);
    messages.mockResolvedValue({ items: [], leaf_id: null });
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness({ chat: 'chat-1' }), { wrapper: Workspace });
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(stream.mock.calls[0]?.[0]).toMatchObject({ message: '', preset: 'review-page', effort: 'quick', web: true });
    expect(stream.mock.calls[0]?.[2]?.resume).toMatchObject({ sessionId: 'session-1', runId: 'run-1' });
    expect(hook.result.current.turn.messages[0]).toMatchObject({ content: 'Review this page', preset: 'review-page', effort: 'quick' });
    expect(saveRemote).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ ...result, terminal: 'done' }); });
  });

  it('never replays a plan-backed turn into a new chat when its original chat is gone', async () => {
    stream.mockImplementation(async (_request, handlers) => {
      handlers.onError?.('CHAT_NOT_FOUND', 'The chat was deleted.');
      return { done: null, terminal: 'error' };
    });
    const hook = renderHook(() => useHarness(), { wrapper: Workspace });
    act(() => hook.result.current.setSelectedChatId('gone'));
    await act(async () => {
      await hook.result.current.turn.send('Write the approved plan', { effort: 'deep', plan_id: 'p1' });
    });
    expect(stream).toHaveBeenCalledOnce();
    expect(hook.result.current.turn.error).toMatchObject({
      message: 'This plan belongs to a conversation that is no longer available. Start a new chat.',
      retryable: false,
    });
  });
});
