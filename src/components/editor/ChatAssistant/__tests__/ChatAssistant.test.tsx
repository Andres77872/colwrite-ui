import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { SSEEventHandlers } from '@/services/streamParser';
import type { ToolAction } from '@/editor/types';

/**
 * Integration tests for the real ChatAssistant, EditorProvider and
 * ProposalsProvider — the path a `tool_action` travels from the stream to the
 * document.
 *
 * The contract under test: the assistant never writes to the document. A
 * `proposed` action queues changes for review and leaves the blocks alone
 * until the author accepts. An `applied` action — the server running in `auto`
 * mode — is a replay of something already committed and does land directly.
 */

// ── Service mocks ──

/** The document the server holds; the provider hydrates from this on mount. */
const serverDoc = () => ({
  version: 1,
  name: 'Doc',
  blocks: [
    { id: 'a', type: 'paragraph', html: '<p>a</p>', children: [] },
    { id: 'b', type: 'paragraph', html: '<p>b</p>', children: [] },
  ],
});

const streamAgentChat = vi.fn();
const listDocuments = vi.fn(async () => ({ documents: [{}], count: 1, status: 'ok', message: '' }));
const loadDocument = vi.fn(async (id: string) =>
  id === 'created-doc' ? { version: 1, blocks: [], name: 'New doc' } : serverDoc(),
);
const saveDocument = vi.fn(async () => ({ status: 'ok', message: '', version: 2 }));
const createDocument = vi.fn(async () => ({ document_id: 'created-doc', version: 1 }));

vi.mock('@/services/agentChat', () => ({
  streamAgentChat: (...args: unknown[]) => streamAgentChat(...args),
}));
vi.mock('@/services/chats', () => ({
  listMessages: vi.fn(async () => ({ messages: [], pivotThreadId: null })),
  listThreads: vi.fn(async () => ({ threads: [] })),
}));
vi.mock('@/services', async () => ({
  createDocument: () => createDocument(),
  saveDocument: () => saveDocument(),
  loadDocument: (id: string) => loadDocument(id),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: () => listDocuments(),
}));

const { EditorProvider, useEditor } = await import('@/editor');
const { ProposalsProvider, useProposals } = await import('@/editor/ProposalsContext');
const { ChatSessionsProvider } = await import('../../../chat/ChatSessionsContext');
const { ChatAssistant } = await import('../ChatAssistant');

// ── Harness ──

const DOC_ID = 'doc-1';

let editor: ReturnType<typeof useEditor>;
let review: ReturnType<typeof useProposals>;

function Capture() {
  editor = useEditor();
  review = useProposals();
  return null;
}

/** Renders the assistant against a document that is already saved remotely. */
async function mount() {
  localStorage.setItem('colwrite:lastDocId', DOC_ID);

  render(
    <EditorProvider>
      <ProposalsProvider>
        <Capture />
        <ChatSessionsProvider>
          <ChatAssistant />
        </ChatSessionsProvider>
      </ProposalsProvider>
    </EditorProvider>,
  );

  // The provider probes for remote documents and hydrates from the server.
  await waitFor(() => expect(listDocuments).toHaveBeenCalled());
  await waitFor(() => expect(editor.blocks).toHaveLength(2));
}

