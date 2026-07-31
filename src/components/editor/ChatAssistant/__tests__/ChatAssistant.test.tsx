import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';
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
const listMessages = vi.fn(async () => ({ messages: [], pivotThreadId: null }));
const listThreads = vi.fn(async () => ({ threads: [] }));
vi.mock('@/services/chats', () => ({
  listMessages: (...args: unknown[]) => listMessages(...(args as [])),
  listThreads: (...args: unknown[]) => listThreads(...(args as [])),
}));
vi.mock('@/services', async () => ({
  createDocument: () => createDocument(),
  saveDocument: () => saveDocument(),
  loadDocument: (id: string) => loadDocument(id),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: () => listDocuments(),
}));

const { EditorProvider, useEditor } = await import('@/editor');
const { ProposalsProvider } = await import('@/editor/ProposalsContext');
const { useProposals } = await import('@/editor/proposalsContextState');
const { ChatSessionsProvider } = await import('../../../chat/ChatSessionsContext');
const { useChatSessions } = await import('../../../chat/chatSessionsState');
// The assistant's open/closed state is shell state, so the panels provider is
// part of its contract rather than an ambient convenience.
const { PanelsProvider } = await import('../../../panels');
const { ChatAssistant } = await import('../ChatAssistant');

// ── Harness ──

const DOC_ID = 'doc-1';

