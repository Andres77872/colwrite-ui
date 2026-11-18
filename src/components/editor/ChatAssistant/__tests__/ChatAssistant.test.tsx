import { agentDone } from '@/__tests__/agentDone';
import { itemAt, takeItems } from '@/lib/itemAt';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { createRef, StrictMode, useImperativeHandle } from 'react';
import * as agentSessions from '@/api/assistant/agentSessionChat';
import * as chatAttachments from '@/api/assistant/chatAttachments';
import * as assets from '@/data/assets';
import { http, multipartFields, server } from '@/__tests__/server';
import { documentListBody, type DocumentListAnswer } from '@/data/__tests__/documentFixtures';
import type { ChatMessage as WireChatMessage, ChatSummary, ResourceItem, ResourceListResponse } from '@/api/schema';
import { fixtures } from '@/dev/msw/fixtures';
import { TurnRecord } from '@/dev/msw/turnRecord';
import { planEtag, planEvent, proposePlan } from '@/dev/msw/plans';
import { inCollection, makeResource } from '@/data/__tests__/resourceFixtures';
import type { AgentEventHandlers, AgentQuestion } from '@/api/assistant/streamParser';
import type { ToolAction } from '@/editor/types';
import { PanelsContext, type PanelsContextValue } from '@/components/panels/panelsContextState';
import { assistantSnapshot } from './assistantSnapshot';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

/**
 * Integration tests for the real ChatAssistant, EditorProvider and
 * ProposalsProvider — the path a `tool_action` travels from the stream to the
 * document.
 *
 * The contract under test: the assistant never writes to the document. A
 * `proposed` action queues changes for review and leaves the blocks alone
 * until the author accepts. With Auto on, the editor accepts a stored `auto`
 * set itself (`autoMode.test.tsx`).
 */

// ── Service mocks ──

/** The document the server holds; the provider hydrates from this on mount. */
const serverDoc = () => ({
  name: 'Doc',
  blocks: [
    { id: 'a', type: 'paragraph', html: 'a', children: [] },
    { id: 'b', type: 'paragraph', html: 'b', children: [] },
  ],
});

const runAgentTurn = vi.fn();
/** A page as the server answers it: its body and the ETag a save locks on. */
const opened = (doc: { name: string; blocks: unknown[] }, etag = 'cw:1', id = DOC_ID) => ({
  doc, etag, updatedAt: null,
  placement: { documentId: id, collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null },
});
const getDocument = vi.fn(async (_workspaceId: string, id: string) =>
  opened(id === 'created-doc' ? { blocks: [], name: 'New doc' } : serverDoc(), 'cw:1', id),
);
const saveDocument = vi.fn(async (..._args: unknown[]) => ({ etag: 'cw:2', updatedAt: null }));
const createDocument = vi.fn(async () => ({ id: 'created-doc', ...opened({ blocks: [], name: 'Untitled page' }, 'cw:1', 'created-doc') }));

vi.mock('@/api/assistant/agentChat', () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurn(...args),
}));
/** A stored message of the branch a chat read returns. */
type StoredMessage = {
  id: number;
  parent_id: number | null;
  role: 'user' | 'assistant';
  content: string;
  attachments: chatAttachments.ChatAttachment[];
  run_id: string | null;
  created_at: string;
  record?: WireChatMessage['record'];
};
let nextMessageId = 1;
function stored(role: StoredMessage['role'], content: string, extra: Partial<StoredMessage> = {}): StoredMessage {
  const id = nextMessageId++;
  return { id, parent_id: id > 1 ? id - 1 : null, role, content, attachments: [], run_id: null,
    created_at: '2026-11-14T10:00:00Z', ...extra };
}
/** One branch: its messages, ending at its leaf. */
const branch = (items: StoredMessage[]) => ({ items, leaf_id: items.at(-1)?.id ?? null });
const listMessages = vi.fn(async (..._args: unknown[]) => branch([]));
vi.mock('@/data/chats', async () => ({
  ...(await vi.importActual<typeof import('@/data/chats')>('@/data/chats')),
  listMessages: (...args: unknown[]) => listMessages(...args),
}));
/** The change sets the server stored, by id; the review layer reads them by the id the stream names. */
const storedSets = new Map<string, Record<string, unknown>>();
vi.mock('@/data/documentHistory', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/data/documentHistory')),
  getChangeSet: async (_workspaceId: string, _documentId: string, changeSetId: string) => {
    const stored = storedSets.get(changeSetId);
    if (!stored) throw new Error(`No change set ${changeSetId}`);
    return stored;
  },
  listPendingChangeSets: async () => [],
  decideChangeSetOperations: async () => ({}),
}));
vi.mock('@/data/documents', async () => ({
  ...(await vi.importActual<typeof import('@/data/documents')>('@/data/documents')),
  createDocument: () => createDocument(),
  saveDocument: (...args: unknown[]) => saveDocument(...args),
  getDocument: (workspaceId: string, id: string) => getDocument(workspaceId, id),
  deleteDocument: vi.fn(async () => {}),
}));

/*
 * What the panel reads through the query layer, from the server: the page
 * list, the page's chats and a chat's rename, and the workspace's PDFs (an
 * upload's form fields, a list by its query, a move).
 */
const listDocuments = vi.fn(async (_query: unknown): Promise<DocumentListAnswer> => ({ documents: [{}] }));
const chatSummary = (over: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  title: null, last_message_id: null, created_at: '2026-11-14T10:00:00Z', updated_at: '2026-11-14T10:00:00Z', ...over,
});
const listChats = vi.fn(async (_documentId: string) => ({ items: [] as ChatSummary[], next_cursor: null as string | null }));
const updateChatTitle = vi.fn(async (_documentId: string, chatId: string, title: string) => chatSummary({ id: chatId, title }));
const resourceServer = {
  upload: vi.fn<(fields: Record<string, string>) => Promise<ResourceItem>>(),
  list: vi.fn<(query: Record<string, string>) => Promise<ResourceListResponse>>(),
  move: vi.fn<(resourceId: number) => Promise<ResourceItem>>(),
};

function mockAssistantServer() {
  server.use(
    http.get('/workspaces/{workspace_id}/documents', async ({ request, response }) =>
      response(200).json(documentListBody(await listDocuments(Object.fromEntries(new URL(request.url).searchParams))))),
    http.get('/workspaces/{workspace_id}/documents/{document_id}/chats', async ({ params, response }) =>
      response(200).json(await listChats(params.document_id))),
    http.patch('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}', async ({ params, request, response }) =>
      response(200).json(await updateChatTitle(params.document_id, params.chat_id, (await request.json()).title ?? ''))),
    http.delete('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}', ({ response }) => response(204).empty()),
    http.post('/workspaces/{workspace_id}/resources', async ({ request, response }) =>
      response(201).json(await resourceServer.upload(await multipartFields(request)))),
    http.get('/workspaces/{workspace_id}/resources', async ({ request, response }) =>
      response(200).json(await resourceServer.list(Object.fromEntries(new URL(request.url).searchParams)))),
    http.put('/workspaces/{workspace_id}/resources/{resource_id}/location', async ({ params, response }) =>
      response(200).json(await resourceServer.move(Number(params.resource_id)))),
  );
}

const { EditorProvider } = await import('@/editor');
const { useEditorProbe } = await import('@/editor/__tests__/editorHarness');
const { ProposalsProvider } = await import('@/editor/ProposalsContext');
const { useProposals } = await import('@/editor/proposalsContextState');
const { ChatSessionsProvider } = await import('../../../chat/ChatSessionsContext');
const { useChatSessions } = await import('../../../chat/chatSessionsState');
const { ChatAssistant } = await import('../ChatAssistant');
const { TooltipProvider } = await import('@/components/ui/tooltip');
const { ConfirmContext } = await import('@/components/ui/confirmContext');
const { ToastContext } = await import('@/components/ui/toastContext');
const { useRememberCaret } = await import('../../References');
const { resetModuleState } = await import('@/lib/moduleState');
const { AgentEngineContext } = await import('@/components/preferences/agentEngineContextState');
type EngineContext = import('@/components/preferences/agentEngineContextState').AgentEngineContextValue;

// ── Harness ──

const DOC_ID = 'doc-1';

type HarnessHandle = {
  editor: ReturnType<typeof useEditorProbe>;
  review: ReturnType<typeof useProposals>;
};

const captureRef = createRef<HarnessHandle>();
const chatsRef = createRef<ReturnType<typeof useChatSessions>>();
const harness = {
  get editor() {
    if (!captureRef.current) throw new Error('Editor harness is not mounted');
    return captureRef.current.editor;
  },
  get review() {
    if (!captureRef.current) throw new Error('Review harness is not mounted');
    return captureRef.current.review;
  },
  get chats() {
    if (!chatsRef.current) throw new Error('Chat sessions harness is not mounted');
    return chatsRef.current;
  },
};

function Capture() {
  const editor = useEditorProbe();
  const review = useProposals();
  useImperativeHandle(captureRef, () => ({ editor, review }), [editor, review]);
  return null;
}

/** Inside the sessions provider: the panel is told which chat to show. */
function CaptureChats() {
  const chats = useChatSessions();
  useImperativeHandle(chatsRef, () => chats, [chats]);
  return null;
}

/** Renders the assistant against a document that is already saved remotely. */
async function mount({
  strict = false,
  panels,
  engines,
}: { strict?: boolean; panels?: Partial<PanelsContextValue>; engines?: EngineContext } = {}) {
  localStorage.setItem(`colwrite:ws:${TEST_WORKSPACE_ID}:lastDocId`, DOC_ID);

  await renderAssistant({ strict, panels, engines });

  // The workspace's last page opens: the provider reads it from the server.
  await waitFor(() => expect(harness.editor.blocks).toHaveLength(2));
  expect(getDocument).toHaveBeenCalledWith(TEST_WORKSPACE_ID, DOC_ID);
}

/** Renders the assistant against a draft that exists only in this browser. */
async function mountUnsaved() {
  await renderAssistant();
  await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());
  expect(harness.editor.documentId).toBeNull();
  expect(getDocument).not.toHaveBeenCalled();
}

