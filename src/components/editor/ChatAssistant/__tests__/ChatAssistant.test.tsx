import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef, StrictMode, useImperativeHandle } from 'react';
import * as agentSessions from '@/services/agentSessionChat';
import * as chatAttachments from '@/services/chatAttachments';
import * as resources from '@/services/resources';
import { makeResource } from '@/services/__tests__/resourceFixtures';
import type { SSEEventHandlers } from '@/services/streamParser';
import type { ToolAction } from '@/editor/types';
import { PanelsContext, type PanelsContextValue } from '@/components/panels/panelsContextState';

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
  messages: [] as Array<{ role: string; content: string; attachments?: chatAttachments.ChatAttachment[]; run_id?: string }>,
  pivotThreadId: null as number | null,
}));
const listThreads = vi.fn(async () => ({ threads: [] as Array<{ id: number }> }));
type StoredChat = { chat_id: string; title: string | null; last_thread_id: number | null; updated_at: string | null };
const listChats = vi.fn(async () => ({ chats: [] as StoredChat[], count: 0, status: 'ok', message: '' }));
const updateChatTitle = vi.fn(async () => ({ status: 'ok', message: '' }));
vi.mock('@/services/chats', () => ({
  listMessages: (...args: unknown[]) => listMessages(...(args as [])),
  listThreads: (...args: unknown[]) => listThreads(...(args as [])),
  listChats: (...args: unknown[]) => listChats(...(args as [])),
  createChat: vi.fn(),
  deleteChat: vi.fn(),
  updateChatTitle: (...args: unknown[]) => updateChatTitle(...(args as [])),
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
const { ChatAssistant } = await import('../ChatAssistant');
const { TooltipProvider } = await import('@/components/ui/tooltip');
const { ConfirmContext } = await import('@/components/ui/confirmContext');
const { ToastContext } = await import('@/components/ui/toastContext');
const { forgetCaret, useRememberCaret } = await import('../../References');
const { AgentEngineContext } = await import('@/components/preferences/agentEngineContextState');
type EngineContext = import('@/components/preferences/agentEngineContextState').AgentEngineContextValue;

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
async function mount({
  strict = false,
  panels,
  engines,
}: { strict?: boolean; panels?: Partial<PanelsContextValue>; engines?: EngineContext } = {}) {
  localStorage.setItem('colwrite:lastDocId', DOC_ID);

  await renderAssistant({ strict, panels, engines });

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
  listChats.mockResolvedValue({ chats: [], count: 0, status: 'ok', message: '' });
});

afterEach(() => {
  // vitest is not running with `globals`, so RTL's auto-cleanup never fires.
  cleanup();
  localStorage.clear();
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

  afterEach(() => forgetCaret());

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

    expect(streamAgentChat).toHaveBeenCalledWith(
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

    const [params] = streamAgentChat.mock.calls[0];
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
      expect(marked?.ranges[0].toString()).toBe('changed NLP');

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
      expect(before.ranges[0].collapsed).toBe(true);

      const marked = registry.get('chat-context') as { ranges: Range[] } | undefined;
      expect(marked?.ranges[0].collapsed).toBe(false);
      expect(marked?.ranges[0].toString()).toBe('changed NLP');
      expect(block.contains(marked!.ranges[0].startContainer)).toBe(true);
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
    await sendWith([proposal({ actions: [{ op: 'delete_block', blockId: 'b' }] })]);
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

    // In the transcript, and as the chat's name until it has a stored title.
    await waitFor(() =>
      expect(screen.getAllByText('Survives the double mount')).toHaveLength(2),
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

describe('live feedback while the assistant works', () => {
  /** Send a message and hold its stream open, returning its handlers. */
  async function holdStream() {
    let handlers!: SSEEventHandlers;
    let finish!: () => void;
    streamAgentChat.mockImplementation(
      (_params: unknown, nextHandlers: SSEEventHandlers) => {
        handlers = nextHandlers;
        return new Promise((resolve) => {
          finish = () => resolve({ chatId: 'chat-1', threadId: 1, usage: null, terminal: 'done' });
        });
      },
    );
    await mount();
    await compose('what does section 2 claim?');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });
    await waitFor(() => expect(streamAgentChat).toHaveBeenCalledTimes(1));
    return {
      emit: (fn: (h: SSEEventHandlers) => void) => act(() => fn(handlers)),
      finish: async () => {
        await act(async () => {
          handlers.onDone?.('chat-1', 1, { promptTokens: 0, completionTokens: 0 });
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
    turn.emit((h) => h.onToolCallStart?.('doc_edit', 'call_e', {}));
    turn.emit((h) =>
      h.onToolCallProgress?.({ tool: 'doc_edit', toolCallId: 'call_e', argumentsChars: 2410 }),
    );
    expect(screen.getByText(new RegExp(`${(2410).toLocaleString()} characters`))).toBeTruthy();

    // Large arguments arrive as a preview only, without the full object.
    turn.emit((h) =>
      h.onToolCallArgs?.({ tool: 'doc_edit', toolCallId: 'call_e', argumentsPreview: '{"content_redacted": true}', argumentsTruncated: true }),
    );
    expect(screen.queryByText(/characters/)).toBeNull();
    // A count that trails the call's arguments is ignored.
    turn.emit((h) =>
      h.onToolCallProgress?.({ tool: 'doc_edit', toolCallId: 'call_e', argumentsChars: 2500 }),
    );
    expect(screen.queryByText(/characters/)).toBeNull();
    await turn.finish();
  });

  it('says the model went back to thinking once its tools finish', async () => {
    const turn = await holdStream();
    turn.emit((h) => h.onToolCallStart?.('web_search', 'call_1', {}));
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

    turn.emit((h) => h.onToolCallStart?.('web_search', 'call_2', {}));
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
  streamAgentChat.mockImplementation(
    async (_params: unknown, handlers: SSEEventHandlers) => {
      handlers.onToken?.(text);
      handlers.onDone?.('chat-1', 1, usage);
      return { chatId: 'chat-1', threadId: 1, usage, terminal: 'done' };
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
        actions: [{ op: 'replace_block', blockId: 'a', block: { html: '<p>edited</p>' } }],
      }),
    ]);
    await waitFor(() => expect(harness.review.pendingCount).toBe(1));

    fireEvent.click(await screen.findByRole('button', { name: 'Review 1 change' }));
    // The sheet covers the page, so it goes first; then the change is shown.
    expect(setAssistantOpen).toHaveBeenCalledWith(false);
    await waitFor(
      () => expect(harness.review.focusedChangeId).toBe(harness.review.pending[0].id),
      { timeout: 2000 },
    );
  });

  it('sends a suggestion straight away', async () => {
    await mount();
    answerWith([]);

    await act(async () => {
      screen.getByRole('button', { name: 'Find related work' }).click();
    });

    expect(streamAgentChat).toHaveBeenCalledWith(
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
      chats: [{ chat_id: 'chat-7', title: 'Outline review', last_thread_id: 7, updated_at: null }],
      count: 1,
      status: 'ok',
      message: '',
    });
    await mount();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Chats:/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Outline review' }));
    });

    await waitFor(() =>
      expect(listMessages).toHaveBeenCalledWith(DOC_ID, 'chat-7', 7, expect.anything()),
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

    expect(streamAgentChat).toHaveBeenCalledTimes(2);
    expect(streamAgentChat.mock.calls[1][0]).toMatchObject({ message: 'tighten the abstract' });
  });

  it('keeps what a finished reply cost out of the answer, in the Copy tooltip', async () => {
    await mount();
    answerText('Done.', { promptTokens: 12_400, completionTokens: 890 });
    await compose('go');
    await act(async () => {
      screen.getByRole('button', { name: /send message/i }).click();
    });

    const copy = await screen.findByRole('button', { name: 'Copy' });
    expect(screen.getByRole('button', { name: 'Insert into page' })).toBeTruthy();
    // Not a line of telemetry under the answer…
    expect(screen.queryByText(/12\.4k tokens in · 890 out/)).toBeNull();
    // …but there for whoever asks.
    fireEvent.focus(copy);
    await waitFor(() => expect(screen.getAllByText(/12\.4k tokens in · 890 out/).length).toBeGreaterThan(0));
  });

  it('stops a run on Escape', async () => {
    let signal!: AbortSignal;
    streamAgentChat.mockImplementation(
      (_params: unknown, _handlers: SSEEventHandlers, options: { signal?: AbortSignal }) => {
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
    expect(screen.queryByText(/How can I help/i)).toBeNull();
  });

  it('says so rather than greying the suggestions out', async () => {
    await mountUnsaved();
    await compose('');

    expect(screen.getByText(/Asking saves this document first/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Summarize this document/i }).hasAttribute('disabled'),
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
      screen.getByRole('region', { name: 'Writing assistant for Untitled document' }),
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

describe('agent engine', () => {
  function engineContext(overrides: Partial<EngineContext> = {}): EngineContext {
    return {
      catalog: null,
      loading: false,
      error: null,
      prefs: { chat: 'claude', inline: 'chat', models: { claude: 'sonnet' } },
      selectable: false,
      statusOf: () => null,
      engineFor: () => 'claude',
      requestFor: (surface) => (surface === 'chat' ? { engine: 'claude', model: 'sonnet' } : {}),
      setChatEngine: () => {},
      setInlineEngine: () => {},
      setModel: () => null,
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

    const [params] = streamAgentChat.mock.calls[0];
    expect(params.engine).toBe('claude');
    expect(params.model).toBe('sonnet');
    expect(params.mode).toBe('assistant');
  });

  it('sends no engine at all on the default', async () => {
    await mount();
    await sendWith([]);

    const [params] = streamAgentChat.mock.calls[0];
    expect('engine' in params).toBe(false);
    expect('model' in params).toBe(false);
  });

  it('shows a CLI sign-in problem as something to fix, not to retry', async () => {
    const engines = engineContext();
    streamAgentChat.mockImplementation(async (_params: unknown, handlers: SSEEventHandlers) => {
      handlers.onError?.(
        'ENGINE_AUTH_REQUIRED',
        'Claude Code is not signed in. Run `claude auth login` in your terminal, sign in with your own account, then check the engine again.',
      );
      return { chatId: null, threadId: null, usage: null, terminal: 'error' };
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
    streamAgentChat.mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve({ chatId: null, threadId: null, usage: null, terminal: 'done' });
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
    vi.spyOn(chatAttachments, 'loadChatImageBlob').mockRejectedValue(new Error('No preview in test'));
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
    expect(chatAttachments.uploadChatImage).toHaveBeenCalledExactlyOnceWith(file);
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(streamAgentChat).not.toHaveBeenCalled();
    const attachment: chatAttachments.ChatAttachment = { kind: 'image', image_id: 'image-1', filename: 'chart.png', media_type: 'image/png', size_bytes: 3 };
    await act(async () => finish(attachment));
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => screen.getByRole('button', { name: 'Send message' }).click());
    expect(streamAgentChat.mock.calls[0][0]).toMatchObject({ message: '', attachments: [attachment] });
    expect(screen.getByRole('link', { name: /chart.png/ }).getAttribute('href')).toContain('/chat-images/image-1/content');
    expect(screen.queryByRole('list', { name: 'Files to send' })).toBeNull();
    await act(async () => screen.getByRole('button', { name: 'Retry' }).click());
    expect(streamAgentChat.mock.calls[1][0]).toMatchObject({ message: '', attachments: [attachment] });
  });

  it.each(['upload', 'drop'])('%s saves a new PDF to the library and attaches its resource id', async (method) => {
    const resource = makeResource({ id: 23, filename: 'new-paper.pdf', extraction_status: 'pending' });
    const upload = vi.spyOn(resources, 'uploadResource').mockResolvedValue(resource);
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
    expect(upload).toHaveBeenCalledWith(file);
    expect(streamAgentChat.mock.calls[0][0].attachments).toEqual([chatAttachments.resourceAttachment(resource)]);
    expect(screen.getByRole('link', { name: 'new-paper.pdf' }).getAttribute('href')).toContain('/resources/23/content');
  });

  it('loads more library PDFs and attaches the selection without moving its folder or document', async () => {
    const first = Array.from({ length: 20 }, (_, id) => makeResource({ id: id + 1, filename: `paper-${id + 1}.pdf` }));
    const last = makeResource({ id: 42, filename: 'older-paper.pdf', collection_id: 3, collection_name: 'Saved sources' });
    const list = vi.spyOn(resources, 'listResources')
      .mockResolvedValueOnce({ resources: first, count: 20, scope: 'library', limit: 20, offset: 0 })
      .mockResolvedValueOnce({ resources: [last], count: 1, scope: 'library', limit: 20, offset: 20 });
    const move = vi.spyOn(resources, 'attachResource');
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Attach images or PDFs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose PDF from library' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load more PDFs' }));
    fireEvent.click(await screen.findByRole('button', { name: 'older-paper.pdf' }));
    expect(list).toHaveBeenLastCalledWith({ scope: 'library', limit: 20, offset: 20 });
    expect(screen.getByRole('button', { name: 'Remove older-paper.pdf' })).toBeTruthy();
    expect(move).not.toHaveBeenCalled();
  });

  it('restores attachment filenames and links from stored conversation metadata', async () => {
    listThreads.mockResolvedValue({ threads: [{ id: 4 }] });
    listMessages.mockResolvedValue({ messages: [{ role: 'user', content: 'Review this PDF', attachments: [
      { kind: 'resource', resource_id: 51, filename: 'saved-reference.pdf', media_type: 'application/pdf', size_bytes: 42 },
    ] }], pivotThreadId: 4 });
    await mount();
    await act(async () => harness.chats.setSelectedChatId('saved-attachments'));
    const link = await screen.findByRole('link', { name: 'saved-reference.pdf' });
    expect(link.getAttribute('href')).toContain('/resources/51/content');
  });
});


it('keeps an earlier image-only exchange when a different image-only run resumes before persistence', async () => {
  vi.spyOn(chatAttachments, 'loadChatImageBlob').mockRejectedValue(new Error('No preview in test'));
  listThreads.mockResolvedValue({ threads: [{ id: 4 }] });
  listMessages.mockResolvedValue({ messages: [
    { role: 'user', content: '', attachments: [{ kind: 'image', image_id: 'image-a', filename: 'first-chart.png' }] },
    { role: 'assistant', content: 'Earlier chart explanation.' },
  ], pivotThreadId: 4 });
  vi.spyOn(agentSessions, 'findActiveAgentRun').mockResolvedValue({
    session: { id: 'session-b', document_id: DOC_ID, chat_id: 'image-chat', title: 'Images', ephemeral: false, last_seq: 1, active_run_id: 'run-b' },
    run: { id: 'run-b', session_id: 'session-b', request_id: 'request-b', status: 'running', request: {
      document_id: DOC_ID, chat_id: 'image-chat', message: '', attachments: [{ kind: 'image', image_id: 'image-b' }],
    } },
  });
  streamAgentChat.mockImplementation(async (_params: unknown, handlers: SSEEventHandlers) => {
    handlers.onToken?.('Current chart explanation.');
    handlers.onDone?.('image-chat', 6, { promptTokens: 0, completionTokens: 0 });
    return { chatId: 'image-chat', threadId: 6, usage: null, terminal: 'done' };
  });
  await mount();
  await act(async () => harness.chats.setSelectedChatId('image-chat'));
  await screen.findAllByText('Current chart explanation.');
  expect(screen.getByText('Earlier chart explanation.')).toBeTruthy();
  expect(screen.getByRole('link', { name: /first-chart.png/ }).getAttribute('href')).toContain('/image-a/content');
  expect(screen.getByRole('link', { name: /Image attachment/ }).getAttribute('href')).toContain('/image-b/content');
  expect(streamAgentChat.mock.calls[0][2].resume).toEqual({ sessionId: 'session-b', runId: 'run-b' });
  vi.restoreAllMocks();
});


it('starts a fresh run after a confirmed PDF extraction timeout while retaining the attachment', async () => {
  const resource = makeResource({ id: 61, filename: 'processing.pdf' });
  vi.spyOn(resources, 'uploadResource').mockResolvedValue(resource);
  await mount();
  const file = new File(['%PDF'], 'processing.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Upload images or PDFs'), { target: { files: [file] } });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false));
  streamAgentChat.mockImplementationOnce(async (_params: unknown, handlers: SSEEventHandlers, options: { onRunStarted: (run: agentSessions.ResumeAgentRun) => void }) => {
    options.onRunStarted({ sessionId: 'session-1', runId: 'failed-run' });
    handlers.onError?.('ATTACHMENT_EXTRACTION_TIMEOUT', 'The PDF is still processing. Retry shortly.');
    return { chatId: null, threadId: null, usage: null, terminal: 'error' };
  });
  await act(async () => screen.getByRole('button', { name: 'Send message' }).click());
  await screen.findByRole('button', { name: 'Try again' });
  answerText('The PDF is ready.');
  await act(async () => screen.getByRole('button', { name: 'Try again' }).click());
  expect(streamAgentChat.mock.calls[1][2].resume).toBeUndefined();
  expect(streamAgentChat.mock.calls[1][0].attachments).toEqual([chatAttachments.resourceAttachment(resource)]);
  expect(screen.getAllByRole('link', { name: 'processing.pdf' })).toHaveLength(1);
  vi.restoreAllMocks();
});


it.each(['run-a', undefined])('preserves a completed identical upload when run identity is %s', async (oldRunId) => {
  vi.spyOn(chatAttachments, 'loadChatImageBlob').mockRejectedValue(new Error('No preview in test'));
  listThreads.mockResolvedValue({ threads: [{ id: 4 }] });
  listMessages.mockResolvedValue({ messages: [
    { role: 'user', content: '', run_id: oldRunId, attachments: [{ kind: 'resource', resource_id: 7, filename: 'same-paper.pdf' }] },
    { role: 'assistant', content: 'Earlier paper explanation.' },
  ], pivotThreadId: 4 });
  vi.spyOn(agentSessions, 'findActiveAgentRun').mockResolvedValue({
    session: { id: 'session-b', document_id: DOC_ID, chat_id: 'same-file-chat', title: 'PDFs', ephemeral: false, last_seq: 1, active_run_id: 'run-b' },
    run: { id: 'run-b', session_id: 'session-b', request_id: 'request-b', status: 'queued', request: {
      document_id: DOC_ID, chat_id: 'same-file-chat', message: '', attachments: [{ kind: 'resource', resource_id: 7 }],
    } },
  });
  streamAgentChat.mockImplementation(async (_params: unknown, handlers: SSEEventHandlers) => {
    handlers.onToken?.('Current paper explanation.');
    handlers.onDone?.('same-file-chat', 6, { promptTokens: 0, completionTokens: 0 });
    return { chatId: 'same-file-chat', threadId: 6, usage: null, terminal: 'done' };
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
  listThreads.mockResolvedValue({ threads: [{ id: 4 }] });
  const attachment: chatAttachments.ChatAttachment = { kind: 'resource', resource_id: 7, filename: 'same-paper.pdf' };
  listMessages.mockResolvedValue({ messages: [
    { role: 'user', content: '', run_id: 'run-b', attachments: [attachment] },
    { role: 'assistant', content: 'An incomplete saved answer.' },
  ], pivotThreadId: 4 });
  vi.spyOn(agentSessions, 'findActiveAgentRun').mockResolvedValue({
    session: { id: 'session-b', document_id: DOC_ID, chat_id: 'same-file-chat', title: 'PDFs', ephemeral: false, last_seq: 1, active_run_id: 'run-b' },
    run: { id: 'run-b', session_id: 'session-b', request_id: 'request-b', status: 'running', request: {
      document_id: DOC_ID, chat_id: 'same-file-chat', message: '', attachments: [{ kind: 'resource', resource_id: 7 }],
    } },
  });
  streamAgentChat.mockImplementationOnce(async () => ({ chatId: 'same-file-chat', threadId: null, usage: null, terminal: null }));
  await mount();
  await act(async () => harness.chats.setSelectedChatId('same-file-chat'));
  await screen.findByRole('button', { name: 'Try again' });
  expect(screen.queryByText('An incomplete saved answer.')).toBeNull();
  expect(screen.getAllByRole('list', { name: 'Message attachments' })).toHaveLength(1);
  answerText('The restored answer.');
  await act(async () => screen.getByRole('button', { name: 'Try again' }).click());
  expect(streamAgentChat.mock.calls[1][2].resume).toEqual({ sessionId: 'session-b', runId: 'run-b' });
  expect(streamAgentChat.mock.calls[1][0].attachments).toEqual([attachment]);
  expect(screen.getAllByRole('link', { name: 'same-paper.pdf' })).toHaveLength(1);
  vi.restoreAllMocks();
});