/** Drive one send, handing the component the given tool_action events. */
async function sendWith(actions: ToolAction[]) {
  streamAgentChat.mockImplementation(
    async (_params: unknown, handlers: SSEEventHandlers) => {
      for (const action of actions) handlers.onToolAction?.(action);
      handlers.onDone?.('chat-1', 1, { promptTokens: 0, completionTokens: 0 });
      return { chatId: 'chat-1', threadId: 1, usage: null };
    },
  );

  // Expand the panel if it is collapsed.
  const trigger = screen.queryByRole('button', { name: /^assistant$/i });
  if (trigger) {
    await act(async () => {
      trigger.click();
    });
  }

  // The composer is a contenteditable that rebuilds its model from the DOM on
  // `input`, so set the text and fire the event the component listens for.
  const host = screen.getByRole('textbox');
  await act(async () => {
    host.textContent = 'do the thing';
    host.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await act(async () => {
    screen.getByRole('button', { name: /send message/i }).click();
  });
}

function proposal(overrides: Partial<ToolAction> = {}): ToolAction {
  return {
    tool: 'doc_edit',
    toolCallId: 'call_1',
    actions: [],
    documentId: DOC_ID,
    version: 5,
    status: 'proposed',
    ...overrides,
  };
}

/** An action from a server configured to commit its own edits. */
function committed(overrides: Partial<ToolAction> = {}): ToolAction {
  return proposal({ status: 'applied', ...overrides });
}

const acceptAll = async () => {
  await act(async () => {
    review.acceptAll();
  });
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listDocuments.mockResolvedValue({ documents: [{}], count: 1, status: 'ok', message: '' });
});

afterEach(() => {
  // vitest is not running with `globals`, so RTL's auto-cleanup never fires.
  cleanup();
  localStorage.clear();
});

// ── Tests ──

describe('proposed changes await the author', () => {
  it('does not touch the document until a change is accepted', async () => {
    await mount();
    await sendWith([
      proposal({
        actions: [{ op: 'replace_block', blockId: 'a', block: { html: '<p>edited</p>' } }],
      }),
    ]);

    await waitFor(() => expect(review.pendingCount).toBe(1));
    // The whole point: the block still holds what the author wrote.
    expect(editor.blocks[0]).toMatchObject({ id: 'a', html: '<p>a</p>' });
  });

  it('applies the change once accepted', async () => {
    await mount();
    await sendWith([
      proposal({
        actions: [{ op: 'replace_block', blockId: 'a', block: { html: '<p>edited</p>' } }],
      }),
    ]);
    await waitFor(() => expect(review.pendingCount).toBe(1));

    await act(async () => {
      review.accept(review.pending[0].id);
    });

    expect(editor.blocks[0]).toMatchObject({ id: 'a', html: '<p>edited</p>' });
    expect(review.pendingCount).toBe(0);
  });

  it('discards the change on reject', async () => {
    await mount();
    await sendWith([proposal({ actions: [{ op: 'delete_block', blockId: 'b' }] })]);
    await waitFor(() => expect(review.pendingCount).toBe(1));

    await act(async () => {
      review.reject(review.pending[0].id);
    });

    expect(editor.blocks.map((b) => b.id)).toEqual(['a', 'b']);
    expect(review.pendingCount).toBe(0);
  });

  it('accepting is a local edit, so it has to be saved', async () => {
    await mount();
    await sendWith([proposal({ actions: [{ op: 'delete_block', blockId: 'b' }] })]);
    await waitFor(() => expect(review.pendingCount).toBe(1));

    await acceptAll();

    // A proposal exists nowhere but this browser; leaving the document clean
    // would lose the accepted text on reload.
    await waitFor(() => expect(editor.doc.blocks).toHaveLength(1));
    expect(saveDocument).not.toHaveBeenCalled(); // debounced, not immediate
  });

  it('does not adopt a proposal’s version', async () => {
    await mount();
    await sendWith([proposal({ version: 42, actions: [{ op: 'delete_block', blockId: 'b' }] })]);

    // Storage did not move, so neither may the version the next save locks on.
    await waitFor(() => expect(review.pendingCount).toBe(1));
    expect(editor.doc.version).toBe(1);
  });

  it('queues every batch from one run, in order', async () => {
    await mount();
    await sendWith([
      proposal({ toolCallId: 'call_1', actions: [{ op: 'delete_block', blockId: 'a' }] }),
      proposal({ toolCallId: 'call_2', actions: [{ op: 'delete_block', blockId: 'b' }] }),
    ]);

    await waitFor(() => expect(review.pendingCount).toBe(2));
    await acceptAll();
    expect(editor.blocks).toHaveLength(0);
  });

  it('ignores a redelivered tool action', async () => {
    await mount();
    await sendWith([
      proposal({ actions: [{ op: 'append_block', block: { id: 'z', type: 'divider' } }] }),
      proposal({ actions: [{ op: 'append_block', block: { id: 'z', type: 'divider' } }] }),
    ]);

    await waitFor(() => expect(review.pendingCount).toBe(1));
    await acceptAll();
    expect(editor.blocks).toHaveLength(3);
  });

  it('keeps a reused tool_call_id whose operations differ', async () => {
    // Providers that number calls per request reuse `call_0` every run, so
    // matching on the id alone dropped the next message's first edit.
    await mount();
    await sendWith([
      proposal({ toolCallId: 'call_0', actions: [{ op: 'delete_block', blockId: 'a' }] }),
      proposal({ toolCallId: 'call_0', actions: [{ op: 'delete_block', blockId: 'b' }] }),
    ]);

    await waitFor(() => expect(review.pendingCount).toBe(2));
  });

  it('keeps both edits when neither action carries a tool_call_id', async () => {
    // A staged batch reports the *stored* version, so two proposals in one run
    // look identical on every field except their operations.
    await mount();
    await sendWith([
      proposal({ toolCallId: '', version: 5, actions: [{ op: 'delete_block', blockId: 'a' }] }),
      proposal({ toolCallId: '', version: 5, actions: [{ op: 'delete_block', blockId: 'b' }] }),
    ]);

    await waitFor(() => expect(review.pendingCount).toBe(2));
    await acceptAll();
    expect(editor.blocks).toHaveLength(0);
  });

  it('renames the document only on accept', async () => {
    await mount();
    await sendWith([proposal({ actions: [{ op: 'update_meta', meta: { name: 'Renamed' } }] })]);

    await waitFor(() => expect(review.pendingCount).toBe(1));
    expect(editor.doc.name).toBe('Doc');

    await acceptAll();
    expect(editor.doc.name).toBe('Renamed');
  });

  it('blocks a change until the one it builds on is accepted', async () => {
    await mount();
    await sendWith([
      proposal({
        actions: [
          { op: 'append_block', block: { id: 'new', type: 'paragraph', html: 'x' } },
          { op: 'replace_block', blockId: 'new', block: { html: 'y' } },
        ],
      }),
    ]);

    await waitFor(() => expect(review.pendingCount).toBe(2));
    const [first, second] = review.pending;
    expect(review.ready(first)).toBe(true);
    // Accepting the rewrite alone would patch a block that does not exist yet.
    expect(review.ready(second)).toBe(false);

    await act(async () => {
      review.accept(first.id);
    });
    await waitFor(() => expect(review.ready(review.pending[0])).toBe(true));
  });

  it('drops dependents when their prerequisite is rejected', async () => {
    await mount();
    await sendWith([
      proposal({
        actions: [
          { op: 'append_block', block: { id: 'new', type: 'paragraph', html: 'x' } },
          { op: 'replace_block', blockId: 'new', block: { html: 'y' } },
        ],
      }),
    ]);
    await waitFor(() => expect(review.pendingCount).toBe(2));

    await act(async () => {
      review.reject(review.pending[0].id);
    });

    expect(review.pendingCount).toBe(0);
    expect(editor.blocks).toHaveLength(2);
  });

  it('reports a change that can no longer be applied', async () => {
    await mount();
    await sendWith([
      proposal({
        actions: [
          { op: 'insert_block_after', referenceId: 'ghost', block: { id: 'n', type: 'divider' } },
        ],
      }),
    ]);
    await waitFor(() => expect(review.pendingCount).toBe(1));

    await acceptAll();

    await waitFor(() => expect(review.error).toMatch(/could not be applied/i));
    // The block is not guessed into some other position.
    expect(editor.blocks.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('surfaces a failed edit in the chat', async () => {
    await mount();
    await sendWith([
      proposal({ status: 'error', message: 'Version conflict', version: 11, actions: [] }),
    ]);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Version conflict'),
    );
  });
});

describe('committed changes from a server in auto mode', () => {
  it('applies block operations directly', async () => {
    await mount();
    await sendWith([
      committed({
        actions: [{ op: 'replace_block', blockId: 'a', block: { html: '<p>edited</p>' } }],
      }),
    ]);

    await waitFor(() => {
      expect(editor.blocks[0]).toMatchObject({ id: 'a', html: '<p>edited</p>' });
    });
    // Nothing to approve — the server already saved it.
    expect(review.pendingCount).toBe(0);
  });

  it('adopts the version the server reports', async () => {
    await mount();
    await sendWith([committed({ version: 42, actions: [{ op: 'delete_block', blockId: 'b' }] })]);

    // Without this the next save optimistically locks on a stale version and
    // is rejected for the rest of the session.
    await waitFor(() => expect(editor.doc.version).toBe(42));
  });
});

describe('a document the assistant created', () => {
  it('is offered rather than opened behind the author’s back', async () => {
    await mount();
    await sendWith([
      proposal({
        tool: 'doc_create',
        actions: [{ op: 'create_document', documentId: 'created-doc' }],
      }),
    ]);

    await waitFor(() => expect(review.invites).toHaveLength(1));
    // Switching documents throws away whatever the author was in the middle of.
    expect(editor.documentId).toBe(DOC_ID);
    expect(loadDocument).not.toHaveBeenCalledWith('created-doc');
  });
});
