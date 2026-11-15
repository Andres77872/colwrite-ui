import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';
import type { AgentEventHandlers } from '@/api/assistant/streamParser';
import type { AgentChatParams } from '@/api/assistant/agentChat';
import type { ToolAction } from '@/editor/types';
import { createTestQueryClient } from '@/__tests__/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { TestWorkspace } from '@/__tests__/workspace';
import { PERSONAL_WORKSPACE_ID, fixtures, workspaceSummary } from '@/dev/msw/fixtures';
import type { WorkspaceRole } from '@/data/workspaces';
import { http, server } from '@/__tests__/server';
import { documentListBody } from '@/data/__tests__/documentFixtures';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

/**
 * Auto in the chat composer (D18, 14 §3.7, 11 §5), through the real
 * ChatAssistant, EditorProvider and ProposalsProvider: off by default, on
 * only through the warning, never remembered, and an Auto turn's stored set
 * applied as one undo step with "Applied ‹n› changes · Undo · Review" under
 * the reply.
 */

// ── Service mocks ──

const serverDoc = () => ({
  name: 'Doc',
  blocks: [
    { id: 'a', type: 'paragraph', html: '<p>a</p>', children: [] },
    { id: 'b', type: 'paragraph', html: '<p>b</p>', children: [] },
  ],
});

const runAgentTurn = vi.fn();
vi.mock('@/api/assistant/agentChat', () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurn(...args),
}));
vi.mock('@/data/chats', async () => ({
  ...(await vi.importActual<typeof import('@/data/chats')>('@/data/chats')),
  listMessages: vi.fn(async () => ({ items: [], leaf_id: null })),
}));
vi.mock('@/data/documents', async () => ({
  ...(await vi.importActual<typeof import('@/data/documents')>('@/data/documents')),
  createDocument: vi.fn(async () => ({ id: 'created-doc', doc: serverDoc(), etag: 'cw:1', updatedAt: null, placement: { documentId: 'created-doc', collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null } })),
  saveDocument: vi.fn(async () => ({ etag: 'cw:2', updatedAt: null })),
  getDocument: vi.fn(async () => ({ doc: serverDoc(), etag: 'cw:1', updatedAt: null, placement: { documentId: 'doc', collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null } })),
  deleteDocument: vi.fn(async () => {}),
}));

/** What the panel reads through the query layer: one page on the server, and no chats on it yet. */
function mockPanelReads() {
  server.use(
    http.get('/workspaces/{workspace_id}/documents', ({ response }) => response(200).json(documentListBody({ documents: [{}] }))),
    http.get('/workspaces/{workspace_id}/documents/{document_id}/chats', ({ response }) => response(200).json({ items: [], next_cursor: null })),
  );
}

const getChangeSet = vi.fn();
const decideChangeSetOperations = vi.fn(async () => ({}));
vi.mock('@/data/documentHistory', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/data/documentHistory')),
  getChangeSet: (_workspaceId: unknown, ...args: unknown[]) => getChangeSet(...(args as [])),
  listPendingChangeSets: vi.fn(async () => []),
  decideChangeSetOperations: (_workspaceId: unknown, ...args: unknown[]) => decideChangeSetOperations(...(args as [])),
}));

const { EditorProvider } = await import('@/editor');
const { useEditorProbe } = await import('@/editor/__tests__/editorHarness');
const { ProposalsProvider } = await import('@/editor/ProposalsContext');
const { ChatSessionsProvider } = await import('../../../chat/ChatSessionsContext');
const { useChatSessions } = await import('../../../chat/chatSessionsState');
const { ChatAssistant } = await import('../ChatAssistant');
const { TooltipProvider } = await import('@/components/ui/tooltip');
const { ConfirmContext } = await import('@/components/ui/confirmContext');
const { ToastContext } = await import('@/components/ui/toastContext');
const { AgentToolsContext } = await import('@/components/preferences/agentToolsContextState');

/** The workspace's policy a test runs under; `null` leaves the composer without one, as before it is read. */
let workspacePolicy: { web_search: boolean; outside_research: boolean; auto: boolean } | null = null;
function WithPolicy({ children }: { children: React.ReactNode }) {
  if (!workspacePolicy) return <>{children}</>;
  const policy = workspacePolicy;
  return (
    <AgentToolsContext.Provider
      value={{
        settings: null, loading: false, loaded: true, error: null,
        refresh: async () => null,
        updateSettings: async () => { throw new Error('not in this test'); },
        isSourceEnabled: () => false, isToolEnabled: () => false,
        policy, switchedOffBy: () => null,
      }}
    >
      {children}
    </AgentToolsContext.Provider>
  );
}

// ── Harness ──

const editorRef = createRef<ReturnType<typeof useEditorProbe>>();
const chatsRef = createRef<ReturnType<typeof useChatSessions>>();
function Capture() {
  const editor = useEditorProbe();
  useImperativeHandle(editorRef, () => editor, [editor]);
  return null;
}
function CaptureChats() {
  const chats = useChatSessions();
  useImperativeHandle(chatsRef, () => chats, [chats]);
  return null;
}
const editor = () => editorRef.current!;