async function renderAssistant({
  strict = false,
  panels,
  engines,
}: { strict?: boolean; panels?: Partial<PanelsContextValue>; engines?: EngineContext } = {}) {
  const editor = (
    <EditorProvider>
      <ProposalsProvider>
        <Capture />
        <ChatSessionsProvider>
          <CaptureChats />
          <ConfirmContext.Provider value={confirm}>
            <ToastContext.Provider value={{ toast: () => 'toast', dismiss: () => {} }}>
              <TooltipProvider>
                {/* The sidebar's AI tab: a column the panel fills. */}
                <aside>
                  <ChatAssistant />
                </aside>
              </TooltipProvider>
            </ToastContext.Provider>
          </ConfirmContext.Provider>
        </ChatSessionsProvider>
      </ProposalsProvider>
    </EditorProvider>
  );
  const withPanels = panels ? (
    <PanelsContext.Provider value={panels as PanelsContextValue}>{editor}</PanelsContext.Provider>
  ) : (
    editor
  );
  const tree = engines ? (
    <AgentEngineContext.Provider value={engines}>{withPanels}</AgentEngineContext.Provider>
  ) : (
    withPanels
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  await act(async () => {});
}

const confirm = vi.fn(async () => true);

/** Put text in the composer. */
async function compose(text: string) {
  // The composer is a contenteditable that rebuilds its model from the DOM on
  // `input`, so set the text and fire the event the component listens for.
  const host = screen.getByRole('textbox', { name: 'Ask AI anything… # to reference a block' });
  await act(async () => {
    host.textContent = text;
    host.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return host;
}

/** Answer the next send with the given tool_action events. */
function answerWith(actions: ToolAction[]) {
  runAgentTurn.mockImplementation(
    async (_params: unknown, handlers: AgentEventHandlers) => {
      for (const action of actions) handlers.onToolAction?.(action);
      handlers.onDone?.(agentDone('chat-1', 1, { promptTokens: 0, completionTokens: 0 }));
      return { chatId: 'chat-1', messageId: 1, usage: null };
    },
  );
}

/** Drive one send, handing the component the given tool_action events. */
async function sendWith(actions: ToolAction[]) {
  answerWith(actions);
  await compose('do the thing');

  await act(async () => {
    screen.getByRole('button', { name: /send message/i }).click();
  });
}

/**
 * A `tool_action` from `doc_edit`. A `proposed` one stores its operations as
 * a change set and names it, as the server does: the stream carries the id
 * and size, never the operations. The same payload names the same set, so
 * a redelivery is one.
 */
function proposal(overrides: Partial<ToolAction> = {}): ToolAction {
  const action: ToolAction = {
    tool: 'doc_edit',
    toolCallId: 'call_1',
    actions: [],
    documentId: DOC_ID,
    status: 'proposed',
    ...overrides,
  };
  if (action.status !== 'proposed') return action;
  const changeSetId = `cs-${action.toolCallId}-${storedSetKey(JSON.stringify(action.actions))}`;
  storedSets.set(changeSetId, {
    changeSetId,
    documentId: DOC_ID,
    status: 'pending',
    operations: action.actions,
    unmappableOperations: [],
    baseEtag: 'cw:1',
    toolCallId: action.toolCallId,
    summary: null,
    expiresAt: '2026-11-20T00:00:00Z',
    proposedAt: '2026-11-14T10:00:00Z',
    dependsOnChangeSetId: null,
    applyPolicy: action.applyPolicy ?? 'review',
    autoBlockedReason: null,
    operationDecisions: [],
    operationTargets: null,
  });
  return { ...action, actions: [], changeSetId, proposalOperationCount: action.actions.length };
}

/** A short key for a payload. */
function storedSetKey(payload: string): string {
  let hash = 0;
  for (const char of payload) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (hash >>> 0).toString(36);
}

const acceptAll = async () => {
  await act(async () => {
    harness.review.acceptAll();
  });
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  storedSets.clear();
  nextMessageId = 1;
  listDocuments.mockResolvedValue({ documents: [{}] });
  listChats.mockResolvedValue({ items: [], next_cursor: null });
  resourceServer.upload.mockReset().mockResolvedValue(makeResource());
  resourceServer.list.mockReset().mockResolvedValue({ items: [], next_cursor: null });
  resourceServer.move.mockReset().mockResolvedValue(makeResource());
  mockAssistantServer();
});

afterEach(() => {
  // vitest is not running with `globals`, so RTL's auto-cleanup never fires.
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Tests ──

describe('proposed changes await the author', () => {
  it('does not touch the document until a change is accepted', async () => {
    await mount();
    await sendWith([
      proposal({
        actions: [{ op: 'write_blocks', position: 'replace', blockId: 'a', blocks: [{ id: 'a', type: 'paragraph', html: 'edited', children: [] }] }],
      }),
    ]);

    await waitFor(() => expect(harness.review.pendingCount).toBe(1));
    // The whole point: the block still holds what the author wrote.
    expect(harness.editor.blocks[0]).toMatchObject({ id: 'a', html: 'a' });
  });

  it('applies the change once accepted', async () => {
    await mount();
    await sendWith([
      proposal({
        actions: [{ op: 'write_blocks', position: 'replace', blockId: 'a', blocks: [{ id: 'a', type: 'paragraph', html: 'edited', children: [] }] }],
      }),
    ]);
    await waitFor(() => expect(harness.review.pendingCount).toBe(1));

    await act(async () => {
      harness.review.accept(itemAt(harness.review.pending, 0).id);
    });

    expect(harness.editor.blocks[0]).toMatchObject({ id: 'a', html: 'edited' });
    expect(harness.review.pendingCount).toBe(0);
    // An accept from the review bar can land far off screen, so the block it
    // changed is highlighted. That list is what `applyPatch` reports back, and
    // reading it out of a `setState` updater left it empty.
    expect([...harness.editor.recentlyChanged]).toEqual(['a']);
  });

  it('discards the change on reject', async () => {
    await mount();
    await sendWith([proposal({ actions: [{ op: 'delete_blocks', blockIds: ['b'] }] })]);
    await waitFor(() => expect(harness.review.pendingCount).toBe(1));

    await act(async () => {
      harness.review.reject(itemAt(harness.review.pending, 0).id);
    });

    expect(harness.editor.blocks.map((b) => b.id)).toEqual(['a', 'b']);
    expect(harness.review.pendingCount).toBe(0);
  });

  it('accepting is a local edit, so it has to be saved', async () => {
    await mount();
    await sendWith([proposal({ actions: [{ op: 'delete_blocks', blockIds: ['b'] }] })]);
    await waitFor(() => expect(harness.review.pendingCount).toBe(1));

    await acceptAll();

    // A proposal exists nowhere but this browser; leaving the document clean
    // would lose the accepted text on reload.
    await waitFor(() => expect(harness.editor.doc.blocks).toHaveLength(1));
    expect(saveDocument).not.toHaveBeenCalled(); // debounced, not immediate
  });

  it('saves an accepted change over the head the page was read at', async () => {
    await mount();
    await sendWith([proposal({ actions: [{ op: 'delete_blocks', blockIds: ['b'] }] })]);
    await waitFor(() => expect(harness.review.pendingCount).toBe(1));
    saveDocument.mockClear();

    // A proposal is stored beside the page, not in it: the head did not move,
    // so the save that carries the accepted change is locked on the ETag read.
    await acceptAll();
    await act(async () => {
      await harness.editor.flushPendingSave();
    });
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(saveDocument.mock.calls[0]?.[3]).toBe('cw:1');
  });

  it('queues every batch from one run, in order', async () => {
    await mount();
    await sendWith([
      proposal({ toolCallId: 'call_1', actions: [{ op: 'delete_blocks', blockIds: ['a'] }] }),
      proposal({ toolCallId: 'call_2', actions: [{ op: 'delete_blocks', blockIds: ['b'] }] }),
    ]);

    await waitFor(() => expect(harness.review.pendingCount).toBe(2));
    await acceptAll();
    expect(harness.editor.blocks).toHaveLength(0);
  });

  it('ignores a redelivered tool action', async () => {
    await mount();
    await sendWith([
      proposal({ actions: [{ op: 'write_blocks', position: 'append', blockId: null, blocks: [{ id: 'z', type: 'divider' }] }] }),
      proposal({ actions: [{ op: 'write_blocks', position: 'append', blockId: null, blocks: [{ id: 'z', type: 'divider' }] }] }),
    ]);

    await waitFor(() => expect(harness.review.pendingCount).toBe(1));
    await acceptAll();
    expect(harness.editor.blocks).toHaveLength(3);
  });

  it('keeps a reused tool_call_id whose operations differ', async () => {
    // Providers that number calls per request reuse `call_0` every run, so
    // matching on the id alone dropped the next message's first edit.
    await mount();
    await sendWith([
      proposal({ toolCallId: 'call_0', actions: [{ op: 'delete_blocks', blockIds: ['a'] }] }),
      proposal({ toolCallId: 'call_0', actions: [{ op: 'delete_blocks', blockIds: ['b'] }] }),
    ]);

    await waitFor(() => expect(harness.review.pendingCount).toBe(2));
  });

  it('keeps both edits when neither action carries a tool_call_id', async () => {
    // Two proposals in one run look identical on every field except their
    // operations.
    await mount();
    await sendWith([
      proposal({ toolCallId: '', actions: [{ op: 'delete_blocks', blockIds: ['a'] }] }),
      proposal({ toolCallId: '', actions: [{ op: 'delete_blocks', blockIds: ['b'] }] }),
    ]);

    await waitFor(() => expect(harness.review.pendingCount).toBe(2));
    await acceptAll();
    expect(harness.editor.blocks).toHaveLength(0);
  });

  it('renames the document only on accept', async () => {
    await mount();
    await sendWith([proposal({ actions: [{ op: 'set_meta', name: 'Renamed' }] })]);

    await waitFor(() => expect(harness.review.pendingCount).toBe(1));
    expect(harness.editor.doc.name).toBe('Doc');

    await acceptAll();
    expect(harness.editor.doc.name).toBe('Renamed');
  });

  it('blocks a change until the one it builds on is accepted', async () => {
    await mount();
    await sendWith([
      proposal({
        actions: [
          { op: 'write_blocks', position: 'append', blockId: null, blocks: [{ id: 'new', type: 'paragraph', html: 'x' }] },
          { op: 'write_blocks', position: 'replace', blockId: 'new', blocks: [{ id: 'new', type: 'paragraph', html: 'y', children: [] }] },
        ],
      }),
    ]);

    await waitFor(() => expect(harness.review.pendingCount).toBe(2));
    const [first, second] = takeItems(harness.review.pending, 2);
    expect(harness.review.ready(first)).toBe(true);
    // Accepting the rewrite alone would patch a block that does not exist yet.
    expect(harness.review.ready(second)).toBe(false);

    await act(async () => {
      harness.review.accept(first.id);
    });
    await waitFor(() => expect(harness.review.ready(itemAt(harness.review.pending, 0))).toBe(true));
  });

  it('drops dependents when their prerequisite is rejected', async () => {
    await mount();
    await sendWith([
      proposal({
        actions: [
          { op: 'write_blocks', position: 'append', blockId: null, blocks: [{ id: 'new', type: 'paragraph', html: 'x' }] },
          { op: 'write_blocks', position: 'replace', blockId: 'new', blocks: [{ id: 'new', type: 'paragraph', html: 'y', children: [] }] },
        ],
      }),
    ]);
    await waitFor(() => expect(harness.review.pendingCount).toBe(2));

    await act(async () => {
      harness.review.reject(itemAt(harness.review.pending, 0).id);
    });

    expect(harness.review.pendingCount).toBe(0);
    expect(harness.editor.blocks).toHaveLength(2);
  });

  it('reports a change that can no longer be applied', async () => {
    await mount();
    await sendWith([
      proposal({
        actions: [
          { op: 'write_blocks', position: 'after', blockId: 'ghost', blocks: [{ id: 'n', type: 'divider' }] },
        ],
      }),
    ]);
    await waitFor(() => expect(harness.review.pendingCount).toBe(1));

    await acceptAll();

    await waitFor(() => expect(harness.review.error).toMatch(/could not be applied/i));
    // The block is not guessed into some other position.
    expect(harness.editor.blocks.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('surfaces a failed edit in the chat', async () => {
    await mount();
    await sendWith([
      proposal({ status: 'error', message: 'Version conflict', actions: [] }),
    ]);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Version conflict'),
    );
  });
});

describe('the composer', () => {
  it('sends on Enter', async () => {
    await mount();
    answerWith([]);
    const host = await compose('ship it');

    await act(async () => {
      fireEvent.keyDown(host, { key: 'Enter' });
    });

    expect(runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'ship it', document_id: DOC_ID }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('opens a line on Shift+Enter, and keeps the message unsent', async () => {
    await mount();
    answerWith([]);
    const host = await compose('first line');

    await act(async () => {
      fireEvent.keyDown(host, { key: 'Enter', shiftKey: true });
    });

    expect(runAgentTurn).not.toHaveBeenCalled();
    // Still there to be added to, rather than gone into an empty transcript.
    await waitFor(() => expect(host.textContent).toContain('first line'));
  });

  it('clears the composer once the message is on its way', async () => {
    await mount();
    answerWith([]);
    const host = await compose('ship it');

    await act(async () => {
      fireEvent.keyDown(host, { key: 'Enter' });
    });

    await waitFor(() => expect(host.textContent).toBe(''));
  });
});

describe('where the author is working', () => {
  /** Block `a` as the canvas renders it, with the caret tracker mounted. */
  function Canvas() {
    useRememberCaret();
    return (
      <div data-block-id="a">
        <div className="editable" data-testid="block-a">Transformers changed NLP.</div>
      </div>
    );
  }

  async function selectInBlock(text: string) {
    const element = screen.getByTestId('block-a');
    const start = element.textContent!.indexOf(text);
    await act(async () => {
      const range = document.createRange();
      range.setStart(element.firstChild!, start);
      range.setEnd(element.firstChild!, start + text.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
  }

  // The remembered caret is module state, forgotten with the rest.
  afterEach(() => resetModuleState());

  it('sends the selection and the referenced blocks along with the message', async () => {
    await mount();
    render(<Canvas />);
    await selectInBlock('changed NLP');
    answerWith([]);

    await compose('make #this/b match this');
    expect(screen.getByText('“changed NLP”')).toBeTruthy();
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });

    expect(runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'make #this/b match this',
        context: {
          block_id: 'a',
          selection: { block_id: 'a', text: 'changed NLP' },
          block_ids: ['b'],
        },
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('leaves the selection out once the author removes it', async () => {
    await mount();
    render(<Canvas />);
    await selectInBlock('Transformers');
    answerWith([]);

    await compose('summarise the document');
    await act(async () => {
      screen.getByRole('button', { name: /don't send the selection/i }).click();
    });
    expect(screen.queryByText('“Transformers”')).toBeNull();
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });

    const [params] = itemAt(runAgentTurn.mock.calls, 0);
    expect(params.context).toBeUndefined();
  });

  it('keeps the attached selection marked in the page until it is sent', async () => {
    const registry = new Map<string, unknown>();
    const cssBefore = (globalThis as { CSS?: unknown }).CSS;
    const highlightBefore = (globalThis as { Highlight?: unknown }).Highlight;
    (globalThis as { CSS?: unknown }).CSS = { ...(cssBefore as object), highlights: registry };
    (globalThis as { Highlight?: unknown }).Highlight = class {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    };
    try {
      await mount();
      render(<Canvas />);
      await selectInBlock('changed NLP');
      answerWith([]);

      const marked = registry.get('chat-context') as { ranges: Range[] } | undefined;
      expect(marked?.ranges[0]?.toString()).toBe('changed NLP');

      await compose('make it formal');
      await act(async () => {
        screen.getByRole('button', { name: /send message/i }).click();
      });
      // Sent once: the chip and the mark in the page go with it.
      expect(screen.queryByText('“changed NLP”')).toBeNull();
      expect(registry.has('chat-context')).toBe(false);
    } finally {
      (globalThis as { CSS?: unknown }).CSS = cssBefore;
      (globalThis as { Highlight?: unknown }).Highlight = highlightBefore;
    }
  });

  it('keeps the mark on the selected text after the block rewrites its text nodes', async () => {
    const registry = new Map<string, unknown>();
    const cssBefore = (globalThis as { CSS?: unknown }).CSS;
    const highlightBefore = (globalThis as { Highlight?: unknown }).Highlight;
    (globalThis as { CSS?: unknown }).CSS = { ...(cssBefore as object), highlights: registry };
    (globalThis as { Highlight?: unknown }).Highlight = class {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    };
    try {
      await mount();
      render(<Canvas />);
      await selectInBlock('changed NLP');
      const block = screen.getByTestId('block-a');
      const before = registry.get('chat-context') as { ranges: Range[] };

      // Focus leaves for the composer, and the editor re-renders the block
      // on blur: the page selection is gone and the old text node with it.
      await act(async () => {
        window.getSelection()!.removeAllRanges();
        const html = block.innerHTML;
        block.innerHTML = html;
      });
      expect(before.ranges[0]?.collapsed).toBe(true);

      const marked = registry.get('chat-context') as { ranges: Range[] } | undefined;
      expect(marked?.ranges[0]?.collapsed).toBe(false);
      expect(marked?.ranges[0]?.toString()).toBe('changed NLP');
      expect(block.contains(itemAt(marked!.ranges, 0).startContainer)).toBe(true);
    } finally {
      (globalThis as { CSS?: unknown }).CSS = cssBefore;
      (globalThis as { Highlight?: unknown }).Highlight = highlightBefore;
    }
  });

  it('inserts a prose reply after the list the caret is in, not inside it', async () => {
    await mount();
    await act(async () => {
      harness.editor.insertBlocksAfter('a', [
        { id: 'l1', type: 'paragraph', variant: 'bullet', html: 'one', children: [] },
        { id: 'l2', type: 'paragraph', variant: 'bullet', html: 'two', children: [] },
      ]);
    });
    function ListCanvas() {
      useRememberCaret();
      return (
        <div data-block-id="l1">
          <div className="editable" data-testid="block-l1">one</div>
        </div>
      );
    }
    render(<ListCanvas />);
    await act(async () => {
      const text = screen.getByTestId('block-l1').firstChild!;
      const range = document.createRange();
      range.setStart(text, 1);
      range.collapse(true);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    answerText('A paragraph of prose.\n\n- and a point');
    await compose('go');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });

    await act(async () => {
      (await screen.findByRole('button', { name: 'Insert into page' })).click();
    });

    const ids = harness.editor.blocks.map((block) => block.id);
    expect(ids.slice(0, 3)).toEqual(['a', 'l1', 'l2']);
    expect(ids[ids.length - 1]).toBe('b');
    expect(ids).toHaveLength(6);
  });
});

describe('the transcript after a turn', () => {
  it('keeps the reply it just streamed instead of refetching it', async () => {
    await mount();
    await sendWith([proposal({ actions: [{ op: 'delete_blocks', blockIds: ['b'] }] })]);
    await waitFor(() => expect(harness.review.pendingCount).toBe(1));

    // `done` hands back the chat and thread ids this transcript already is.
    // Fetching them replaced the live reply — tool activity, proposal chip and
    // all — with the server's plain text a second after it arrived.
    expect(listMessages).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /review 1 change/i })).toBeTruthy();
  });

  it('still loads a conversation the author switches to', async () => {
    await mount();
    await sendWith([]);
    await waitFor(() => expect(runAgentTurn).toHaveBeenCalled());

    // What the Chats panel does when a conversation is picked from the list.
    await act(async () => {
      harness.chats.setSelectedChatId('another-chat');
      harness.chats.setSelectedLeafId(7);
    });

    await waitFor(() =>
      // The trailing transport carries the signal that cancels this read on a
      // document switch, and the api layer's backoff sleep with it.
      expect(listMessages).toHaveBeenCalledWith(
        TEST_WORKSPACE_ID,
        DOC_ID,
        'another-chat',
        7,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it('loads the transcript under a StrictMode double mount', async () => {
    // The keyed guard used to be claimed before the first await and never
    // released, so setup/cleanup/setup left this permanently empty.
    listMessages.mockResolvedValue(branch([stored('user', 'Survives the double mount')]));

    await mount({ strict: true });
    await act(async () => {
      harness.chats.setSelectedChatId('strict-chat');
    });

    // In the transcript, and as the chat's name until it has a stored title.
    await waitFor(() =>
      expect(screen.getAllByText('Survives the double mount')).toHaveLength(2),
    );
  });
});

describe('document-scoped streams', () => {
  it('aborts on document switch and ignores mismatched or late tool events', async () => {
    let handlers!: AgentEventHandlers;
    let signal!: AbortSignal;
    let finish!: () => void;
    runAgentTurn.mockImplementation(
      (
        _params: unknown,
        nextHandlers: AgentEventHandlers,
        options: { signal?: AbortSignal },
      ) => {
        handlers = nextHandlers;
        signal = options.signal!;
        return new Promise((resolve) => {
          finish = () => resolve({ chatId: null, messageId: null, usage: null });
        });
      },
    );

    await mount();
    await compose('keep this scoped');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });
    await waitFor(() => expect(runAgentTurn).toHaveBeenCalledTimes(1));

    // Even before navigation, an event naming another document is invalid for
    // this assistant instance.
    act(() => {
      handlers.onToolAction?.(
        proposal({
          documentId: 'another-document',
          actions: [{ op: 'delete_blocks', blockIds: ['a'] }],
        }),
      );
    });
    expect(harness.review.pendingCount).toBe(0);

    await act(async () => {
      await harness.editor.switchTo('doc-2');
    });
    expect(signal.aborted).toBe(true);
    expect(harness.editor.documentId).toBe('doc-2');

    // A transport or mock may still hold and invoke callbacks after abort.
    // Neither proposals nor the new document's chat selection may change.
    await act(async () => {
      handlers.onToolAction?.(
        proposal({ actions: [{ op: 'delete_blocks', blockIds: ['a'] }] }),
      );
      handlers.onDone?.(agentDone('stale-chat', 99, { promptTokens: 0, completionTokens: 0 }));
      finish();
      await Promise.resolve();
    });

    expect(harness.review.pendingCount).toBe(0);
    expect(harness.chats.selectedChatId).toBeNull();
    expect(harness.chats.selectedLeafId).toBeNull();
    expect(harness.editor.blocks.map((block) => block.id)).toEqual(['a', 'b']);
  });
});

describe('live feedback while the assistant works', () => {
  /** Send a message and hold its stream open, returning its handlers. */
  async function holdStream() {
    let handlers!: AgentEventHandlers;
    let finish!: () => void;
    runAgentTurn.mockImplementation(
      (_params: unknown, nextHandlers: AgentEventHandlers) => {
        handlers = nextHandlers;
        return new Promise((resolve) => {
          finish = () => resolve({ done: null, terminal: 'done' });
        });
      },
    );
    await mount();
    await compose('what does section 2 claim?');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });
    await waitFor(() => expect(runAgentTurn).toHaveBeenCalledTimes(1));
    return {
      emit: (fn: (h: AgentEventHandlers) => void) => act(() => fn(handlers)),
      finish: async () => {
        await act(async () => {
          handlers.onDone?.(agentDone('chat-1', 1, { promptTokens: 0, completionTokens: 0 }));
          finish();
          await Promise.resolve();
        });
      },
    };
  }

  const statusWith = (text: string) =>
    screen.queryAllByRole('status').find((element) => element.textContent?.includes(text)) ?? null;

  it('names each step before the first word, in the engine’s own words', async () => {
    const turn = await holdStream();
    expect(statusWith('Thinking…')).toBeTruthy();

    turn.emit((h) => h.onStatus?.('starting', 'Starting Claude Code…'));
    expect(statusWith('Starting Claude Code…')).toBeTruthy();

    turn.emit((h) =>
      h.onStatus?.('retrying', 'Claude is overloaded — retrying in 8s (attempt 2 of 10)'),
    );
    expect(statusWith('Claude is overloaded — retrying in 8s (attempt 2 of 10)')).toBeTruthy();
    // The generic server wording never reaches the author verbatim.
    turn.emit((h) => h.onStatus?.('thinking', 'Processing tool results...'));
    expect(statusWith('Thinking…')).toBeTruthy();
    expect(statusWith('Processing tool results')).toBeNull();
    await turn.finish();
  });

  it('shows the model’s reasoning while it thinks, and folds it apart from the answer', async () => {
    const turn = await holdStream();
    turn.emit((h) => h.onReasoning?.('**Reading the document**\n\nSection 2 defines the loss.'));

    const toggle = screen.getByRole('button', { name: /^Thinking/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // The newest line, so a long silence reads as work.
    expect(screen.getByText('Section 2 defines the loss.')).toBeTruthy();

    turn.emit((h) => h.onToken?.('It claims sublinear scaling.'));
    await turn.finish();

    const folded = screen.getByRole('button', { name: /^Thought/ });
    expect(screen.queryByText('Section 2 defines the loss.')).toBeNull();
    fireEvent.click(folded);
    expect(screen.getByText('Reading the document').tagName).toBe('STRONG');
    expect(screen.getByText('Section 2 defines the loss.')).toBeTruthy();
    // Never part of the answer (on screen, or as announced when it finished).
    const answers = screen.getAllByText('It claims sublinear scaling.');
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) expect(answer.textContent).not.toContain('defines the loss');
  });

  it('counts a long edit as it is drafted, then runs it', async () => {
    const turn = await holdStream();
    turn.emit((h) => h.onToolCallStart?.('doc_edit', 'call_e', null));
    turn.emit((h) =>
      h.onToolCallProgress?.({ tool: 'doc_edit', toolCallId: 'call_e', argumentsChars: 2410 }),
    );
    // Shown, and said in the row's name for a screen reader.
    expect(screen.getAllByText(new RegExp(`${(2410).toLocaleString()} characters`))).toHaveLength(2);

    // Large arguments arrive as a preview only, without the full object.
    turn.emit((h) =>
      h.onToolCallArgs?.({ tool: 'doc_edit', toolCallId: 'call_e', argumentsPreview: '{"content_redacted": true}', argumentsTruncated: true }),
    );
    expect(screen.queryAllByText(/characters/)).toHaveLength(0);
    // A count that trails the call's arguments is ignored.
    turn.emit((h) =>
      h.onToolCallProgress?.({ tool: 'doc_edit', toolCallId: 'call_e', argumentsChars: 2500 }),
    );
    expect(screen.queryAllByText(/characters/)).toHaveLength(0);
    await turn.finish();
  });

  it('says the model went back to thinking once its tools finish', async () => {
    const turn = await holdStream();
    turn.emit((h) => h.onToolCallStart?.('web_search', 'call_1', null));
    // The running step itself is the indicator; no second line competes.
    expect(statusWith('Thinking…')).toBeNull();

    turn.emit((h) =>
      h.onToolCallEnd?.({
        tool: 'web_search', toolCallId: 'call_1', durationMs: 900, isError: false, error: null,
        errorType: null, outputPreview: null, outputChars: 0, outputTruncated: false,
        argumentsPreview: '{}', argumentsTruncated: false,
      }),
    );
    expect(statusWith('Thinking…')).toBeTruthy();
    await turn.finish();
  });

  it('keeps a line under a reply that paused to search, where the reader is looking', async () => {
    const turn = await holdStream();
    turn.emit((h) => h.onToken?.('Let me check the literature.'));
    // Words are arriving: the text is the progress.
    expect(statusWith('Working…')).toBeNull();

    turn.emit((h) => h.onToolCallStart?.('web_search', 'call_2', null));
    // After a short debounce, under the answer (the activity list sits above it).
    await waitFor(() => expect(statusWith('Searching the web…')).toBeTruthy());
    const answer = screen.getByText('Let me check the literature.');
    const line = statusWith('Searching the web…')!;
    expect(answer.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await turn.finish();
    expect(statusWith('Searching the web…')).toBeNull();
  });

  it('shows a reply that stopped mid-way as still working', async () => {
    const turn = await holdStream();
    turn.emit((h) => h.onToken?.('First paragraph.'));
    await waitFor(() => expect(statusWith('Working…')).toBeTruthy(), { timeout: 3000 });
    turn.emit((h) => h.onToken?.(' More.'));
    expect(statusWith('Working…')).toBeNull();
    await turn.finish();
  });
});

/** Answer the next send with prose, then `done` with the given usage. */
function answerText(text: string, usage = { promptTokens: 0, completionTokens: 0 }) {
  runAgentTurn.mockImplementation(
    async (_params: unknown, handlers: AgentEventHandlers) => {
      handlers.onToken?.(text);
      handlers.onDone?.(agentDone('chat-1', 1, usage));
      return { chatId: 'chat-1', messageId: 1, usage, terminal: 'done' };
    },
  );
}

describe('the docked panel', () => {
  it('fills the column it is given, with no window of its own', async () => {
    await mount();

    const region = screen.getByRole('region', { name: 'Writing assistant for Doc' });
    expect(region.closest('aside')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /move assistant/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /maximise assistant/i })).toBeNull();
    expect(screen.getByText('How can I help with this paper?')).toBeTruthy();
    // Width is the sidebar's: with no sidebar around, there is nothing to widen.
    expect(screen.queryByRole('button', { name: /widen the assistant/i })).toBeNull();
  });

  it('widens the docked sidebar for a long conversation, and back', async () => {
    const setRightWidth = vi.fn();
    await mount({ panels: { isDesktop: true, rightWidth: 420, setRightWidth } });
    fireEvent.click(screen.getByRole('button', { name: 'Widen the panel' }));
    expect(setRightWidth).toHaveBeenCalledWith(720);

    cleanup();
    await mount({ panels: { isDesktop: true, rightWidth: 720, setRightWidth } });
    fireEvent.click(screen.getByRole('button', { name: 'Narrow the panel' }));
    expect(setRightWidth).toHaveBeenLastCalledWith(420);
  });

  it('closes the sheet on a phone before showing a reply’s changes in the page', async () => {
    const setAssistantOpen = vi.fn();
    await mount({ panels: { isDesktop: false, setAssistantOpen } });
    await sendWith([
      proposal({
        actions: [{ op: 'write_blocks', position: 'replace', blockId: 'a', blocks: [{ id: 'a', type: 'paragraph', html: 'edited', children: [] }] }],
      }),
    ]);
    await waitFor(() => expect(harness.review.pendingCount).toBe(1));

    fireEvent.click(await screen.findByRole('button', { name: 'Review 1 change' }));
    // The sheet covers the page, so it goes first; then the change is shown.
    expect(setAssistantOpen).toHaveBeenCalledWith(false);
    await waitFor(
      () => expect(harness.review.focusedChangeId).toBe(itemAt(harness.review.pending, 0).id),
      { timeout: 2000 },
    );
  });

  it('sends a suggestion straight away', async () => {
    await mount();
    answerWith([]);

    await act(async () => {
      screen.getByRole('button', { name: 'Find related work' }).click();
    });

    expect(runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/related work/i) }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('names the conversation by its first question until it has a stored title', async () => {
    await mount();
    expect(screen.getByRole('button', { name: 'Chats: New chat' })).toBeTruthy();

    await sendWith([]);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Chats: do the thing' })).toBeTruthy(),
    );
    // The API keeps no title of its own; the list learns the same name.
    expect(updateChatTitle).toHaveBeenCalledWith(DOC_ID, 'chat-1', 'do the thing');
  });

  it('lists this document’s chats in the header and opens the one picked', async () => {
    listChats.mockResolvedValue({
      items: [chatSummary({ id: 'chat-7', title: 'Outline review', last_message_id: 7 })],
      next_cursor: null,
    });
    await mount();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Chats:/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^Outline review/ }));
    });

    await waitFor(() =>
      expect(listMessages).toHaveBeenCalledWith(TEST_WORKSPACE_ID, DOC_ID, 'chat-7', 7, expect.anything()),
    );
    expect(harness.chats.selectedChatId).toBe('chat-7');
    expect(screen.getByRole('button', { name: 'Chats: Outline review' })).toBeTruthy();
  });

  it('starts over from New chat', async () => {
    await mount();
    answerText('An answer.');
    await compose('first question');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy());

    await act(async () => {
      screen.getByRole('button', { name: 'Start a new chat' }).click();
    });

    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByText('How can I help with this paper?')).toBeTruthy();
    expect(harness.chats.selectedChatId).toBeNull();
  });

  it('offers to ask the latest question again', async () => {
    await mount();
    answerText('First take.');
    await compose('tighten the abstract');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy());

    await act(async () => {
      screen.getByRole('button', { name: 'Retry' }).click();
    });

    expect(runAgentTurn).toHaveBeenCalledTimes(2);
    expect(runAgentTurn.mock.calls[1]?.[0]).toMatchObject({ message: 'tighten the abstract' });
  });

  it('says under a finished reply when it was written, how long it took and what it used', async () => {
    await mount();
    answerText('Done.', { promptTokens: 12_400, completionTokens: 890 });
    await compose('go');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });

    expect(await screen.findByRole('button', { name: 'Copy' })).toBeTruthy();
    const details = screen.getByRole('button', { name: /^Reply details:/ });
    expect(details.textContent).toMatch(/took \d/);
    expect(details.textContent).toContain('13.3k tokens');
    expect(details.querySelector('time')?.getAttribute('dateTime')).toMatch(/^\d{4}-\d\d-\d\dT/);

    // The breakdown is a click (or a tap) away.
    await act(async () => {
      fireEvent.click(details);
    });
    expect(await screen.findByText('Reply details')).toBeTruthy();
    expect(screen.getByText(`${(12_400).toLocaleString()} in · 890 out`)).toBeTruthy();
    expect(screen.getByText(/^after \d/)).toBeTruthy();
  });

  it('copies a question as it was written', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      await mount();
      answerText('An answer.');
      await compose('tighten the abstract');
      await act(async () => {
        screen.getByRole('button', { name: /send message/i }).click();
      });

      await act(async () => {
        (await screen.findByRole('button', { name: 'Copy message' })).click();
      });

      expect(writeText).toHaveBeenCalledWith('tighten the abstract');
      // Said to a screen reader, which would not re-read the unchanged name.
      await waitFor(() =>
        expect(screen.queryAllByRole('status').some((element) => element.textContent === 'Copied')).toBe(true),
      );
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('stops a run on Escape', async () => {
    let signal!: AbortSignal;
    runAgentTurn.mockImplementation(
      (_params: unknown, _handlers: AgentEventHandlers, options: { signal?: AbortSignal }) => {
        signal = options.signal!;
        return new Promise(() => {});
      },
    );
    await mount();
    const host = await compose('a long question');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /stop generating/i })).toBeTruthy());

    await act(async () => {
      fireEvent.keyDown(host, { key: 'Escape' });
    });

    expect(signal.aborted).toBe(true);
    expect(screen.getByRole('button', { name: /send message/i })).toBeTruthy();
  });
});

