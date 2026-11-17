import { agentSource } from '@/__tests__/agentSource';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import type { AiBeatChild, Block, Doc, ParagraphBlock } from '@/editor/types';
import type { AgentChatOptions } from '@/api/assistant/agentChat';
import type { AgentEventHandlers } from '@/api/assistant/streamParser';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { contentOf, fixtures, wireBlock } from '@/dev/msw/fixtures';
import { jsonOf, recordRequests } from '@/__tests__/server';

const runAgentTurn = vi.fn();
vi.mock('@/api/assistant/agentChat', () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurn(...args),
}));

const { EditorProvider } = await import('@/editor');
const { useEditorProbe } = await import('@/editor/__tests__/editorHarness');
const { AiBeatInline } = await import('../AiBeatInline/AiBeatInline');

type Probe = ReturnType<typeof useEditorProbe>;
const probeRef = createRef<Probe>();
const probe = (): Probe => {
  if (!probeRef.current) throw new Error('not mounted');
  return probeRef.current;
};
const paragraph = (): ParagraphBlock => {
  const block = probe().blocks.find((candidate) => candidate.id === 'p1');
  if (block?.type !== 'paragraph') throw new Error('no paragraph');
  return block;
};

/**
 * The widget against the real editor: it reads the page's session (to save
 * before a run) and writes its child back into the document, so a harness
 * holding the child itself would test something the editor never does.
 */
function Host() {
  const editor = useEditorProbe();
  useImperativeHandle(probeRef, () => editor, [editor]);
  const block = editor.blocks.find((candidate) => candidate.id === 'p1');
  const child = block?.type === 'paragraph' ? block.children?.find((candidate) => candidate.type === 'aiBeat') : undefined;
  if (!child) return null;
  return (
    <AiBeatInline
      blockId="p1"
      child={child}
      updateParagraphChild={editor.updateParagraphChild}
      removeParagraphChild={editor.removeParagraphChild}
      updateHtml={editor.updateHtml}
      refs={editor.refs}
    />
  );
}

const PLACEHOLDER = '<span data-child-id="child-1" contenteditable="false"></span>';
let host: HTMLDivElement;

async function mount(initial: Partial<AiBeatChild> = {}, html = PLACEHOLDER) {
  const beat: AiBeatChild = { id: 'child-1', type: 'aiBeat', message: '', prompt: '', output: null, collapsed: false, ...initial };
  const doc: Doc = { name: 'Doc', blocks: [{ id: 'p1', type: 'paragraph', html, children: [beat], columns: 1 } as Block] };
  fixtures.documents.set('doc-1', {
    _id: 'doc-1', workspace_id: TEST_WORKSPACE_ID, collection_id: null, sort_key: 'V', placement_seq: 1,
    name: 'Doc', head_seq: 1, tags: [], blocks: doc.blocks.map((block) => wireBlock({ ...block })),
    created_at: '2026-11-16T12:00:00Z', updated_at: '2026-11-16T12:00:00Z', deleted_at: null,
  });
  return mountSaved(html);
}

async function mountSaved(html = PLACEHOLDER) {
  // The workspace's last page opens: the provider reads it from the server.
  localStorage.setItem(`colwrite:ws:${TEST_WORKSPACE_ID}:lastDocId`, 'doc-1');
  const utils = render(
    <EditorProvider>
      <Host />
    </EditorProvider>,
  );
  await waitFor(() => expect(probe().documentId).toBe('doc-1'));
  await waitFor(() => expect(probe().loadingDocumentId).toBeNull());
  await waitFor(() => expect(paragraph().children).toHaveLength(1));
  await waitFor(() => expect(screen.getByRole('group', { name: 'AI passage' })).toBeTruthy());
  // The paragraph's editable, as the canvas would render it.
  host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  act(() => probe().registerEditable('p1', host));
  return utils;
}

const messageField = () => screen.getByPlaceholderText<HTMLTextAreaElement>('What do you want to generate?');
const promptField = () => screen.getByPlaceholderText<HTMLInputElement>('You are a helpful assistant');
const generateButton = () => screen.getByRole('button', { name: /^(Generate|Regenerate)$/ });
const done = { done: null, terminal: 'done' as const };

async function generate() {
  await act(async () => {
    generateButton().click();
  });
}

