import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createTestQueryClient } from '@/__tests__/queryClient';
import { http, jsonOf, problem, recordRequests, server } from '@/__tests__/server';
import { TestWorkspace } from '@/__tests__/workspace';
import { FakeEditorProviders } from '@/editor/__tests__/editorHarness';
import { ProposalsContext, type ProposalsContextValue } from '@/editor/proposalsContextState';
import { ReviewCommentsProvider } from '@/components/editor/ReviewComments/ReviewCommentsProvider';
import { runAgentTurn, type AgentChatResult } from '@/api/assistant/agentChat';
import { toEditorDoc } from '@/api/content';
import { contentOf, PERSONAL_WORKSPACE_ID, VIEWER_WORKSPACE_ID, fixtures } from '@/dev/msw/fixtures';
import { beginReview, finishReview, scriptedReviewFindings, seedReviewFixture } from '@/dev/msw/reviews';
import { htmlToText } from '@/editor/blockKinds';
import type { Workspace } from '@/data/workspaces';
import { ReviewPanel } from './ReviewPanel';
import { reviewKeys } from '@/data/reviews';
import { StrictMode } from 'react';
import { agentDone } from '@/__tests__/agentDone';
import { AgentSocketError } from '@/api/assistant/agentSocket';
import { AgentAdmissionRefused } from '@/api/assistant/agentSessionChat';