describe('a document the assistant created', () => {
  it('is offered rather than opened behind the author’s back', async () => {
    await mount();
    await sendWith([
      proposal({
        tool: 'doc_create',
        status: 'applied',
        // `doc_create` names the document it has just made, never the one on
        // screen. Matching that against the open document dropped the event,
        // and creating a document looked to the author like nothing happening.
        documentId: 'created-doc',
        actions: [{ op: 'create_document', documentId: 'created-doc' }],
      }),
    ]);

    await waitFor(() => expect(harness.review.invites).toHaveLength(1));
    expect(harness.review.invites[0]?.documentId).toBe('created-doc');
    // Switching documents throws away whatever the author was in the middle of.
    expect(harness.editor.documentId).toBe(DOC_ID);
    expect(getDocument).not.toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'created-doc');
  });

  it('brings none of that document’s edits into this one', async () => {
    await mount();
    await sendWith([
      proposal({
        tool: 'doc_create',
        status: 'applied',
        documentId: 'created-doc',
        actions: [
          { op: 'create_document', documentId: 'created-doc' },
          // Operations addressed to the new document. They are about blocks
          // this document has never heard of, so they belong there, not here.
          { op: 'delete_blocks', blockIds: ['a'] },
        ],
      }),
    ]);

    await waitFor(() => expect(harness.review.invites).toHaveLength(1));
    expect(harness.review.pendingCount).toBe(0);
    expect(harness.editor.blocks.map((block) => block.id)).toEqual(['a', 'b']);
  });
});