type HarnessHandle = {
  editor: ReturnType<typeof useEditor>;
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
  const editor = useEditor();
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
async function mount() {
  localStorage.setItem('colwrite:lastDocId', DOC_ID);

  render(
    <EditorProvider>
      <ProposalsProvider>
        <Capture />
        <ChatSessionsProvider>
          <CaptureChats />
          <PanelsProvider>
            <ChatAssistant />
          </PanelsProvider>
        </ChatSessionsProvider>
      </ProposalsProvider>
    </EditorProvider>,
  );

  // The provider probes for remote documents and hydrates from the server.
  await waitFor(() => expect(listDocuments).toHaveBeenCalled());
  await waitFor(() => expect(harness.editor.blocks).toHaveLength(2));
}

/** Expand the panel if it is collapsed, and put text in the composer. */
async function compose(text: string) {
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
    host.textContent = text;
    host.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return host;
}

/** Answer the next send with the given tool_action events. */
function answerWith(actions: ToolAction[]) {
  streamAgentChat.mockImplementation(
    async (_params: unknown, handlers: SSEEventHandlers) => {
      for (const action of actions) handlers.onToolAction?.(action);
      handlers.onDone?.('chat-1', 1, { promptTokens: 0, completionTokens: 0 });
      return { chatId: 'chat-1', threadId: 1, usage: null };
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
    harness.review.acceptAll();
  });
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listDocuments.mockResolvedValue({ documents: [{}], count: 1, status: 'ok', message: '' });

  // jsdom ships no `matchMedia`, so every media query reads as false and the
  // assistant renders its small-screen layout — the one without a window to
  // move. Answer width queries the way a desktop would.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
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

    await waitFor(() => expect(harness.review.pendingCount).toBe(1));
    // The whole point: the block still holds what the author wrote.
    expect(harness.editor.blocks[0]).toMatchObject({ id: 'a', html: '<p>a</p>' });
  });

  it('applies the change once accepted', async () => {
    await mount();
    await sendWith([
      proposal({
        actions: [{ op: 'replace_block', blockId: 'a', block: { html: '<p>edited</p>' } }],
      }),
    ]);
    await waitFor(() => expect(harness.review.pendingCount).toBe(1));

    await act(async () => {
      harness.review.accept(harness.review.pending[0].id);
    });

    expect(harness.editor.blocks[0]).toMatchObject({ id: 'a', html: '<p>edited</p>' });
    expect(harness.review.pendingCount).toBe(0);
  });

  it('discards the change on reject', async () => {
    await mount();
    await sendWith([proposal({ actions: [{ op: 'delete_block', blockId: 'b' }] })]);
    await waitFor(() => expect(harness.review.pendingCount).toBe(1));

    await act(async () => {
      harness.review.reject(harness.review.pending[0].id);
    });

    expect(harness.editor.blocks.map((b) => b.id)).toEqual(['a', 'b']);
    expect(harness.review.pendingCount).toBe(0);
  });

  it('accepting is a local edit, so it has to be saved', async () => {
    await mount();
    await sendWith([proposal({ actions: [{ op: 'delete_block', blockId: 'b' }] })]);
    await waitFor(() => expect(harness.review.pendingCount).toBe(1));

    await acceptAll();

    // A proposal exists nowhere but this browser; leaving the document clean
    // would lose the accepted text on reload.
    await waitFor(() => expect(harness.editor.doc.blocks).toHaveLength(1));
    expect(saveDocument).not.toHaveBeenCalled(); // debounced, not immediate
  });

  it('does not adopt a proposal’s version', async () => {
    await mount();
    await sendWith([proposal({ version: 42, actions: [{ op: 'delete_block', blockId: 'b' }] })]);

    // Storage did not move, so neither may the version the next save locks on.
    await waitFor(() => expect(harness.review.pendingCount).toBe(1));
    expect(harness.editor.doc.version).toBe(1);
  });

  it('queues every batch from one run, in order', async () => {
    await mount();
    await sendWith([
      proposal({ toolCallId: 'call_1', actions: [{ op: 'delete_block', blockId: 'a' }] }),
      proposal({ toolCallId: 'call_2', actions: [{ op: 'delete_block', blockId: 'b' }] }),
    ]);

    await waitFor(() => expect(harness.review.pendingCount).toBe(2));
    await acceptAll();
    expect(harness.editor.blocks).toHaveLength(0);
  });

  it('ignores a redelivered tool action', async () => {
    await mount();
    await sendWith([
      proposal({ actions: [{ op: 'append_block', block: { id: 'z', type: 'divider' } }] }),
      proposal({ actions: [{ op: 'append_block', block: { id: 'z', type: 'divider' } }] }),
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
      proposal({ toolCallId: 'call_0', actions: [{ op: 'delete_block', blockId: 'a' }] }),
      proposal({ toolCallId: 'call_0', actions: [{ op: 'delete_block', blockId: 'b' }] }),
    ]);

    await waitFor(() => expect(harness.review.pendingCount).toBe(2));
  });

  it('keeps both edits when neither action carries a tool_call_id', async () => {
    // A staged batch reports the *stored* version, so two proposals in one run
    // look identical on every field except their operations.
    await mount();
    await sendWith([
      proposal({ toolCallId: '', version: 5, actions: [{ op: 'delete_block', blockId: 'a' }] }),
      proposal({ toolCallId: '', version: 5, actions: [{ op: 'delete_block', blockId: 'b' }] }),
    ]);

    await waitFor(() => expect(harness.review.pendingCount).toBe(2));
    await acceptAll();
    expect(harness.editor.blocks).toHaveLength(0);
  });

  it('renames the document only on accept', async () => {
    await mount();
    await sendWith([proposal({ actions: [{ op: 'update_meta', meta: { name: 'Renamed' } }] })]);

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
          { op: 'append_block', block: { id: 'new', type: 'paragraph', html: 'x' } },
          { op: 'replace_block', blockId: 'new', block: { html: 'y' } },
        ],
      }),
    ]);

    await waitFor(() => expect(harness.review.pendingCount).toBe(2));
    const [first, second] = harness.review.pending;
    expect(harness.review.ready(first)).toBe(true);
    // Accepting the rewrite alone would patch a block that does not exist yet.
    expect(harness.review.ready(second)).toBe(false);

    await act(async () => {
      harness.review.accept(first.id);
    });
    await waitFor(() => expect(harness.review.ready(harness.review.pending[0])).toBe(true));
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
    await waitFor(() => expect(harness.review.pendingCount).toBe(2));

    await act(async () => {
      harness.review.reject(harness.review.pending[0].id);
    });

    expect(harness.review.pendingCount).toBe(0);
    expect(harness.editor.blocks).toHaveLength(2);
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
    await waitFor(() => expect(harness.review.pendingCount).toBe(1));

    await acceptAll();

    await waitFor(() => expect(harness.review.error).toMatch(/could not be applied/i));
    // The block is not guessed into some other position.
    expect(harness.editor.blocks.map((b) => b.id)).toEqual(['a', 'b']);
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
      expect(harness.editor.blocks[0]).toMatchObject({ id: 'a', html: '<p>edited</p>' });
    });
    // Nothing to approve — the server already saved it.
    expect(harness.review.pendingCount).toBe(0);
  });

  it('adopts the version the server reports', async () => {
    await mount();
    await sendWith([committed({ version: 42, actions: [{ op: 'delete_block', blockId: 'b' }] })]);

    // Without this the next save optimistically locks on a stale version and
    // is rejected for the rest of the session.
    await waitFor(() => expect(harness.editor.doc.version).toBe(42));
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

    expect(streamAgentChat).toHaveBeenCalledWith(
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

    expect(streamAgentChat).not.toHaveBeenCalled();
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

describe('the transcript after a turn', () => {
  it('keeps the reply it just streamed instead of refetching it', async () => {
    await mount();
    await sendWith([proposal({ actions: [{ op: 'delete_block', blockId: 'b' }] })]);
    await waitFor(() => expect(harness.review.pendingCount).toBe(1));

    // `done` hands back the chat and thread ids this transcript already is.
    // Fetching them replaced the live reply — tool activity, proposal chip and
    // all — with the server's plain text a second after it arrived.
    expect(listMessages).not.toHaveBeenCalled();
    expect(screen.getByText(/review in the document/i)).toBeTruthy();
  });

  it('still loads a conversation the author switches to', async () => {
    await mount();
    await sendWith([]);
    await waitFor(() => expect(streamAgentChat).toHaveBeenCalled());

    // What the Chats panel does when a conversation is picked from the list.
    await act(async () => {
      harness.chats.setSelectedChatId('another-chat');
      harness.chats.setSelectedThreadId(7);
    });

    await waitFor(() =>
      expect(listMessages).toHaveBeenCalledWith(DOC_ID, 'another-chat', 7),
    );
  });
});

describe('document-scoped streams', () => {
  it('aborts on document switch and ignores mismatched or late tool events', async () => {
    let handlers!: SSEEventHandlers;
    let signal!: AbortSignal;
    let finish!: () => void;
    streamAgentChat.mockImplementation(
      (
        _params: unknown,
        nextHandlers: SSEEventHandlers,
        options: { signal?: AbortSignal },
      ) => {
        handlers = nextHandlers;
        signal = options.signal!;
        return new Promise((resolve) => {
          finish = () => resolve({ chatId: null, threadId: null, usage: null });
        });
      },
    );

    await mount();
    await compose('keep this scoped');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });
    await waitFor(() => expect(streamAgentChat).toHaveBeenCalledTimes(1));

    // Even before navigation, an event naming another document is invalid for
    // this assistant instance.
    act(() => {
      handlers.onToolAction?.(
        proposal({
          documentId: 'another-document',
          actions: [{ op: 'delete_block', blockId: 'a' }],
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
        proposal({ actions: [{ op: 'delete_block', blockId: 'a' }] }),
      );
      handlers.onDone?.('stale-chat', 99, { promptTokens: 0, completionTokens: 0 });
      finish();
      await Promise.resolve();
    });

    expect(harness.review.pendingCount).toBe(0);
    expect(harness.chats.selectedChatId).toBeNull();
    expect(harness.chats.selectedThreadId).toBeNull();
    expect(harness.editor.blocks.map((block) => block.id)).toEqual(['a', 'b']);
  });
});

describe('the assistant window', () => {
  it('can be moved and resized from the keyboard', async () => {
    await mount();
    await compose('');

    expect(screen.getByRole('button', { name: /move assistant/i })).toBeTruthy();
    expect(screen.getByRole('separator', { name: /resize assistant/i })).toBeTruthy();
  });

  it('remembers where it was put', async () => {
    await mount();
    await compose('');

    // Persisted geometry is what makes the window worth moving at all: a
    // window that snaps back to the corner on every reload is not one.
    await waitFor(() => expect(localStorage.getItem('chat.rect')).toBeTruthy());
    expect(JSON.parse(localStorage.getItem('chat.rect') ?? '{}')).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
    });
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

    await waitFor(() => expect(harness.review.invites).toHaveLength(1));
    // Switching documents throws away whatever the author was in the middle of.
    expect(harness.editor.documentId).toBe(DOC_ID);
    expect(loadDocument).not.toHaveBeenCalledWith('created-doc');
  });
});