/** The account's role in the test workspace; a viewer gets no Auto (D18). */
let workspaceRole: WorkspaceRole = 'owner';

function tree() {
  const stored = fixtures.workspaces.get(PERSONAL_WORKSPACE_ID);
  if (!stored) throw new Error('No personal workspace');
  return (
    <QueryClientProvider client={createTestQueryClient()}>
    <TestWorkspace workspace={{ ...workspaceSummary(stored), role: workspaceRole }}>
    <EditorProvider>
      <ProposalsProvider>
        <Capture />
        <ChatSessionsProvider>
          <CaptureChats />
          <ConfirmContext.Provider value={async () => true}>
            <ToastContext.Provider value={{ toast: () => 'toast', dismiss: () => {} }}>
              <TooltipProvider>
                <WithPolicy>
                  <aside>
                    <ChatAssistant />
                  </aside>
                </WithPolicy>
              </TooltipProvider>
            </ToastContext.Provider>
          </ConfirmContext.Provider>
        </ChatSessionsProvider>
      </ProposalsProvider>
    </EditorProvider>
    </TestWorkspace>
    </QueryClientProvider>
  );
}

async function mount() {
  localStorage.setItem(`colwrite:ws:${TEST_WORKSPACE_ID}:lastDocId`, 'doc-1');
  const view = render(tree());
  await act(async () => {});
  await waitFor(() => expect(editor().blocks).toHaveLength(2));
  return view;
}

const autoSwitch = () => screen.getByRole('switch', { name: 'Auto' });

async function turnOnAuto() {
  fireEvent.click(autoSwitch());
  const dialog = await screen.findByRole('alertdialog', { name: 'Turn on Auto?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Turn on Auto' }));
  await waitFor(() => expect(autoSwitch().getAttribute('aria-checked')).toBe('true'));
}

/** Answer the next send with `play`, then finish the turn. */
function answer(play: (handlers: AgentEventHandlers) => void = () => {}) {
  runAgentTurn.mockImplementationOnce(async (_params: AgentChatParams, handlers: AgentEventHandlers) => {
    play(handlers);
    handlers.onDone?.('chat-1', 1, { promptTokens: 0, completionTokens: 0 });
    return { chatId: 'chat-1', messageId: 1, usage: null, terminal: 'done' };
  });
}

async function send(text = 'tighten this') {
  const host = screen.getByRole('textbox');
  await act(async () => {
    host.textContent = text;
    host.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    screen.getByRole('button', { name: /send message/i }).click();
  });
}

const lastParams = (): AgentChatParams => runAgentTurn.mock.calls.at(-1)?.[0] as AgentChatParams;

const autoSet = () => ({
  changeSetId: 'cs-1',
  documentId: 'doc-1',
  status: 'pending',
  operations: [
    { op: 'replace_block', blockId: 'a', block: { html: '<p>a, tighter</p>' } },
    { op: 'append_block', block: { id: 'n', type: 'paragraph', html: '<p>new</p>', children: [] } },
  ],
  unmappableOperations: [],
  baseEtag: 'cw:1',
  toolCallId: 'call_1',
  summary: null,
  expiresAt: '2026-11-20T00:00:00Z',
  proposedAt: '2026-11-14T10:00:00Z',
  dependsOnChangeSetId: null,
  applyPolicy: 'auto',
  autoBlockedReason: null,
  operationDecisions: [],
  operationTargets: null,
});