describe('a document that has never been saved', () => {
  it('is saved and attached before the first message goes out', async () => {
    await mountUnsaved();
    await sendWith([]);

    await waitFor(() => expect(createDocument).toHaveBeenCalledTimes(1));
    expect(runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'do the thing', document_id: 'created-doc' }),
      expect.anything(),
      expect.anything(),
    );
    await waitFor(() => expect(harness.editor.documentId).toBe('created-doc'));
  });

  it('keeps the conversation that saved it', async () => {
    await mountUnsaved();
    await sendWith([]);

    // Acquiring an id is not navigating away. Keying the panel on the document
    // id alone remounted it here, throwing away the message the author had
    // just sent — along with the chat the server created for it.
    await waitFor(() => expect(harness.chats.selectedChatId).toBe('chat-1'));
    expect(harness.chats.selectedLeafId).toBe(1);
    // The empty state is gone, so the transcript survived the attach.
    expect(screen.queryByText(/How can I help/i)).toBeNull();
  });

  it('says so rather than greying the suggestions out', async () => {
    await mountUnsaved();
    await compose('');

    expect(screen.getByText(/Asking saves this page first/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Summarize this page/i }).hasAttribute('disabled'),
    ).toBe(false);
  });
});

describe('the document a session is attached to', () => {
  it('is named beside the composer, so “nothing happened” can be told from “that happened elsewhere”', async () => {
    await mount();
    await compose('');

    expect(screen.getByTitle(/This conversation is kept with “Doc”/).textContent).toBe('Doc');
    expect(screen.getByText('“Doc”')).toBeTruthy();
  });

  it('reaches a screen reader through the region label', async () => {
    await mount();
    await compose('');

    // The page chip is small, muted and not focusable, so on its own it would
    // only be found by reading the whole panel.
    expect(
      screen.getByRole('region', { name: 'Writing assistant for Doc' }),
    ).toBeTruthy();
  });

  it('follows a rename, whoever made it', async () => {
    await mount();
    await compose('');

    await act(async () => {
      harness.editor.setDocName('Attention Is All You Need');
    });

    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Writing assistant for Attention Is All You Need' }),
      ).toBeTruthy(),
    );
    expect(screen.getByTitle(/kept with “Attention Is All You Need”/)).toBeTruthy();
  });

  it('says nothing is attached yet rather than naming a document it cannot act on', async () => {
    await mountUnsaved();
    await compose('');

    expect(screen.getByText('Not saved yet')).toBeTruthy();
    expect(
      screen.getByRole('region', {
        name: 'Writing assistant for a page that has not been saved yet',
      }),
    ).toBeTruthy();
  });

  it('switches to the document as soon as the first message attaches one', async () => {
    await mountUnsaved();
    await compose('');
    expect(screen.getByText('Not saved yet')).toBeTruthy();

    await sendWith([]);

    await waitFor(() => expect(screen.queryByText('Not saved yet')).toBeNull());
    expect(
      screen.getByRole('region', { name: 'Writing assistant for Untitled page' }),
    ).toBeTruthy();
  });
});

