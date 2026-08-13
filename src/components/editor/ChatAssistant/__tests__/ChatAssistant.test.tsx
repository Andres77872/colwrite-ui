import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef, StrictMode, useImperativeHandle } from 'react';
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
// Widened past what the empty defaults infer, so a test can answer with rows.
const listMessages = vi.fn(async () => ({
  messages: [] as Array<{ role: string; content: string }>,
  pivotThreadId: null as number | null,
}));
const listThreads = vi.fn(async () => ({ threads: [] as Array<{ id: number }> }));
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
async function mount({ strict = false }: { strict?: boolean } = {}) {
  localStorage.setItem('colwrite:lastDocId', DOC_ID);

  await renderAssistant({ strict });

  // The provider probes for remote documents and hydrates from the server.
  await waitFor(() => expect(listDocuments).toHaveBeenCalled());
  await waitFor(() => expect(harness.editor.blocks).toHaveLength(2));
}

/** Renders the assistant against a draft that exists only in this browser. */
async function mountUnsaved() {
  await renderAssistant();
  await waitFor(() => expect(listDocuments).toHaveBeenCalled());
  expect(harness.editor.documentId).toBeNull();
}

async function renderAssistant({ strict = false }: { strict?: boolean } = {}) {
  const tree = (
    <EditorProvider>
      <ProposalsProvider>
        <Capture />
        <ChatSessionsProvider>
          <CaptureChats />
          <PanelsProvider>
            <main>
              <ChatAssistant />
            </main>
          </PanelsProvider>
        </ChatSessionsProvider>
      </ProposalsProvider>
    </EditorProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  await act(async () => {});
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

let desktopViewport = true;
const mediaListeners = new Set<() => void>();

function setDesktopViewport(desktop: boolean) {
  desktopViewport = desktop;
  mediaListeners.forEach((listener) => listener());
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  desktopViewport = true;
  mediaListeners.clear();
  listDocuments.mockResolvedValue({ documents: [{}], count: 1, status: 'ok', message: '' });

  // jsdom ships no `matchMedia`, so every media query reads as false and the
  // assistant renders its small-screen layout — the one without a window to
  // move. Answer width queries the way a desktop would.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width/.test(query) && desktopViewport,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
    addListener: (listener: () => void) => mediaListeners.add(listener),
    removeListener: (listener: () => void) => mediaListeners.delete(listener),
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  // vitest is not running with `globals`, so RTL's auto-cleanup never fires.
  cleanup();
  localStorage.clear();
  mediaListeners.clear();
  vi.unstubAllGlobals();
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
    // An accept from the review bar can land far off screen, so the block it
    // changed is highlighted. That list is what `applyPatch` reports back, and
    // reading it out of a `setState` updater left it empty.
    expect([...harness.editor.recentlyChanged]).toEqual(['a']);
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
      // The trailing transport carries the signal that cancels this read on a
      // document switch, and the api layer's backoff sleep with it.
      expect(listMessages).toHaveBeenCalledWith(
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
    listThreads.mockResolvedValue({ threads: [{ id: 4 }] });
    listMessages.mockResolvedValue({
      messages: [{ role: 'user', content: 'Survives the double mount' }],
      pivotThreadId: 4,
    });

    await mount({ strict: true });
    await act(async () => {
      harness.chats.setSelectedChatId('strict-chat');
    });

    await waitFor(() =>
      expect(screen.getByText('Survives the double mount')).toBeTruthy(),
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

  it('does not restore a desktop-open assistant over the mobile canvas', async () => {
    setDesktopViewport(false);
    localStorage.setItem('chat.expanded', 'true');

    await mount();

    expect(screen.getByRole('button', { name: /^assistant$/i })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: /writing assistant/i })).toBeNull();
  });

  it('closes an open floating window when the layout becomes mobile', async () => {
    await mount();
    await compose('');
    expect(screen.getByRole('complementary', { name: /writing assistant/i })).toBeTruthy();

    await act(async () => setDesktopViewport(false));

    expect(screen.getByRole('button', { name: /^assistant$/i })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: /writing assistant/i })).toBeNull();
  });

  it('uses a modal, focus-contained sheet when explicitly opened on mobile', async () => {
    setDesktopViewport(false);
    await mount();
    await compose('');

    const dialog = screen.getByRole('dialog', { name: 'Writing assistant for Doc' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.queryByRole('complementary', { name: /writing assistant/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /maximise assistant/i })).toBeNull();

    const outside = document.createElement('button');
    outside.textContent = 'Editor action';
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.focusIn(outside);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    outside.remove();

    fireEvent.click(screen.getByRole('button', { name: /hide assistant/i }));
    const trigger = await screen.findByRole('button', { name: /^assistant$/i });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('makes the maximised desktop assistant modal, then restores floating controls', async () => {
    await mount();
    await compose('');

    await act(async () => {
      screen.getByRole('button', { name: /maximise assistant/i }).click();
    });

    const dialog = screen.getByRole('dialog', { name: 'Writing assistant for Doc' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.queryByRole('complementary', { name: /writing assistant/i })).toBeNull();

    await act(async () => {
      screen.getByRole('button', { name: /restore assistant size/i }).click();
    });

    expect(screen.getByRole('complementary', { name: /writing assistant/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /move assistant/i })).toBeTruthy();
    expect(screen.getByRole('separator', { name: /resize assistant/i })).toBeTruthy();
  });

  it('fits default geometry to the canvas edge instead of the docked tools area', async () => {
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
    await mount();
    await compose('');

    const main = document.querySelector('main');
    if (!main) throw new Error('Expected the editor canvas');
    vi.spyOn(main, 'getBoundingClientRect').mockReturnValue({ right: 700 } as DOMRect);

    await act(async () => window.dispatchEvent(new Event('resize')));

    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: /writing assistant/i }).style.right).toBe(
        '312px',
      );
    });
  });
});