const stored = (): ToolAction => ({
  tool: 'doc_edit',
  toolCallId: 'call_1',
  actions: [],
  documentId: 'doc-1',
  status: 'proposed',
  changeSetId: 'cs-1',
  proposalOperationCount: 2,
  applyPolicy: 'auto',
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockPanelReads();
  workspacePolicy = null;
  workspaceRole = 'owner';
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

// ── Tests ──

describe('the Auto switch', () => {
  it('is off on a new chat, asks first, and Cancel leaves it off', async () => {
    await mount();
    expect(autoSwitch().getAttribute('aria-checked')).toBe('false');

    fireEvent.click(autoSwitch());
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn on Auto?' });
    expect(dialog.textContent).toContain(
      "Auto applies the assistant's edits to this page without asking you first.",
    );
    expect(dialog.textContent).toContain('Auto turns off when you leave this page or chat.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(autoSwitch().getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText(/Auto is on/)).toBeNull();
  });

  it('turns on only through the warning, says so above the input, and asks for Auto with each message', async () => {
    await mount();
    answer();
    await send();
    expect(lastParams().apply_mode).toBeUndefined();

    await turnOnAuto();
    expect(screen.getByText('Auto is on: edits apply without asking')).toBeTruthy();
    answer();
    await send();
    expect(lastParams()).toMatchObject({ mode: 'assistant', apply_mode: 'auto' });

    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(autoSwitch().getAttribute('aria-checked')).toBe('false');
    answer();
    await send();
    expect(lastParams().apply_mode).toBeUndefined();
  });

  it('cannot be turned on where the workspace switched Auto off, and says so before sending', async () => {
    workspacePolicy = { web_search: false, outside_research: true, auto: false };
    await mount();
    const off = autoSwitch() as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    expect(off.getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById(off.getAttribute('aria-describedby') ?? '')?.textContent).toBe("Auto isn't available in this workspace");
    // What else the workspace switched off is marked beside it.
    expect(screen.getByRole('img', { name: 'Web search is switched off in this workspace' })).toBeTruthy();
    answer();
    await send();
    expect(lastParams().apply_mode).toBeUndefined();
  });

  it('cannot be turned on by a viewer, and says so before sending (M6.UI-2)', async () => {
    workspaceRole = 'viewer';
    await mount();
    const off = autoSwitch() as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    expect(document.getElementById(off.getAttribute('aria-describedby') ?? '')?.textContent).toBe("Viewers can't use Auto");
    // Nor can a viewer upload a file from the composer: that needs an editor.
    fireEvent.click(screen.getByRole('button', { name: 'Attach images or PDFs' }));
    expect((await screen.findByRole('button', { name: /Upload images or PDFs/ }) as HTMLButtonElement).disabled).toBe(true);
    answer();
    await send();
    expect(lastParams().apply_mode).toBeUndefined();
  });

  it('says why the server paused it for a message', async () => {
    await mount();
    await turnOnAuto();
    answer((handlers) => handlers.onApplyPolicy?.('review', 'web_research'));
    await send();
    expect(screen.getByText('Auto is paused: web research is on for this message')).toBeTruthy();

    // The next message is asked about afresh.
    answer();
    await send();
    expect(screen.getByText('Auto is on: edits apply without asking')).toBeTruthy();
  });

  it('stays on when the first message creates the chat, and turns off on a new or another chat', async () => {
    await mount();
    await turnOnAuto();
    answer((handlers) => handlers.onSessionChat?.('chat-1'));
    await send();
    expect(chatsRef.current?.selectedChatId).toBe('chat-1');
    expect(autoSwitch().getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' }));
    await waitFor(() => expect(autoSwitch().getAttribute('aria-checked')).toBe('false'));

    await turnOnAuto();
    await act(async () => chatsRef.current?.setSelectedChatId('chat-2'));
    await waitFor(() => expect(autoSwitch().getAttribute('aria-checked')).toBe('false'));
  });

  it('turns off with the page and on reload, and is never stored', async () => {
    const view = await mount();
    await turnOnAuto();
    expect(Object.keys(localStorage).filter((key) => /auto/i.test(key))).toEqual([]);

    await act(async () => { await editor().switchTo('doc-2'); });
    await waitFor(() => expect(editor().documentId).toBe('doc-2'));
    expect(autoSwitch().getAttribute('aria-checked')).toBe('false');

    await turnOnAuto();
    view.unmount();
    await mount();
    expect(autoSwitch().getAttribute('aria-checked')).toBe('false');
  });
});

describe('an Auto turn', () => {
  it('applies the stored set as one undo step and says so under the reply; Undo takes it back', async () => {
    getChangeSet.mockResolvedValue(autoSet());
    await mount();
    await turnOnAuto();
    answer((handlers) => handlers.onToolAction?.(stored()));
    await send();

    await waitFor(() => expect(editor().blocks.map((block) => block.id)).toEqual(['a', 'b', 'n']));
    expect(editor().blocks[0]).toMatchObject({ html: '<p>a, tighter</p>' });
    expect(decideChangeSetOperations).toHaveBeenCalledWith(
      'doc-1',
      'cs-1',
      [{ opIndex: 0, decision: 'accepted' }, { opIndex: 1, decision: 'accepted' }],
      'auto',
    );
    const line = await screen.findByRole('list', { name: 'Changes Auto applied' });
    expect(line.textContent).toContain('Applied 2 changes');

    fireEvent.click(within(line).getByRole('button', { name: 'Undo the 2 changes Auto applied' }));
    await waitFor(() => expect(editor().blocks.map((block) => block.id)).toEqual(['a', 'b']));
    expect(editor().blocks[0]).toMatchObject({ html: '<p>a</p>' });
    expect(line.textContent).toContain('Undid 2 changes');
  });

  it('leaves the set for review once Auto is off', async () => {
    getChangeSet.mockResolvedValue(autoSet());
    await mount();
    answer((handlers) => handlers.onToolAction?.(stored()));
    await send();

    await waitFor(() => expect(getChangeSet).toHaveBeenCalled());
    await act(async () => {});
    expect(editor().blocks.map((block) => block.id)).toEqual(['a', 'b']);
    expect(decideChangeSetOperations).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: 'Changes Auto applied' })).toBeNull();
  });
});