describe('what a screen reader hears when a reply ends (U-14)', () => {
  it('announces "Reply finished", never the raw reply', async () => {
    await mount();
    runAgentTurn.mockImplementation(async (_params: unknown, handlers: AgentEventHandlers) => {
      handlers.onToken?.('It **scales** sublinearly [S1], see $x^2$.');
      handlers.onDone?.(agentDone('chat-1', 1, { promptTokens: 0, completionTokens: 0 }));
      return { chatId: 'chat-1', messageId: 1, usage: null };
    });
    await compose('does it scale?');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });

    await waitFor(() =>
      expect(screen.queryAllByRole('status').some((element) => element.textContent === 'Reply finished.')).toBe(true),
    );
    expect(screen.queryAllByRole('status').some((element) => /\*\*|\[S1\]|\$x\^2\$/.test(element.textContent ?? ''))).toBe(false);
  });

  it('announces nothing when a stored conversation opens', async () => {
    listMessages.mockResolvedValue(branch([stored('user', 'Earlier question'), stored('assistant', 'An **earlier** answer.')]));
    await mount();
    await act(async () => {
      harness.chats.setSelectedChatId('chat-1');
    });
    await waitFor(() => expect(screen.getAllByText('Earlier question').length).toBeGreaterThan(0));
    expect(screen.queryAllByRole('status').some((element) => element.textContent === 'Reply finished.')).toBe(false);
    expect(screen.queryAllByRole('status').some((element) => element.textContent?.includes('earlier'))).toBe(false);
  });
});

describe('what the agent reads', () => {
  it('flushes unsaved edits before asking, so it is the document on screen', async () => {
    await mount();
    saveDocument.mockClear();

    await act(async () => {
      harness.editor.setDocName('Renamed by the author');
    });
    expect(harness.editor.hasPendingEdits()).toBe(true);

    await sendWith([]);

    // The agent reads the *stored* document. Autosave is five seconds behind,
    // which is long enough to ask about a paragraph the server has not seen —
    // and get back a rewrite of the version already replaced.
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));
    expect(saveDocument.mock.invocationCallOrder[0]).toBeLessThan(
      itemAt(runAgentTurn.mock.invocationCallOrder, 0),
    );
  });

  it('does not ask when that save fails, and says why', async () => {
    await mount();
    saveDocument.mockClear();
    saveDocument.mockRejectedValueOnce(new Error('offline'));

    await act(async () => {
      harness.editor.setDocName('Renamed by the author');
    });
    await sendWith([]);

    // Sending anyway meant the assistant answered about a version the author
    // had already replaced — and its edits then proposed against stale blocks.
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('could not be saved'),
    );
    expect(runAgentTurn).not.toHaveBeenCalled();
  });
});

describe('a chat id the server no longer has', () => {
  it('starts a fresh conversation on this document instead of wedging', async () => {
    await mount();

    await act(async () => {
      harness.chats.setSelectedChatId('deleted-chat');
    });
    await waitFor(() => expect(harness.chats.selectedChatId).toBe('deleted-chat'));

    let attempt = 0;
    runAgentTurn.mockImplementation(
      async (_params: unknown, handlers: AgentEventHandlers) => {
        attempt += 1;
        if (attempt === 1) {
          handlers.onError?.('CHAT_NOT_FOUND', 'Chat not found for this document.');
          return { chatId: null, messageId: null, usage: null };
        }
        handlers.onDone?.(agentDone('fresh-chat', 4, { promptTokens: 0, completionTokens: 0 }));
        return { chatId: 'fresh-chat', messageId: 4, usage: null };
      },
    );

    await compose('carry on');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });

    await waitFor(() => expect(runAgentTurn).toHaveBeenCalledTimes(2));
    expect(runAgentTurn.mock.calls[1]?.[0]).toMatchObject({
      document_id: DOC_ID,
      chat_id: null,
      leaf_id: null,
    });
    await waitFor(() => expect(harness.chats.selectedChatId).toBe('fresh-chat'));
    // Recovered without ever showing the author an error it had already fixed.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports the failure when the retry fails too', async () => {
    await mount();

    runAgentTurn.mockImplementation(
      async (_params: unknown, handlers: AgentEventHandlers) => {
        handlers.onError?.('CHAT_NOT_FOUND', 'Chat not found for this document.');
        return { chatId: null, messageId: null, usage: null };
      },
    );

    await compose('carry on');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });

    await waitFor(() => expect(runAgentTurn).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Chat not found'),
    );
  });
});