describe('a document the assistant created', () => {
  it('is offered rather than opened behind the author’s back', async () => {
    await mount();
    await sendWith([
      proposal({
        tool: 'doc_create',
        // `doc_create` names the document it has just made, never the one on
        // screen. Matching that against the open document dropped the event,
        // and creating a document looked to the author like nothing happening.
        documentId: 'created-doc',
        actions: [{ op: 'create_document', documentId: 'created-doc' }],
      }),
    ]);

    await waitFor(() => expect(harness.review.invites).toHaveLength(1));
    expect(harness.review.invites[0].documentId).toBe('created-doc');
    // Switching documents throws away whatever the author was in the middle of.
    expect(harness.editor.documentId).toBe(DOC_ID);
    expect(loadDocument).not.toHaveBeenCalledWith('created-doc');
  });

  it('brings none of that document’s edits into this one', async () => {
    await mount();
    await sendWith([
      proposal({
        tool: 'doc_create',
        documentId: 'created-doc',
        actions: [
          { op: 'create_document', documentId: 'created-doc' },
          // Operations addressed to the new document. They are about blocks
          // this document has never heard of, so they belong there, not here.
          { op: 'delete_block', blockId: 'a' },
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
    expect(streamAgentChat).toHaveBeenCalledWith(
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
    expect(harness.chats.selectedThreadId).toBe(1);
    // The empty state is gone, so the transcript survived the attach.
    expect(screen.queryByText(/Ask about/i)).toBeNull();
  });

  it('says so rather than greying the suggestions out', async () => {
    await mountUnsaved();
    await compose('');

    expect(screen.getByText(/Asking saves this document first/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Summarise this document/i }).hasAttribute('disabled'),
    ).toBe(false);
  });
});

describe('the document a session is attached to', () => {
  it('is named in the header, so “nothing happened” can be told from “that happened elsewhere”', async () => {
    await mount();
    await compose('');

    expect(screen.getByTitle(/This conversation is kept with “Doc”/)).toBeTruthy();
    expect(screen.getByText(/Ask about/)).toBeTruthy();
  });

  it('reaches a screen reader through the region label', async () => {
    await mount();
    await compose('');

    // The header line is small, muted and not focusable, so on its own it would
    // only be found by reading the whole panel.
    expect(
      screen.getByRole('complementary', { name: 'Writing assistant for Doc' }),
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
        screen.getByRole('complementary', { name: 'Writing assistant for Attention Is All You Need' }),
      ).toBeTruthy(),
    );
    expect(screen.getByTitle(/kept with “Attention Is All You Need”/)).toBeTruthy();
  });

  it('says nothing is attached yet rather than naming a document it cannot act on', async () => {
    await mountUnsaved();
    await compose('');

    expect(screen.getByText('Not saved yet')).toBeTruthy();
    expect(
      screen.getByRole('complementary', {
        name: 'Writing assistant for a document that has not been saved yet',
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
      screen.getByRole('complementary', { name: 'Writing assistant for Untitled document' }),
    ).toBeTruthy();
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
      streamAgentChat.mock.invocationCallOrder[0],
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
    expect(streamAgentChat).not.toHaveBeenCalled();
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
    streamAgentChat.mockImplementation(
      async (_params: unknown, handlers: SSEEventHandlers) => {
        attempt += 1;
        if (attempt === 1) {
          handlers.onError?.('CHAT_NOT_FOUND', 'Chat not found for this document.');
          return { chatId: null, threadId: null, usage: null };
        }
        handlers.onDone?.('fresh-chat', 4, { promptTokens: 0, completionTokens: 0 });
        return { chatId: 'fresh-chat', threadId: 4, usage: null };
      },
    );

    await compose('carry on');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });

    await waitFor(() => expect(streamAgentChat).toHaveBeenCalledTimes(2));
    expect(streamAgentChat.mock.calls[1][0]).toMatchObject({
      document_id: DOC_ID,
      chat_id: null,
      thread_id: null,
    });
    await waitFor(() => expect(harness.chats.selectedChatId).toBe('fresh-chat'));
    // Recovered without ever showing the author an error it had already fixed.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports the failure when the retry fails too', async () => {
    await mount();

    streamAgentChat.mockImplementation(
      async (_params: unknown, handlers: SSEEventHandlers) => {
        handlers.onError?.('CHAT_NOT_FOUND', 'Chat not found for this document.');
        return { chatId: null, threadId: null, usage: null };
      },
    );

    await compose('carry on');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });

    await waitFor(() => expect(streamAgentChat).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Chat not found'),
    );
  });
});