vi.mock('@/api/assistant/agentChat', () => ({ runAgentTurn: vi.fn() }));
const stream = vi.mocked(runAgentTurn);
const panels = { activePanel: 'review', isOpen: true };
vi.mock('../panelsContextState', async (actual) => ({
  ...await actual<Record<string, unknown>>(), usePanels: () => panels,
}));
const proposals: ProposalsContextValue = {
  sets: [], pending: [], pendingCount: 0, invites: [], receive: vi.fn(), accept: vi.fn(), reject: vi.fn(),
  acceptAll: vi.fn(), acceptWording: vi.fn(), acceptGroup: vi.fn(), rejectGroup: vi.fn(), rejectAll: vi.fn(),
  ready: () => true, blocker: () => null, focusChange: vi.fn(), focusedChangeId: null, dismissInvite: vi.fn(), error: null, clearError: vi.fn(),
  autoApplied: [], undoAutoApplied: vi.fn(() => false), revealAutoApplied: vi.fn(), waiting: [], applyWaiting: vi.fn(),
};
const clients: QueryClient[] = [];
const done: AgentChatResult = { done: null, terminal: 'done' };
beforeEach(() => {
  vi.clearAllMocks();
  panels.activePanel = 'review'; panels.isOpen = true;
  stream.mockResolvedValue(done);
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

function mount({ viewer = false, running = false, strict = false } = {}) {
  const doc = seedReviewFixture();
  if (viewer) doc.workspace_id = VIEWER_WORKSPACE_ID;
  const summary = beginReview(doc._id, 'review-1', 'peer_review', running ? 'session-1' : null, running ? 91 : null);
  scriptedReviewFindings(doc, summary);
  if (!running) finishReview(doc._id, summary.run_id, 'completed');
  const workspace: Workspace = {
    id: doc.workspace_id, name: viewer ? 'Reading group' : 'Personal', kind: viewer ? 'shared' : 'personal',
    role: viewer ? 'viewer' : 'owner', icon: null, member_count: viewer ? 2 : 1, last_opened_at: null,
  };
  const editorDoc = toEditorDoc(contentOf(doc));
  const saveRemote = vi.fn(async () => {});
  const ensureRemoteDocument = vi.fn(async () => doc._id);
  const value = {
    documentId: doc._id, doc: editorDoc, blocks: editorDoc.blocks, restoreEpoch: 0,
    hasPendingEdits: vi.fn(() => true), saveRemote, ensureRemoteDocument, readOnly: viewer,
  };
  const client = createTestQueryClient(); clients.push(client);
  const tree = () => <QueryClientProvider client={client}>
    <FakeEditorProviders value={value}><TestWorkspace workspace={workspace}>
      <ProposalsContext.Provider value={proposals}><ReviewCommentsProvider>
        {editorDoc.blocks.map((block) => <div key={block.id} data-block-id={block.id} tabIndex={-1}>
          <div className="editable">{'html' in block ? htmlToText(block.html) : ''}</div>
        </div>)}
        <ReviewPanel />
      </ReviewCommentsProvider></ProposalsContext.Provider>
    </TestWorkspace></FakeEditorProviders>
  </QueryClientProvider>;
  const wrappedTree = () => strict ? <StrictMode>{tree()}</StrictMode> : tree();
  return { ...render(wrappedTree()), tree: wrappedTree, client, doc, summary, saveRemote, ensureRemoteDocument };
}

describe('Review panel', () => {
  it('shows grouped findings, exact quotes, severity, counts and no score', async () => {
    mount();
    expect(await screen.findByRole('region', { name: 'Claims' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Sources' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Consistency' })).toBeTruthy();
    expect(screen.getByText('Peer review · completed')).toBeTruthy();
    expect(screen.getByText('3 comments · Claims: 1 · Sources: 1 · Consistency: 1')).toBeTruthy();
    expect(screen.getAllByText('Must fix')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Next comment' }));
    expect(document.activeElement?.getAttribute('data-block-id')).toBe('review-claim');
    expect(screen.getByText('1 of 3')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'ArrowDown', altKey: true });
    expect(screen.getByText('2 of 3')).toBeTruthy();
  });

  it('a viewer runs and reads a review but sends no comment or content write', async () => {
    const sent = recordRequests();
    const view = mount({ viewer: true });
    await screen.findByText('Peer review · completed');
    for (const button of screen.getAllByRole<HTMLButtonElement>('button', { name: /^(Resolve|Dismiss)$/ })) {
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Run a review' }));
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(stream.mock.calls[0]?.[0]).toMatchObject({
      workspace_id: VIEWER_WORKSPACE_ID, document_id: view.doc._id, profile: 'review', review: 'proofread',
      effort: 'standard', message: '', web: false,
    });
    expect(view.saveRemote).not.toHaveBeenCalled();
    expect(view.ensureRemoteDocument).not.toHaveBeenCalled();
    expect(sent.some((request) => ['PATCH', 'PUT', 'POST'].includes(request.method))).toBe(false);
  });

  it('resolves one shared note and preserves the page and its revision', async () => {
    const view = mount();
    const original = structuredClone(view.doc);
    const sent = recordRequests();
    await screen.findByText('Peer review · completed');
    const resolve = screen.getAllByRole('button', { name: 'Resolve' })[0];
    if (!resolve) throw new Error('Missing comment action');
    fireEvent.click(resolve);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Resolve' })).toHaveLength(2));
    const patch = sent.find((request) => request.method === 'PATCH');
    expect(patch?.url).toContain(`/api/workspaces/${PERSONAL_WORKSPACE_ID}/documents/${view.doc._id}/comments/`);
    expect(await jsonOf(patch)).toEqual({ status: 'resolved' });
    expect(fixtures.documents.get(view.doc._id)).toEqual(original);
    expect(sent.some((request) => request.method === 'PUT')).toBe(false);
  });

  it('reattaches from the recorded starting sequence and detaches on close', async () => {
    let release!: (result: AgentChatResult) => void;
    stream.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const view = mount({ running: true });
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(stream.mock.calls[0]?.[2]?.resume).toEqual({ sessionId: 'session-1', runId: 'review-1', afterSeq: 91 });
    expect(stream.mock.calls[0]?.[2]?.abortBehavior).toBe('detach');
    panels.isOpen = false;
    view.rerender(view.tree());
    expect(stream.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
    expect(stream.mock.calls[0]?.[2]?.signal?.reason).not.toBe('cancel');
    await act(async () => release(done));
  });

  it('reattaches again after StrictMode cleans up its first observer, without another admission', async () => {
    const releases: Array<(result: AgentChatResult) => void> = [];
    stream.mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
    const view = mount({ running: true, strict: true });
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    // Mount with an already-cached running summary, as reopening normally does.
    panels.isOpen = false;
    view.rerender(view.tree());
    panels.isOpen = true;
    view.rerender(view.tree());
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(3));
    const replayed = stream.mock.calls.slice(1);
    expect(replayed.map((call) => call[2]?.resume)).toEqual([
      { sessionId: 'session-1', runId: 'review-1', afterSeq: 91 },
      { sessionId: 'session-1', runId: 'review-1', afterSeq: 91 },
    ]);
    expect(replayed[0]?.[2]?.signal?.aborted).toBe(true);
    expect(replayed[1]?.[2]?.signal?.aborted).toBe(false);
    await act(async () => releases.forEach((release) => release(done)));
  });

  it.each([false, true])('keeps an admitted locator across close/reopen before a summary exists (acknowledged: %s)', async (acknowledged) => {
    const releases: Array<(result: AgentChatResult) => void> = [];
    const locator = { sessionId: 'new-session', requestId: 'one-action', ...(acknowledged ? { runId: 'new-run', afterSeq: 19 } : {}) };
    // Even a successful but lagging list cannot erase the admitted locator.
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/reviews', ({ response }) =>
      response(200).json({ items: [], next_cursor: null })));
    stream.mockImplementation((_params, _handlers, options) => {
      options?.onRunStarted?.(locator);
      return new Promise((resolve) => releases.push(resolve));
    });
    const view = mount();
    const runButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Run a review' });
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    expect(stream.mock.calls[0]?.[2]?.resume).toBeUndefined();
    panels.isOpen = false;
    view.rerender(view.tree());
    panels.isOpen = true;
    view.rerender(view.tree());
    expect(runButton().disabled).toBe(true);
    fireEvent.click(runButton());
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    expect(stream.mock.calls[1]?.[2]?.resume).toEqual(locator);
    // A late result from the detached driver cannot release the admission.
    await act(async () => releases[0]?.(done));
    expect(runButton().disabled).toBe(true);
    expect(view.client.getQueryData(reviewKeys.admission(view.doc.workspace_id, view.doc._id))).toEqual({
      review: 'proofread', locator, attemptId: expect.any(String),
    });
    expect(stream.mock.calls.filter((call) => !call[2]?.resume)).toHaveLength(1);
    await act(async () => releases[1]?.(done));
    expect(runButton().disabled).toBe(true); // still waiting for its terminal summary
    if (acknowledged) {
      act(() => view.client.setQueryData(reviewKeys.runs(view.doc.workspace_id, view.doc._id), {
        pages: [{ items: [{ ...view.summary, run_id: 'new-run', status: 'completed' }], next_cursor: null }], pageParams: [null],
      }));
      await waitFor(() => expect(runButton().disabled).toBe(false));
      expect(view.client.getQueryData(reviewKeys.admission(view.doc.workspace_id, view.doc._id))).toBeNull();
    }
  });

  it('admits nothing while summaries are loading, failed or a stale cached list is refreshing', async () => {
    let finishRead!: () => void;
    const read = new Promise<void>((resolve) => { finishRead = resolve; });
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/reviews', async () => {
      await read;
      return problem('internal_error', 'The summary store could not answer.');
    }));
    const view = mount();
    const runButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Run a review' });
    expect(runButton().disabled).toBe(true);
    fireEvent.click(runButton());
    await act(async () => finishRead());
    await screen.findByText(/Past reviews could not be loaded/);
    expect(runButton().disabled).toBe(true);
    fireEvent.click(runButton());
    expect(stream).not.toHaveBeenCalled();
    let finishRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => { finishRefresh = resolve; });
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/reviews', async ({ response }) => {
      await refresh;
      return response(200).json({ items: [], next_cursor: null });
    }));
    act(() => view.client.setQueryData(reviewKeys.runs(view.doc.workspace_id, view.doc._id), {
      pages: [{ items: [], next_cursor: null }], pageParams: [null],
    }));
    panels.isOpen = false;
    view.rerender(view.tree());
    panels.isOpen = true;
    view.rerender(view.tree());
    expect(runButton().disabled).toBe(true);
    fireEvent.click(runButton());
    expect(stream).not.toHaveBeenCalled();
    await act(async () => finishRefresh());
    await waitFor(() => expect(runButton().disabled).toBe(false));
  });

  it.each(['done', 'error'] as const)('releases a confirmed %s stream even when no review summary was created', async (terminal) => {
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/reviews', ({ response }) =>
      response(200).json({ items: [], next_cursor: null })));
    stream.mockImplementation(async (_params, handlers, options) => {
      options?.onRunStarted?.({ sessionId: 'session', requestId: 'action', runId: 'run', afterSeq: 0 });
      if (terminal === 'error') handlers.onError?.('DOCUMENT_NOT_FOUND', 'The page was removed before review preparation.');
      else handlers.onDone?.(agentDone(null, null));
      return { done: null, terminal };
    });
    const view = mount();
    const runButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Run a review' });
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    await waitFor(() => expect(runButton().disabled).toBe(false));
    expect(view.client.getQueryData(reviewKeys.admission(view.doc.workspace_id, view.doc._id))).toBeNull();
    if (terminal === 'error') expect(screen.getByRole('alert').textContent).toBeTruthy();
  });

  it('keeps an admitted run after a connection failure and offers observation, not a new review', async () => {
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/reviews', ({ response }) =>
      response(200).json({ items: [], next_cursor: null })));
    stream.mockImplementation(async (_params, _handlers, options) => {
      options?.onRunStarted?.({ sessionId: 'session', runId: 'run', requestId: 'same-action', afterSeq: 9 });
      throw new AgentSocketError('The connection closed before its terminal event.');
    });
    const view = mount();
    const runButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Run a review' });
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    await screen.findByRole('button', { name: 'Reconnect review' });
    expect(runButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect review' }));
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    expect(stream.mock.calls[1]?.[2]?.resume).toEqual({
      sessionId: 'session', runId: 'run', requestId: 'same-action', afterSeq: 9,
    });
    expect(view.client.getQueryData(reviewKeys.admission(view.doc.workspace_id, view.doc._id))).not.toBeNull();
  });

  it('observes a queued cancellation even when the review never created a summary', async () => {
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/reviews', ({ response }) =>
      response(200).json({ items: [], next_cursor: null })));
    let release!: (value: AgentChatResult) => void;
    const locator = { sessionId: 'session', runId: 'run', requestId: 'one-action', afterSeq: 0 };
    stream.mockImplementation(async (_params, handlers, options) => {
      if (options?.resume) {
        handlers.onError?.('AGENT_CANCELLED', 'The run was stopped before it started.');
        return { done: null, terminal: 'error' };
      }
      options?.onRunStarted?.(locator);
      return new Promise((resolve) => { release = resolve; });
    });
    const view = mount();
    const runButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Run a review' });
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Stop review' }));
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    expect(stream.mock.calls[0]?.[2]?.signal?.reason).toBe('cancel');
    expect(stream.mock.calls[1]?.[2]?.resume).toEqual(locator);
    await waitFor(() => expect(runButton().disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(view.client.getQueryData(reviewKeys.admission(view.doc.workspace_id, view.doc._id))).toBeNull();
    await act(async () => release({ done: null, terminal: null }));
  });

  it('releases a definitively refused fresh start without losing an uncertain or acknowledged run', async () => {
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/reviews', ({ response }) =>
      response(200).json({ items: [], next_cursor: null })));
    const locator = { sessionId: 'session', requestId: 'refused-action' };
    stream.mockImplementation(async (_params, _handlers, options) => {
      options?.onRunStarted?.(locator);
      throw new AgentAdmissionRefused(locator, new AgentSocketError('The request was refused.', 'invalid_request'));
    });
    const view = mount();
    const runButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Run a review' });
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    await screen.findByRole('alert');
    await waitFor(() => expect(runButton().disabled).toBe(false));
    expect(view.client.getQueryData(reviewKeys.admission(view.doc.workspace_id, view.doc._id))).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reconnect review' })).toBeNull();
  });

  it.each([false, true])('a rejection settling after close only clears its own observer attempt (reopened: %s)', async (reopened) => {
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/reviews', ({ response }) =>
      response(200).json({ items: [], next_cursor: null })));
    const pending: Array<{ resolve: (result: AgentChatResult) => void; reject: (error: Error) => void }> = [];
    const locator = { sessionId: 'session', requestId: 'same-action' };
    stream.mockImplementation((_params, _handlers, options) => {
      options?.onRunStarted?.(locator);
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    });
    const view = mount();
    const key = reviewKeys.admission(view.doc.workspace_id, view.doc._id);
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Run a review' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Run a review' }));
    await waitFor(() => expect(stream).toHaveBeenCalledOnce());
    const first = view.client.getQueryData<{ attemptId: string }>(key);
    panels.isOpen = false;
    view.rerender(view.tree());
    if (reopened) {
      panels.isOpen = true;
      view.rerender(view.tree());
      await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    }
    await act(async () => pending[0]?.reject(new AgentAdmissionRefused(
      locator, new AgentSocketError('The fresh start was refused.', 'invalid_request'),
    )));
    if (reopened) {
      expect(view.client.getQueryData(key)).toMatchObject({ locator });
      expect(view.client.getQueryData<{ attemptId: string }>(key)?.attemptId).not.toBe(first?.attemptId);
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Run a review' }).disabled).toBe(true);
      await act(async () => pending[1]?.resolve(done));
    } else {
      expect(view.client.getQueryData(key)).toBeNull();
    }
  });
});