describe('agent engine', () => {
  function engineContext(overrides: Partial<EngineContext> = {}): EngineContext {
    return {
      catalog: null,
      loading: false,
      error: null,
      prefs: { chat: 'claude', inline: 'chat', models: { claude: 'sonnet' } },
      preferencesReady: true,
      savingPreferences: false,
      preferenceError: null,
      selectable: false,
      statusOf: () => null,
      requestFor: (surface) => (surface === 'chat' ? { engine: 'claude', model: 'sonnet' } : {}),
      setChatEngine: () => {},
      setSurfaceEngine: () => {},
      saveDefaults: () => {},
      setModel: () => null,
      setGatewayModel: () => null,
      checking: null,
      checkError: {},
      check: async () => null,
      refresh: async () => {},
      noteRunError: vi.fn(),
      ...overrides,
    };
  }

  it('runs the turn on the chosen engine and model', async () => {
    const engines = engineContext();
    await mount({ engines });
    await sendWith([]);

    const [params] = itemAt(runAgentTurn.mock.calls, 0);
    expect(params.engine).toBe('claude');
    expect(params.model).toBe('sonnet');
    expect(params.profile).toBe('chat');
  });

  it('sends no engine at all on the default', async () => {
    await mount();
    await sendWith([]);

    const [params] = itemAt(runAgentTurn.mock.calls, 0);
    expect('engine' in params).toBe(false);
    expect('model' in params).toBe(false);
  });

  it('shows a CLI sign-in problem as something to fix, not to retry', async () => {
    const engines = engineContext();
    runAgentTurn.mockImplementation(async (_params: unknown, handlers: AgentEventHandlers) => {
      handlers.onError?.(
        'ENGINE_AUTH_REQUIRED',
        'Claude Code is not signed in. Run `claude auth login` in your terminal, sign in with your own account, then check the engine again.',
      );
      return { done: null, terminal: 'error' };
    });
    await mount({ engines });
    await compose('hello');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });

    expect(engines.noteRunError).toHaveBeenCalledWith('ENGINE_AUTH_REQUIRED');
    expect(await screen.findByText(/Run `claude auth login` in your terminal/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});


describe('assistant file attachments', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps file-drop feedback across children, clears it on exit, and preserves the draft on invalid drops', async () => {
    const upload = vi.spyOn(chatAttachments, 'uploadChatImage');
    await mount();
    await compose('Keep my draft');
    const composer = screen.getByRole('group', { name: 'Message composer' });
    const input = screen.getByRole('textbox');
    // Browsers hide the file list until drop, but expose its type.
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'none' };
    fireEvent.dragEnter(composer, { dataTransfer });
    fireEvent.dragEnter(input, { dataTransfer });
    fireEvent.dragLeave(input, { dataTransfer });
    expect(screen.getByText('Drop images or PDFs to attach')).toBeTruthy();
    expect(fireEvent.dragOver(input, { dataTransfer })).toBe(false);
    expect(dataTransfer.dropEffect).toBe('copy');
    fireEvent.dragLeave(composer, { dataTransfer });
    expect(screen.queryByText('Drop images or PDFs to attach')).toBeNull();
    fireEvent.dragEnter(input, { dataTransfer });
    const file = new File(['text'], 'notes.txt', { type: 'text/plain' });
    expect(fireEvent.drop(input, { dataTransfer: {
      ...dataTransfer, files: [file], getData: () => 'file:///notes.txt',
    } })).toBe(false);
    expect(screen.queryByText('Drop images or PDFs to attach')).toBeNull();
    expect(input.textContent).toBe('Keep my draft');
    expect(await screen.findByText('Choose a PDF, PNG, JPEG, WebP, or GIF file.')).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps plain-text drops working without treating them as attachments', async () => {
    const upload = vi.spyOn(chatAttachments, 'uploadChatImage');
    await mount();
    const input = screen.getByRole('textbox');
    const dataTransfer = { types: ['text/plain'], files: [], getData: () => 'Dropped caption' };
    fireEvent.dragEnter(input, { dataTransfer });
    expect(screen.queryByText('Drop images or PDFs to attach')).toBeNull();
    fireEvent.drop(input, { dataTransfer });
    expect(input.textContent).toBe('Dropped caption');
    expect(upload).not.toHaveBeenCalled();
  });

  it('prevents file drops while a reply is running without inserting their fallback text', async () => {
    const upload = vi.spyOn(chatAttachments, 'uploadChatImage');
    let finish!: () => void;
    runAgentTurn.mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve({ done: null, terminal: 'done' });
    }));
    await mount();
    await compose('Start replying');
    await act(async () => screen.getByRole('button', { name: 'Send message' }).click());
    await screen.findByRole('button', { name: 'Stop generating' });
    await compose('My next message');
    const input = screen.getByRole('textbox');
    const dataTransfer = { types: ['Files'], files: [new File(['png'], 'chart.png', { type: 'image/png' })],
      dropEffect: 'copy', getData: () => 'file:///chart.png' };
    fireEvent.dragEnter(input, { dataTransfer });
    expect(screen.getByText('Wait for the reply to finish before attaching files')).toBeTruthy();
    expect(fireEvent.dragOver(input, { dataTransfer })).toBe(false);
    expect(dataTransfer.dropEffect).toBe('none');
    expect(fireEvent.drop(input, { dataTransfer })).toBe(false);
    expect(input.textContent).toBe('My next message');
    expect(upload).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: 'Files to send' })).toBeNull();
    expect(screen.queryByText('Wait for the reply to finish before attaching files')).toBeNull();
    await act(async () => finish());
  });

  it.each(['upload', 'paste', 'drop'])('blocks sends during %s, then sends an image-only message and retains it on retry', async (method) => {
    let finish!: (attachment: chatAttachments.ChatAttachment) => void;
    vi.spyOn(chatAttachments, 'uploadChatImage').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    vi.spyOn(assets, 'loadAssetBlob').mockRejectedValue(new Error('No preview in test'));
    await mount();
    answerText('The chart shows a rising trend.');
    const file = new File(['png'], 'chart.png', { type: 'image/png' });
    if (method === 'paste') {
      fireEvent.paste(screen.getByRole('textbox'), { clipboardData: {
        items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
        files: [file], getData: () => '',
      } });
    } else if (method === 'drop') {
      fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: { types: ['Files'], files: [file] } });
    } else {
      fireEvent.change(screen.getByLabelText('Upload images or PDFs'), { target: { files: [file] } });
    }
    expect(chatAttachments.uploadChatImage).toHaveBeenCalledExactlyOnceWith(TEST_WORKSPACE_ID, file);
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(runAgentTurn).not.toHaveBeenCalled();
    const attachment: chatAttachments.ChatAttachment = { kind: 'image', asset_id: 'asset-1', filename: 'chart.png', media_type: 'image/png', size_bytes: 3 };
    await act(async () => finish(attachment));
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => screen.getByRole('button', { name: 'Send message' }).click());
    expect(runAgentTurn.mock.calls[0]?.[0]).toMatchObject({ message: '', attachments: [attachment] });
    expect(screen.getByRole('link', { name: /chart.png/ }).getAttribute('href')).toContain('/assets/asset-1/content');
    expect(screen.queryByRole('list', { name: 'Files to send' })).toBeNull();
    await act(async () => screen.getByRole('button', { name: 'Retry' }).click());
    expect(runAgentTurn.mock.calls[1]?.[0]).toMatchObject({ message: '', attachments: [attachment] });
  });

  it.each(['upload', 'drop'])('%s saves a new PDF on the open page and attaches its resource id', async (method) => {
    const resource = makeResource({ id: 23, filename: 'new-paper.pdf', extraction: { status: 'pending' } });
    resourceServer.upload.mockResolvedValue(resource);
    await mount();
    answerText('I will review the paper.');
    const file = new File(['%PDF'], 'new-paper.pdf', { type: 'application/pdf' });
    if (method === 'drop') {
      fireEvent.drop(screen.getByRole('group', { name: 'Message composer' }), { dataTransfer: { types: ['Files'], files: [file] } });
    } else {
      fireEvent.change(screen.getByLabelText('Upload images or PDFs'), { target: { files: [file] } });
    }
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false));
    await act(async () => screen.getByRole('button', { name: 'Send message' }).click());
    expect(resourceServer.upload).toHaveBeenCalledWith({ file: 'file:application/pdf', location: 'document', document_id: DOC_ID });
    expect(runAgentTurn.mock.calls[0]?.[0].attachments).toEqual([chatAttachments.resourceAttachment(resource)]);
    expect(screen.getByRole('link', { name: 'new-paper.pdf' }).getAttribute('href')).toContain('/resources/23/content');
  });

  it('loads more library PDFs and attaches the selection without moving its folder or document', async () => {
    const first = Array.from({ length: 20 }, (_, id) => makeResource({ id: id + 1, filename: `paper-${id + 1}.pdf` }));
    const last = makeResource({ id: 42, filename: 'older-paper.pdf', location: inCollection(3, 'Saved sources') });
    resourceServer.list
      .mockResolvedValueOnce({ items: first, next_cursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [last], next_cursor: null });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Attach images or PDFs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose a PDF from the Library' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load more PDFs' }));
    fireEvent.click(await screen.findByRole('button', { name: 'older-paper.pdf' }));
    expect(resourceServer.list).toHaveBeenLastCalledWith({ scope: 'library', limit: '20', cursor: 'cursor-2' });
    expect(screen.getByRole('button', { name: 'Remove older-paper.pdf' })).toBeTruthy();
    expect(resourceServer.move).not.toHaveBeenCalled();
  });

  it('restores attachment filenames and links from stored conversation metadata', async () => {
    listMessages.mockResolvedValue(branch([stored('user', 'Review this PDF', { attachments: [
      { kind: 'resource', resource_id: 51, filename: 'saved-reference.pdf', media_type: 'application/pdf', size_bytes: 42 },
    ] })]));
    await mount();
    await act(async () => harness.chats.setSelectedChatId('saved-attachments'));
    const link = await screen.findByRole('link', { name: 'saved-reference.pdf' });
    expect(link.getAttribute('href')).toContain('/resources/51/content');
  });
});


it('keeps an earlier image-only exchange when a different image-only run resumes before persistence', async () => {
  vi.spyOn(assets, 'loadAssetBlob').mockRejectedValue(new Error('No preview in test'));
  listMessages.mockResolvedValue(branch([
    stored('user', '', { attachments: [{ kind: 'image', asset_id: 'asset-a', filename: 'first-chart.png' }] }),
    stored('assistant', 'Earlier chart explanation.'),
  ]));
  vi.spyOn(agentSessions, 'findActiveAgentRun').mockResolvedValue(assistantSnapshot({
    session: { id: 'session-b', document_id: DOC_ID, chat_id: 'image-chat', title: 'Images', profile: 'chat', last_seq: 1, active_run_id: 'run-b' },
    run: { id: 'run-b', session_id: 'session-b', request_id: 'request-b', status: 'running', request: {
      document_id: DOC_ID, chat_id: 'image-chat', message: '', attachments: [{ kind: 'image', asset_id: 'asset-b' }],
    } },
  }));
  runAgentTurn.mockImplementation(async (_params: unknown, handlers: AgentEventHandlers) => {
    handlers.onToken?.('Current chart explanation.');
    handlers.onDone?.(agentDone('image-chat', 6, { promptTokens: 0, completionTokens: 0 }));
    return { done: null, terminal: 'done' };
  });
  await mount();
  await act(async () => harness.chats.setSelectedChatId('image-chat'));
  await screen.findAllByText('Current chart explanation.');
  expect(screen.getByText('Earlier chart explanation.')).toBeTruthy();
  expect(screen.getByRole('link', { name: /first-chart.png/ }).getAttribute('href')).toContain('/assets/asset-a/content');
  expect(screen.getByRole('link', { name: /Image attachment/ }).getAttribute('href')).toContain('/assets/asset-b/content');
  expect(runAgentTurn.mock.calls[0]?.[2].resume).toEqual({ sessionId: 'session-b', runId: 'run-b', afterSeq: 0 });
  vi.restoreAllMocks();
});