beforeEach(() => {
  localStorage.clear();
  mockDocumentList();
  runAgentTurn.mockReset();
});
afterEach(async () => {
  if (probeRef.current) await act(async () => { await probe().flushPendingSave(); });
  cleanup();
  host?.remove();
  vi.restoreAllMocks();
});

describe('AiBeatInline', () => {
  it('renders its stored message and prompt', async () => {
    await mount({ message: 'hello', prompt: 'world' });

    expect(messageField().value).toBe('hello');
    expect(promptField().value).toBe('world');
  });

  it('writes edits straight to the document', async () => {
    await mount();
    fireEvent.change(messageField(), { target: { value: 'summarise this' } });

    expect(messageField().value).toBe('summarise this');
    expect(paragraph().children?.[0]).toMatchObject({ message: 'summarise this' });
  });

  it('blocks generation past the message length limit', async () => {
    await mount({ message: 'x' });
    fireEvent.change(messageField(), { target: { value: 'a'.repeat(2001) } });

    expect(screen.getByText(/Message must be.*2000 characters/)).toBeTruthy();
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('blocks generation past the prompt length limit, and re-enables it once back under', async () => {
    await mount({ message: 'ok' });
    fireEvent.change(promptField(), { target: { value: 'b'.repeat(2001) } });
    expect(screen.getByText(/Prompt must be.*2000 characters/)).toBeTruthy();
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(promptField(), { target: { value: 'short prompt' } });
    expect(screen.queryByText(/Prompt must be.*2000 characters/)).toBeNull();
    expect((generateButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('will not generate from an empty message', async () => {
    await mount();
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('runs as a one-shot rewrite about its paragraph, which the server reads itself', async () => {
    runAgentTurn.mockResolvedValue(done);
    await mount({ message: 'write an abstract', prompt: 'formal' }, `Lead-in text. ${PLACEHOLDER}`);
    await generate();

    await waitFor(() => expect({ calls: runAgentTurn.mock.calls.length, saveError: probe().saveError }).toEqual({ calls: 1, saveError: null }));
    const [params] = runAgentTurn.mock.calls[0] as [{ message: string; context: unknown }];
    // The agent gets no document tools: the author places the text.
    expect(params).toMatchObject({ profile: 'inline', document_id: 'doc-1', context: { block_id: 'p1' } });
    expect(params.message).toContain('Task: write an abstract');
    expect(params.message).toContain('Style: formal');
    expect(params.message).not.toContain('Lead-in text.');
  });

  it('saves pending edits before the run, so the server reads what is on screen', async () => {
    let seen: unknown;
    runAgentTurn.mockImplementation(async () => {
      seen = fixtures.documents.get('doc-1')?.blocks;
      return done;
    });
    await mount({ message: 'write' });
    fireEvent.change(messageField(), { target: { value: 'write more' } });
    await generate();

    await waitFor(() => expect(runAgentTurn).toHaveBeenCalled());
    expect(seen).toMatchObject([{ children: [{ message: 'write more' }] }]);
  });

  it('streams tokens into the output and keeps them', async () => {
    runAgentTurn.mockImplementation(async (_params: unknown, handlers: AgentEventHandlers) => {
      handlers.onToken?.('Hello ');
      handlers.onToken?.('world');
      return done;
    });
    await mount({ message: 'write' });
    await generate();

    await waitFor(() => expect(screen.getByText('Hello world')).toBeTruthy());
    expect(paragraph().children?.[0]).toMatchObject({ output: { text: 'Hello world', sources: [] } });
  });

  it('shows its output as the blocks it will become, not as markdown source', async () => {
    runAgentTurn.mockImplementation(async (_params: unknown, handlers: AgentEventHandlers) => {
      handlers.onToken?.('- **First** point\n- Second point');
      return done;
    });
    await mount({ message: 'write' });
    await generate();

    await waitFor(() => expect(screen.getByText('Second point')).toBeTruthy());
    expect(screen.queryByText(/\*\*First\*\*/)).toBeNull();
    expect(screen.getByText('First').tagName).toBe('STRONG');
  });

  it('surfaces a failure instead of silently doing nothing', async () => {
    runAgentTurn.mockRejectedValue(new Error('Model unavailable'));
    await mount({ message: 'write' });
    await generate();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('The assistant connection was interrupted'));
  });

  it('says so when the stream closed before finishing', async () => {
    runAgentTurn.mockImplementation(async (_params: unknown, handlers: AgentEventHandlers) => {
      handlers.onToken?.('Half a sent');
      return { ...done, terminal: null };
    });
    await mount({ message: 'write' });
    await generate();

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('may be incomplete'));
  });

  it('says what the engine is doing while nothing has been written', async () => {
    let handlers!: AgentEventHandlers;
    let finish!: () => void;
    runAgentTurn.mockImplementation((_params: unknown, next: AgentEventHandlers) => {
      handlers = next;
      return new Promise((resolve) => {
        finish = () => resolve(done);
      });
    });
    await mount({ message: 'write' });
    await generate();
    await waitFor(() => expect(runAgentTurn).toHaveBeenCalled());

    expect(screen.getByRole('status').textContent).toContain('Thinking…');
    act(() => handlers.onStatus?.('starting', 'Starting Claude Code…'));
    expect(screen.getByRole('status').textContent).toContain('Starting Claude Code…');
    // Rendered inside inline markup, where a paragraph may not nest.
    expect(screen.getByRole('status').tagName).toBe('SPAN');

    await act(async () => {
      handlers.onToken?.('Draft.');
      finish();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('announces the end once, not every token', async () => {
    let handlers!: AgentEventHandlers;
    let finish!: () => void;
    runAgentTurn.mockImplementation((_params: unknown, next: AgentEventHandlers) => {
      handlers = next;
      return new Promise((resolve) => {
        finish = () => resolve(done);
      });
    });
    await mount({ message: 'write' });
    await generate();
    await waitFor(() => expect(runAgentTurn).toHaveBeenCalled());
    act(() => handlers.onToken?.('Some words'));

    const live = document.querySelector('.ai-beat-widget [aria-live="polite"]');
    expect(live?.textContent).toBe('');
    // The output itself is no live region.
    expect(screen.getByText('Some words').closest('[aria-live]')).toBeNull();
    await act(async () => finish());
    expect(live?.textContent).toBe('The AI passage is ready.');
  });

  it('stops its run when the widget goes away, and writes nothing to the page', async () => {
    let options: AgentChatOptions | undefined;
    let handlers!: AgentEventHandlers;
    let finish!: () => void;
    runAgentTurn.mockImplementation((_params: unknown, next: AgentEventHandlers, opts?: AgentChatOptions) => {
      handlers = next;
      options = opts;
      return new Promise((resolve) => {
        finish = () => resolve(done);
      });
    });
    const { unmount } = await mount({ message: 'write' });
    await generate();
    await waitFor(() => expect(runAgentTurn).toHaveBeenCalled());

    unmount();
    expect(options?.signal?.aborted).toBe(true);
    // A one-shot run is cancelled, not left running on the server.
    expect(options?.abortBehavior).toBe('cancel');
    handlers.onToken?.('Too late');
    await act(async () => finish());
  });

  it('replaces itself with the text when inserted, in one undo step', async () => {
    await mount({ message: 'x', output: { text: 'Generated prose.', sources: [] } }, `Before ${PLACEHOLDER}`);

    await act(async () => {
      screen.getByRole('button', { name: /insert into text/i }).click();
    });

    // Accepting used to leave the panel behind next to the text it produced.
    expect(host.querySelector('[data-child-id="child-1"]')).toBeNull();
    expect(host.textContent).toBe('Before Generated prose.');
    expect(paragraph().children).toEqual([]);
    expect(paragraph().html).toContain('Generated prose.');

    act(() => probe().undo());
    expect(paragraph().children).toHaveLength(1);
  });

  it('inserts structured output as blocks, in place of a paragraph that held only the widget', async () => {
    await mount({ message: 'x', output: { text: '## Results\n\nThe first finding.', sources: [] } });

    await act(async () => {
      screen.getByRole('button', { name: /insert into text/i }).click();
    });

    const blocks = probe().blocks;
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph']);
    expect(blocks.some((block) => block.id === 'p1')).toBe(false);
  });

  it('cites a source the run returned when its output is inserted, once however often the source arrived', async () => {
    const source = agentSource('S1', { key: 'doi:10.1000/xyz', title: 'A Study', provider: 'semantic_scholar' });
    runAgentTurn.mockImplementation(async (_params: unknown, handlers: AgentEventHandlers) => {
      handlers.onEvidence?.({ sources: [source], passages: [] });
      handlers.onEvidence?.({ sources: [source], passages: [] });
      handlers.onToken?.('Supported [S1].');
      return done;
    });
    await mount({ message: 'write' }, `Lead ${PLACEHOLDER}`);
    await generate();
    await waitFor(() => expect(paragraph().children?.[0]).toMatchObject({ output: { text: 'Supported [@doi:10.1000/xyz].', sources: [source.record] } }));

    await act(async () => {
      screen.getByRole('button', { name: /insert into text/i }).click();
    });

    expect(paragraph().children).toEqual([
      expect.objectContaining({ type: 'citation', keys: ['doi:10.1000/xyz'], sources: [source.record] }),
    ]);
    expect(paragraph().html).not.toContain('[S1]');
    expect(probe().doc.sources).toEqual([source.record]);
  });

  it('keeps citations through save/read, unmount and reload without a live run', async () => {
    const source = agentSource('S4', { key: 'doi:10.1000/durable', title: 'Durable evidence', state: 'verified', year: 2026 });
    runAgentTurn.mockImplementation(async (_params: unknown, handlers: AgentEventHandlers) => {
      handlers.onEvidence?.({ sources: [source], passages: [] });
      handlers.onToken?.('Supported [S4]; unknown [S9].');
      return done;
    });
    const sent = recordRequests();
    const first = await mount({ message: 'write' });
    await generate();
    await waitFor(() => expect(paragraph().children?.[0]).toMatchObject({
      output: { text: 'Supported [@doi:10.1000/durable]; unknown [S9].', sources: [source.record] },
    }));
    await act(async () => { await probe().flushPendingSave(); });
    const save = sent.filter((request) => request.method === 'PUT' && new URL(request.url).pathname.endsWith('/documents/doc-1')).at(-1);
    expect(save).toBeDefined();
    expect(await jsonOf(save)).toMatchObject({ content: { blocks: [{ children: [{ output: {
      text: 'Supported [@doi:10.1000/durable]; unknown [S9].', sources: [source.record],
    } }] }] } });
    first.unmount();
    first.queryClient.clear();
    host.remove();
    runAgentTurn.mockReset();

    await mountSaved();
    expect(runAgentTurn).not.toHaveBeenCalled();
    const mark = screen.getByLabelText('Citation: 2026 — Durable evidence');
    expect(mark.textContent).toBe('[1]');
    expect(screen.queryByText(/@doi:/)).toBeNull();
    expect(screen.getByText(/unknown \[S9\]/)).toBeTruthy();
    await act(async () => { screen.getByRole('button', { name: /insert into text/i }).click(); });
    expect(paragraph().children).toMatchObject([{ type: 'citation', keys: [source.key], sources: [source.record] }]);
    expect(probe().doc.sources).toEqual([source.record]);
    await act(async () => { await probe().flushPendingSave(); });
    const page = fixtures.documents.get('doc-1');
    expect(page && contentOf(page)).toMatchObject({ sources: [source.record] });
  });

  it.each(['stopped', 'failed'] as const)('retains partial cited output when the run is %s', async (ending) => {
    const source = agentSource('S1', { key: 'doi:10.1000/partial', title: 'Partial evidence' });
    let handlers!: AgentEventHandlers;
    let finish!: () => void;
    runAgentTurn.mockImplementation((_params: unknown, next: AgentEventHandlers, options: AgentChatOptions) => {
      handlers = next;
      return new Promise((_resolve, reject) => {
        finish = () => reject(new Error('Connection closed'));
        options.signal?.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
      });
    });
    await mount({ message: 'write' });
    await generate();
    await waitFor(() => expect(runAgentTurn).toHaveBeenCalled());
    act(() => {
      handlers.onEvidence?.({ sources: [source], passages: [] });
      handlers.onToken?.('Partial [S1]');
    });
    await act(async () => {
      if (ending === 'stopped') screen.getByRole('button', { name: /stop/i }).click();
      else finish();
    });
    await waitFor(() => expect(paragraph().children?.[0]).toMatchObject({
      output: { text: 'Partial [@doi:10.1000/partial]', sources: [source.record] },
    }));
  });

  it('clears the complete output, including its references, to null', async () => {
    const source = agentSource('S1', { key: 'doi:10.1000/clear', title: 'Clear me' });
    await mount({ output: { text: 'Draft [@doi:10.1000/clear]', sources: [source.record] } });
    await act(async () => { screen.getByRole('button', { name: /^Clear$/ }).click(); });
    expect(paragraph().children?.[0]).toMatchObject({ output: null });
  });
});
