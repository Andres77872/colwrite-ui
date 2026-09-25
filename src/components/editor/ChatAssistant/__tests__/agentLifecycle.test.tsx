import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, useRef, useState } from 'react';
import { streamAgentChat, type AgentChatResult } from '@/services/agentChat';
import { findActiveAgentRun, type AssistantSnapshot } from '@/services/agentSessionChat';
import { listMessages, listThreads } from '@/services/chats';
import { AgentSocketError } from '@/services/agentSocket';
import type { ProposalsContextValue } from '@/editor/proposalsContextState';
import { useAgentTurn } from '../useAgentTurn';
import { useConversationLoader } from '../useConversationLoader';
import { emptyMessage } from '../chatUtils';

vi.mock('@/services/agentChat', () => ({ streamAgentChat: vi.fn() }));
vi.mock('@/services/agentSessionChat', () => ({ findActiveAgentRun: vi.fn() }));
vi.mock('@/services/chats', () => ({ listMessages: vi.fn(), listThreads: vi.fn() }));

const stream = vi.mocked(streamAgentChat);
const activeRun = vi.mocked(findActiveAgentRun);
const messages = vi.mocked(listMessages);
const threads = vi.mocked(listThreads);
const saveRemote = vi.fn(async () => {});
const ensureRemoteDocument = vi.fn(async () => 'doc-1');
const hasPendingEdits = vi.fn(() => false);
const onChatCreated = vi.fn();
const proposals: ProposalsContextValue = {
  sets: [], pending: [], pendingCount: 0, invites: [],
  receive: vi.fn(() => ({ changes: 0, changeIds: [], applied: 0, invited: false })),
  accept: vi.fn(), reject: vi.fn(), acceptAll: vi.fn(), rejectAll: vi.fn(),
  ready: () => true, focusChange: vi.fn(), focusedChangeId: null,
  dismissInvite: vi.fn(), error: null, clearError: vi.fn(),
};
const result: AgentChatResult = { chatId: null, threadId: null, usage: null, terminal: null };
const snapshot = (): AssistantSnapshot => ({
  session: { id: 'session-1', document_id: 'doc-1', chat_id: 'chat-1', title: 'Chat',
    ephemeral: false, last_seq: 3, active_run_id: 'run-1' },
  run: { id: 'run-1', session_id: 'session-1', request_id: 'request-1', status: 'running',
    request: { document_id: 'doc-1', chat_id: 'chat-1', message: 'Explain this', mode: 'assistant' } },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type HarnessProps = { chat?: string | null; thread?: number | null; loading?: string | null; restore?: number };
function useHarness({ chat = null, thread = null, loading = null, restore = 0 }: HarnessProps = {}) {
  const [selectedChatId, setSelectedChatId] = useState(chat);
  const [selectedThreadId, setSelectedThreadId] = useState(thread);
  const [, setInput] = useState('');
  const [, setAtBottom] = useState(true);
  const pinnedToBottom = useRef(true);
  const refPickerRef = useRef(null);
  const loadedConversationRef = useRef<string | null>(null);
  const turn = useAgentTurn({ documentId: 'doc-1', loadingDocumentId: loading, restoreEpoch: restore,
    ensureRemoteDocument, hasPendingEdits, saveRemote, selectedChatId, selectedThreadId,
    setSelectedChatId, setSelectedThreadId, proposals, setInput, setAtBottom,
    pinnedToBottom, refPickerRef, loadedConversationRef, onChatCreated });
  const loader = useConversationLoader({ documentId: 'doc-1', selectedChatId, selectedThreadId,
    setSelectedThreadId, abortRef: turn.abortRef, loadedConversationRef,
    setMessages: turn.setMessages, setIsStreaming: turn.setIsStreaming,
    setAgentStatus: turn.setAgentStatus, onResumeRun: turn.resumeRun });
  return { turn, loader, selectedChatId, selectedThreadId, setSelectedChatId, loadedConversationRef };
}

beforeEach(() => {
  vi.clearAllMocks();
  stream.mockReset();
  threads.mockResolvedValue({ threads: [], count: 0, status: 'ok', message: '' });
  messages.mockResolvedValue({ messages: [], pivotThreadId: 7, status: 'ok', message: '' });
  activeRun.mockResolvedValue(null);
  hasPendingEdits.mockReturnValue(false);
});
afterEach(cleanup);

describe('durable assistant hook lifecycle', () => {
  it('resumes a saved run even before the chat has its first persisted thread', async () => {
    activeRun.mockResolvedValue(snapshot());
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness({ chat: 'chat-1' }));
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(messages).not.toHaveBeenCalled();
    expect(stream.mock.calls[0][2]?.resume).toEqual({ sessionId: 'session-1', runId: 'run-1' });
    expect(hook.result.current.turn.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    await act(async () => { pending.resolve({ ...result, terminal: 'done' }); });
  });

  it('keeps the running stream when its early session.chat selects the new chat', async () => {
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness());
    act(() => { void hook.result.current.turn.send('Explain this'); });
    const [, handlers, options] = stream.mock.calls[0];
    act(() => { handlers?.onSessionChat?.('chat-1'); });
    expect(hook.result.current.selectedChatId).toBe('chat-1');
    expect(options?.signal?.aborted).toBe(false);
    expect(hook.result.current.turn.isStreaming).toBe(true);
    expect(threads).not.toHaveBeenCalled();
    expect(activeRun).not.toHaveBeenCalled();
    expect(onChatCreated).toHaveBeenCalledExactlyOnceWith('chat-1', 'Explain this');
    act(() => { handlers?.onToken?.('A reply'); handlers?.onDone?.('chat-1', 8, { promptTokens: 1, completionTokens: 1 }); });
    expect(hook.result.current.selectedThreadId).toBe(8);
    expect(messages).not.toHaveBeenCalled();
    expect(onChatCreated).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve({ ...result, terminal: 'done' }); });
    expect(hook.result.current.turn.messages.at(-1)?.content).toBe('A reply');
  });

  it.each(['user', 'assistant'] as const)('replays into one assistant row after a saved %s row without saving or starting another turn', async (lastRole) => {
    activeRun.mockResolvedValue(snapshot());
    messages.mockResolvedValue({ messages: [
      { role: 'user', content: 'Explain this' },
      ...(lastRole === 'assistant' ? [{ role: 'assistant' as const, content: 'Earlier partial text' }] : []),
    ], pivotThreadId: 7, status: 'ok', message: '' });
    hasPendingEdits.mockReturnValue(true);
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness({ chat: 'chat-1', thread: 7 }));
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    const [, handlers, options] = stream.mock.calls[0];
    expect(options?.resume).toEqual({ sessionId: 'session-1', runId: 'run-1' });
    expect(saveRemote).not.toHaveBeenCalled();
    expect(ensureRemoteDocument).not.toHaveBeenCalled();
    act(() => { hook.result.current.turn.resumeRun(snapshot()); handlers?.onToken?.('Replayed reply'); });
    expect(stream).toHaveBeenCalledOnce();
    expect(hook.result.current.turn.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'Explain this'], ['assistant', 'Replayed reply'],
    ]);
    await act(async () => { pending.resolve({ ...result, terminal: 'done' }); });
  });

  it.each(['CHAT_NOT_FOUND', 'THREAD_NOT_FOUND'])('does not recover a resumed %s by resetting the conversation', async (code) => {
    activeRun.mockResolvedValue(snapshot());
    stream.mockImplementation(async (_params, handlers) => {
      handlers?.onError?.(code, 'The saved run can no longer access its chat.');
      return { ...result, terminal: 'error' };
    });
    const hook = renderHook(() => useHarness({ chat: 'chat-1', thread: 7 }));
    await waitFor(() => expect(hook.result.current.turn.error).not.toBeNull());
    expect(stream).toHaveBeenCalledOnce();
    expect(hook.result.current.selectedChatId).toBe('chat-1');
    expect(hook.result.current.selectedThreadId).toBe(7);
  });

  it('marks Stop as cancellation and ignores late callbacks from that run', async () => {
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness());
    act(() => { void hook.result.current.turn.send('Explain this'); });
    const [, handlers, options] = stream.mock.calls[0];
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
    const hook = renderHook((props: HarnessProps) => useHarness(props), { initialProps: {} });
    act(() => { void hook.result.current.turn.send('Explain this'); });
    const [, handlers, options] = stream.mock.calls[0];
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
    const hook = renderHook(() => useHarness());
    act(() => { void hook.result.current.turn.send('First'); });
    act(() => { hook.result.current.turn.onStop(); });
    act(() => { void hook.result.current.turn.send('Second'); });
    const activeId = hook.result.current.turn.activeMessageId;
    await act(async () => { first.resolve(result); });
    expect(hook.result.current.turn.isStreaming).toBe(true);
    expect(hook.result.current.turn.activeMessageId).toBe(activeId);
    act(() => { stream.mock.calls[1][1]?.onToken?.('Second reply'); });
    expect(hook.result.current.turn.messages.at(-1)?.content).toBe('Second reply');
    await act(async () => { second.resolve({ ...result, terminal: 'done' }); });
  });

  it('claims the returned transcript pivot before selecting it and reattaching', async () => {
    activeRun.mockResolvedValue(snapshot());
    messages.mockResolvedValue({ messages: [{ role: 'user', content: 'Explain this' }],
      pivotThreadId: 8, status: 'ok', message: '' });
    const pending = deferred<AgentChatResult>();
    stream.mockReturnValue(pending.promise);
    const hook = renderHook(() => useHarness({ chat: 'chat-1', thread: 7 }));
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(hook.result.current.selectedThreadId).toBe(8);
    expect(hook.result.current.loadedConversationRef.current).toBe('doc-1:chat-1:8');
    expect(stream.mock.calls[0][2]?.signal?.aborted).toBe(false);
    expect(messages).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve({ ...result, terminal: 'done' }); });
  });

  it('abandons a delayed restore after switching to another chat', async () => {
    const lookup = deferred<AssistantSnapshot | null>();
    activeRun.mockReturnValueOnce(lookup.promise).mockResolvedValue(null);
    const hook = renderHook(() => useHarness({ chat: 'chat-1', thread: 7 }));
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
    const hook = renderHook(() => useHarness({ chat: 'chat-1', thread: 7 }), { wrapper: StrictMode });
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(hook.result.current.turn.messages.filter((message) => message.role === 'user')).toHaveLength(1);
    await act(async () => { pending.resolve({ ...result, terminal: 'done' }); });
  });

  it.each([
    ['unauthorized', 'Sign in again'],
    ['forbidden', 'Check your access'],
    ['not_found', 'Open another conversation'],
    ['conflict', 'Reopen it'],
  ])('shows an actionable %s socket error without offering a futile same-run retry', async (code, action) => {
    stream.mockRejectedValue(new AgentSocketError('Server explanation', code));
    const hook = renderHook(() => useHarness());
    await act(async () => { await hook.result.current.turn.send('Explain this'); });
    expect(hook.result.current.turn.error).toMatchObject({ retryable: false, detail: 'Server explanation' });
    expect(hook.result.current.turn.error?.message).toContain(action);
    expect(stream).toHaveBeenCalledOnce();
  });

  it('retries an uncertain start with its saved locator and one user row', async () => {
    stream.mockImplementationOnce(async (_params, _handlers, options) => {
      options?.onRunStarted?.({ sessionId: 'session-1', requestId: 'request-1' });
      throw new Error('Acknowledgement lost');
    });
    const retry = deferred<AgentChatResult>();
    stream.mockReturnValueOnce(retry.promise);
    const hook = renderHook(() => useHarness());
    act(() => { hook.result.current.turn.setMessages([emptyMessage('assistant', 'Earlier conversation')]); });
    await act(async () => { await hook.result.current.turn.send('Explain this'); });
    act(() => { hook.result.current.turn.onRetry(); });
    expect(stream.mock.calls[1][2]?.resume).toEqual({ sessionId: 'session-1', requestId: 'request-1' });
    expect(hook.result.current.turn.messages.map((message) => [message.role, message.content])).toEqual([
      ['assistant', 'Earlier conversation'], ['user', 'Explain this'], ['assistant', ''],
    ]);
    await act(async () => { retry.resolve({ ...result, terminal: 'done' }); });
  });
});