it('starts a fresh run after a confirmed PDF extraction timeout while retaining the attachment', async () => {
  const resource = makeResource({ id: 61, filename: 'processing.pdf' });
  resourceServer.upload.mockResolvedValue(resource);
  await mount();
  const file = new File(['%PDF'], 'processing.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Upload images or PDFs'), { target: { files: [file] } });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false));
  runAgentTurn.mockImplementationOnce(async (_params: unknown, handlers: AgentEventHandlers, options: { onRunStarted: (run: agentSessions.ResumeAgentRun) => void }) => {
    options.onRunStarted({ sessionId: 'session-1', runId: 'failed-run' });
    handlers.onError?.('ATTACHMENT_EXTRACTION_TIMEOUT', 'The PDF is still processing. Retry shortly.');
    return { done: null, terminal: 'error' };
  });
  await act(async () => screen.getByRole('button', { name: 'Send message' }).click());
  await screen.findByRole('button', { name: 'Try again' });
  answerText('The PDF is ready.');
  await act(async () => screen.getByRole('button', { name: 'Try again' }).click());
  expect(itemAt(runAgentTurn.mock.calls, 1)[2].resume).toBeUndefined();
  expect(runAgentTurn.mock.calls[1]?.[0].attachments).toEqual([chatAttachments.resourceAttachment(resource)]);
  expect(screen.getAllByRole('link', { name: 'processing.pdf' })).toHaveLength(1);
  vi.restoreAllMocks();
});


it.each(['run-a', undefined])('preserves a completed identical upload when run identity is %s', async (oldRunId) => {
  vi.spyOn(assets, 'loadAssetBlob').mockRejectedValue(new Error('No preview in test'));
  listMessages.mockResolvedValue(branch([
    stored('user', '', { run_id: oldRunId ?? null, attachments: [{ kind: 'resource', resource_id: 7, filename: 'same-paper.pdf' }] }),
    stored('assistant', 'Earlier paper explanation.'),
  ]));
  vi.spyOn(agentSessions, 'findActiveAgentRun').mockResolvedValue(assistantSnapshot({
    session: { id: 'session-b', document_id: DOC_ID, chat_id: 'same-file-chat', title: 'PDFs', profile: 'chat', last_seq: 1, active_run_id: 'run-b' },
    run: { id: 'run-b', session_id: 'session-b', request_id: 'request-b', status: 'queued', request: {
      document_id: DOC_ID, chat_id: 'same-file-chat', message: '', attachments: [{ kind: 'resource', resource_id: 7 }],
    } },
  }));
  runAgentTurn.mockImplementation(async (_params: unknown, handlers: AgentEventHandlers) => {
    handlers.onToken?.('Current paper explanation.');
    handlers.onDone?.(agentDone('same-file-chat', 6, { promptTokens: 0, completionTokens: 0 }));
    return { done: null, terminal: 'done' };
  });
  await mount();
  await act(async () => harness.chats.setSelectedChatId('same-file-chat'));
  await screen.findAllByText('Current paper explanation.');
  expect(screen.getByText('Earlier paper explanation.')).toBeTruthy();
  expect(screen.getAllByRole('list', { name: 'Message attachments' })).toHaveLength(2);
  expect(screen.getByRole('link', { name: 'same-paper.pdf' }).getAttribute('href')).toContain('/resources/7/content');
  vi.restoreAllMocks();
});

it('reconciles the exact saved run and retains canonical PDF metadata across a reconnect retry', async () => {
  const attachment: chatAttachments.ChatAttachment = { kind: 'resource', resource_id: 7, filename: 'same-paper.pdf' };
  listMessages.mockResolvedValue(branch([
    stored('user', '', { run_id: 'run-b', attachments: [attachment] }),
    stored('assistant', 'An incomplete saved answer.'),
  ]));
  vi.spyOn(agentSessions, 'findActiveAgentRun').mockResolvedValue(assistantSnapshot({
    session: { id: 'session-b', document_id: DOC_ID, chat_id: 'same-file-chat', title: 'PDFs', profile: 'chat', last_seq: 1, active_run_id: 'run-b' },
    run: { id: 'run-b', session_id: 'session-b', request_id: 'request-b', status: 'running', request: {
      document_id: DOC_ID, chat_id: 'same-file-chat', message: '', attachments: [{ kind: 'resource', resource_id: 7 }],
    } },
  }));
  runAgentTurn.mockImplementationOnce(async () => ({ done: null, terminal: null }));
  await mount();
  await act(async () => harness.chats.setSelectedChatId('same-file-chat'));
  await screen.findByRole('button', { name: 'Try again' });
  expect(screen.queryByText('An incomplete saved answer.')).toBeNull();
  expect(screen.getAllByRole('list', { name: 'Message attachments' })).toHaveLength(1);
  answerText('The restored answer.');
  await act(async () => screen.getByRole('button', { name: 'Try again' }).click());
  expect(runAgentTurn.mock.calls[1]?.[2].resume).toEqual({ sessionId: 'session-b', runId: 'run-b', afterSeq: 0 });
  expect(runAgentTurn.mock.calls[1]?.[0].attachments).toEqual([attachment]);
  expect(screen.getAllByRole('link', { name: 'same-paper.pdf' })).toHaveLength(1);
  vi.restoreAllMocks();
});


describe('a run the server reported as ended', () => {
  it.each([
    ['STREAM_ERROR', 'The assistant stream failed.'],
    ['MODEL_GATEWAY_TRANSIENT', 'The assistant\u2019s model is not responding right now. Try again shortly.'],
    ['AGENT_INTERRUPTED', 'The assistant run was interrupted. Your saved work is available in the conversation.'],
  ])('starts a new run on Try again after %s, instead of replaying the failed one', async (code, message) => {
    runAgentTurn.mockImplementationOnce(async (_params: unknown, handlers: AgentEventHandlers, options: { onRunStarted: (run: agentSessions.ResumeAgentRun) => void }) => {
      options.onRunStarted({ sessionId: 'session-1', runId: 'failed-run', requestId: 'request-1' });
      handlers.onToken?.('Half an answer');
      handlers.onError?.(code, message);
      return { done: null, terminal: 'error' };
    });
    await mount();
    await compose('explain attention');
    await act(async () => screen.getByRole('button', { name: /send message/i }).click());
    await screen.findByRole('button', { name: 'Try again' });

    answerText('The whole answer.');
    await act(async () => screen.getByRole('button', { name: 'Try again' }).click());

    // Reattaching to the failed run only replayed its saved error.
    expect(itemAt(runAgentTurn.mock.calls, 1)[2].resume).toBeUndefined();
    expect(runAgentTurn.mock.calls[1]?.[0].message).toBe('explain attention');
    expect((await screen.findAllByText('The whole answer.')).length).toBeGreaterThan(0);
  });

  it.each([
    ['MODEL_GATEWAY_AUTH', 'The assistant cannot reach its model service: the server\u2019s credentials were rejected. This needs the site administrator; trying again will not help.'],
    ['MODEL_GATEWAY_BILLING', 'The assistant\u2019s model account has run out of credit. This needs the site administrator; trying again will not help.'],
    ['MODEL_GATEWAY_REJECTED', 'Every configured model refused this request. It may be too large: try a shorter message, fewer attachments or a new conversation.'],
    ['MODEL_NOT_CONFIGURED', 'The selected lite model is no longer configured. Choose a model again in Settings → AI & tools.'],
    ['MODEL_GATEWAY_CONTEXT', 'This conversation is too large for the assistant\u2019s models, even after condensing it. Start a new conversation or remove large attachments, then ask again.'],
    ['MODEL_CONTEXT_TOO_LARGE', 'This document and request are larger than the assistant can read at once (about 212,000 tokens; the limit is 180,000). Remove or shorten attachments, or split the document, then ask again.'],
  ])('shows %s as something Try again cannot fix', async (code, message) => {
    runAgentTurn.mockImplementationOnce(async (_params: unknown, handlers: AgentEventHandlers) => {
      handlers.onError?.(code, message);
      return { done: null, terminal: 'error' };
    });
    await mount();
    await compose('hello');
    await act(async () => screen.getByRole('button', { name: /send message/i }).click());

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});


describe('the task list of a multi-step request', () => {
  const tasks = [
    { id: 'a', content: 'Tighten the abstract', status: 'completed' as const },
    { id: 'b', content: 'Check the related work', status: 'in_progress' as const },
    { id: 'c', content: 'Fix the citations', status: 'pending' as const },
  ];

  it('stays pinned above the composer while the turn runs, then joins the reply', async () => {
    let finish: (() => void) | null = null;
    runAgentTurn.mockImplementation((_params: unknown, handlers: AgentEventHandlers) => new Promise((resolve) => {
      handlers.onTodo?.(tasks);
      handlers.onToken?.('Working through it.');
      finish = () => {
        handlers.onDone?.(agentDone('chat-1', 1, { promptTokens: 0, completionTokens: 0 }));
        resolve({ done: null, terminal: 'done' });
      };
    }));
    await mount();
    await compose('revise the paper');
    await act(async () => screen.getByRole('button', { name: /send message/i }).click());

    const bar = await screen.findByRole('region', { name: 'Task progress' });
    // One line: how far, and what is being worked on now.
    expect(bar.textContent).toContain('1/3');
    expect(bar.textContent).toContain('Check the related work');
    expect(screen.queryByRole('list', { name: 'Assistant task list' })).toBeNull();
    fireEvent.click(within(bar).getByRole('button'));
    expect(within(bar).getByRole('list', { name: 'Assistant task list' }).textContent).toContain('Fix the citations');

    await act(async () => finish?.());

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Task progress' })).toBeNull());
    expect(screen.getByText(/Tasks · 1 of 3 done/)).toBeTruthy();
    // Started and never finished is not the same as never started.
    expect(screen.getByText('Not finished:')).toBeTruthy();
  });
});

describe('the composer’s effort choice', () => {
  async function choose(label: string) {
    await act(async () => fireEvent.keyDown(screen.getByRole('button', { name: /^Assistant effort:/ }), { key: 'ArrowDown' }));
    const option = await screen.findByRole('menuitemradio', { name: new RegExp(`^${label}`) });
    await act(async () => fireEvent.click(option));
  }

  it('sends the chosen tier, adopts its new chat, and Retry repeats that tier rather than the current choice', async () => {
    await mount();
    expect(screen.getByRole('button', { name: 'Assistant effort: Standard' })).toBeTruthy();
    await choose('Quick');
    answerText('A short answer.');
    await compose('Explain routing');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send message' })));
    await screen.findByRole('button', { name: 'Retry' });
    expect(runAgentTurn.mock.calls[0]?.[0]).toMatchObject({ effort: 'quick' });
    expect(screen.getByRole('button', { name: 'Assistant effort: Quick' })).toBeTruthy();
    await choose('Standard');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(runAgentTurn.mock.calls[1]?.[0]).toMatchObject({ message: 'Explain routing', effort: 'quick' });
    expect(screen.getByRole('button', { name: 'Assistant effort: Standard' })).toBeTruthy();
  });

  it('resets to the catalog default when New chat is selected', async () => {
    await mount();
    await choose('Deep');
    expect(screen.getByRole('button', { name: 'Assistant effort: Deep' })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' })));
    expect(screen.getByRole('button', { name: 'Assistant effort: Standard' })).toBeTruthy();
  });
});

describe('the composer’s Web choice', () => {
  it('offers Web only where the catalog permits it and sends false by default', async () => {
    await mount();
    expect(screen.queryByRole('switch', { name: 'Web search' })).toBeNull();
    answerText('A short answer.');
    await compose('Explain routing');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send message' })));
    expect(runAgentTurn.mock.calls[0]?.[0]).toMatchObject({ web: false });
  });

  it('uses the visible Web switch for each new reply, including Retry, and resets on New chat', async () => {
    fixtures.assistant = { switches: { web: true }, sources: {} };
    await mount();
    expect(screen.getByRole('switch', { name: 'Web search' }).getAttribute('aria-checked')).toBe('false');
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: 'Web search' })));
    answerText('A short answer.');
    await compose('Explain routing');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send message' })));
    await screen.findByRole('button', { name: 'Retry' });
    expect(runAgentTurn.mock.calls[0]?.[0]).toMatchObject({ web: true });
    expect(screen.getByRole('switch', { name: 'Web search' }).getAttribute('aria-checked')).toBe('true');
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: 'Web search' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(runAgentTurn.mock.calls[1]?.[0]).toMatchObject({ web: false });
    expect(screen.getByRole('switch', { name: 'Web search' }).getAttribute('aria-checked')).toBe('false');
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: 'Web search' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(runAgentTurn.mock.calls[2]?.[0]).toMatchObject({ web: true });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' })));
    expect(screen.getByRole('switch', { name: 'Web search' }).getAttribute('aria-checked')).toBe('false');
  });

  it('retries a saved prompt with Web off when the switch is unavailable', async () => {
    listChats.mockResolvedValue({ items: [chatSummary({ id: 'saved', title: 'Saved conversation', last_message_id: 2 })], next_cursor: null });
    listMessages.mockResolvedValue(branch([
      stored('user', 'Find routing sources', { record: { kind: 'request', preset: null, effort: 'quick', web: true, plan_id: null } }),
      stored('assistant', 'Earlier answer.'),
    ]));
    await mount();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Chats:/ })));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: /^Saved conversation/ })));
    await screen.findByText('Earlier answer.');
    expect(screen.queryByRole('switch', { name: 'Web search' })).toBeNull();
    answerText('A new answer.');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(runAgentTurn.mock.calls[0]?.[0]).toMatchObject({ effort: 'quick', web: false });
    expect(screen.queryByRole('switch', { name: 'Web search' })).toBeNull();
  });

  it('uses the current switch when Try again starts a fresh run after a failure', async () => {
    fixtures.assistant = { switches: { web: true }, sources: {} };
    await mount();
    const web = screen.getByRole('switch', { name: 'Web search' });
    await act(async () => fireEvent.click(web));
    runAgentTurn.mockImplementationOnce(async (_params, handlers: AgentEventHandlers) => {
      handlers.onError?.('MODEL_GATEWAY_TRANSIENT', 'The model is unavailable.');
      return { done: null, terminal: 'error' };
    });
    await compose('Search the public web');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send message' })));
    const retry = await screen.findByRole('button', { name: 'Try again' });
    await act(async () => fireEvent.click(web));
    answerText('A new answer.');
    await act(async () => fireEvent.click(retry));
    expect(runAgentTurn.mock.calls.map(([request]) => request.web)).toEqual([true, false]);
    expect(runAgentTurn.mock.calls[1]?.[2].resume).toBeUndefined();
  });

  it('shows the saved Web choice while following a running reply, then restores the composer choice', async () => {
    fixtures.assistant = { switches: { web: true }, sources: {} };
    await mount();
    vi.spyOn(agentSessions, 'findActiveAgentRun').mockResolvedValue(assistantSnapshot({
      session: { id: 'session-1', document_id: DOC_ID, chat_id: 'saved', active_run_id: 'run-1' },
      run: { id: 'run-1', session_id: 'session-1', status: 'running', request: {
        document_id: DOC_ID, chat_id: 'saved', message: 'Search the public web', web: true,
      } },
    }));
    let finish!: () => void;
    runAgentTurn.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ done: null, terminal: 'done' });
    }));
    await act(async () => harness.chats.setSelectedChatId('saved'));
    const web = screen.getByRole('switch', { name: 'Web search' }) as HTMLButtonElement;
    await waitFor(() => expect(web.disabled).toBe(true));
    expect(web.getAttribute('aria-checked')).toBe('true');
    expect(web.textContent).toBe('Web on');
    await act(async () => finish());
    expect(web.disabled).toBe(false);
    expect(web.getAttribute('aria-checked')).toBe('false');
    expect(web.textContent).toBe('Web off');
  });
});

describe('the author’s question card in the conversation', () => {
  const question: AgentQuestion = {
    question_id: 'question-one',
    questions: [
      { id: 'venue', text: 'Which venue?', options: ['ICLR', 'NeurIPS'], allow_free_text: false },
      { id: 'scope', text: 'Which period?', options: [], allow_free_text: true },
    ],
  };
  function ask() {
    runAgentTurn.mockImplementationOnce(async (_params: unknown, handlers: AgentEventHandlers) => {
      handlers.onQuestion?.(question);
      handlers.onToken?.('These choices will help.');
      handlers.onDone?.(agentDone('chat-1', 101, { promptTokens: 0, completionTokens: 0 }));
      return { done: null, terminal: 'done' };
    });
  }

  it.each([false, true])('sends only structured answers with an empty wire message (skip %s), leaving the composer usable', async (skip) => {
    ask();
    await mount();
    await compose('Ask me about scope');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send message' })));
    await screen.findByRole('button', { name: 'Send answers' });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ICLR' })));
    const items = skip ? [] : [{ id: 'venue', answer: 'ICLR' }];
    answerText('I will follow that scope.');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: skip ? 'Go with your best guess' : 'Send answers' })));
    const request = runAgentTurn.mock.calls[1]?.[0];
    expect(request).toMatchObject({ message: '', answers: { question_id: 'question-one', items }, web: false, effort: 'standard' });
    expect(request).not.toHaveProperty('displayText');
    expect(screen.getByText(skip
      ? 'I skip your questions: go with your best judgement, and say what you assumed.'
      : 'My answers to your questions: - Which venue? ICLR')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send answers' })).toBeNull();
    expect(screen.getByRole('button', { name: 'ICLR' }).closest('fieldset')?.disabled).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Ask AI anything… # to reference a block' }).getAttribute('contenteditable')).toBe('true');
  });

  it('retries the captured answers-only request without serializing or duplicating its readable prompt', async () => {
    ask();
    await mount();
    await compose('Ask me about scope');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send message' })));
    runAgentTurn.mockImplementationOnce(async (_params: unknown, handlers: AgentEventHandlers) => {
      handlers.onError?.('MODEL_GATEWAY_TRANSIENT', 'The model is not available.');
      return { done: null, terminal: 'error' };
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Go with your best guess' })));
    await screen.findByRole('button', { name: 'Try again' });
    answerText('I’ll state my assumptions.');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    const requests = runAgentTurn.mock.calls.slice(1).map(([request]) => request);
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.message === '' && !('displayText' in request))).toBe(true);
    expect(requests.map((request) => request.answers)).toEqual([
      { question_id: 'question-one', items: [] }, { question_id: 'question-one', items: [] },
    ]);
    expect(screen.getAllByText('I skip your questions: go with your best judgement, and say what you assumed.')).toHaveLength(1);
  });

  it('restores the latest question as actionable, but an ordinary message makes older cards historical', async () => {
    const record = new TurnRecord();
    record.observe({ event: 'question', data: question });
    const reply = record.snapshot('completed', { cost_limit: 5, limit_reached: null });
    listMessages.mockResolvedValue(branch([
      stored('user', 'An earlier question.'),
      stored('assistant', 'Earlier choices.', { record: { ...reply, question: { ...question, question_id: 'older' } } }),
      stored('user', 'Ask me again.'),
      stored('assistant', 'These choices will help.', { record: reply }),
    ]));
    await mount();
    await act(async () => harness.chats.setSelectedChatId('saved-questions'));
    await screen.findByText('These choices will help.');
    expect(screen.getAllByRole('region', { name: 'A few questions' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Send answers' })).toHaveLength(1);
    answerText('A normal answer.');
    await compose('Continue without a card answer');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send message' })));
    expect(runAgentTurn.mock.calls[0]?.[0]).toMatchObject({ message: 'Continue without a card answer' });
    expect(runAgentTurn.mock.calls[0]?.[0].answers).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Send answers' })).toBeNull();
  });
});

describe('a proposed plan in the conversation', () => {
  it('starts the edited plan as a Deep run, keeps its first card, and pins proposal progress', async () => {
    const proposed = proposePlan(TEST_WORKSPACE_ID, DOC_ID, 'chat-1');
    let current = proposed;
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}/plans/{plan_id}',
      ({ response }) => response(200).json(current, { headers: { ETag: planEtag(current) } })));
    runAgentTurn.mockImplementationOnce(async (_params: unknown, handlers: AgentEventHandlers) => {
      handlers.onPlan?.(planEvent(proposed));
      handlers.onToken?.('Here is a plan.');
      handlers.onDone?.(agentDone('chat-1', 101, { promptTokens: 0, completionTokens: 0 }));
      return { done: null, terminal: 'done' };
    });
    await mount();
    await compose('Plan a review');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send message' })));
    const field = await screen.findByRole('textbox', { name: 'Section 1 title' }) as HTMLInputElement;
    await waitFor(() => expect(field.readOnly).toBe(false));
    fireEvent.change(field, { target: { value: 'A precise mechanism section' } });
    let finish: (() => void) | undefined;
    runAgentTurn.mockImplementationOnce((_params: unknown, handlers: AgentEventHandlers) => new Promise((resolve) => {
      current = { ...proposed, revision: 3, state: 'running', sections: proposed.sections.map((section, index) => ({
        ...section, title: index === 0 ? 'A precise mechanism section' : section.title, state: index === 0 ? 'working' : 'pending',
      })) };
      handlers.onPlan?.(planEvent(current));
      finish = () => {
        handlers.onToken?.('Sections proposed for review.');
        handlers.onDone?.(agentDone('chat-1', 103, { promptTokens: 0, completionTokens: 0 }));
        resolve({ done: null, terminal: 'done' });
      };
    }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start writing' })));
    const request = runAgentTurn.mock.calls[1]?.[0];
    expect(request).toMatchObject({
      message: '', effort: 'deep', plan_id: proposed.plan_id, web: false,
      plan: { revision: 1, sections: expect.arrayContaining([expect.objectContaining({ id: 'mechanism', title: 'A precise mechanism section' })]) },
    });
    expect(request).not.toHaveProperty('displayText');
    expect(screen.getByText('Write the approved plan, section by section.')).toBeTruthy();
    expect(screen.getAllByRole('region', { name: 'Plan' })).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Section 1 title' })).toBe(field);
    expect(screen.getByRole('region', { name: 'Plan progress' }).textContent).toContain('0/3 sections proposed for review');
    const pending = screen.getByRole('textbox', { name: 'Section 2 title' }) as HTMLInputElement;
    await waitFor(() => expect(pending.readOnly).toBe(false));
    expect(screen.queryByRole('button', { name: 'Use current plan' })).toBeNull();
    expect(field.readOnly).toBe(true);
    await act(async () => finish?.());
  });
});
