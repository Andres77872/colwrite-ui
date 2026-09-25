import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, useImperativeHandle, useLayoutEffect } from 'react';
import type { Doc, ParagraphBlock as ParagraphBlockType } from '@/editor/types';
import { ASK_AI_EVENT, type AskAiRequest } from '../AskAi/askAiEvents';
import { PanelsContext, type PanelsContextValue } from '@/components/panels/panelsContextState';

vi.mock('@/services', () => ({
  createDocument: vi.fn(async () => ({ document_id: 'created-doc', version: 1 })),
  saveDocument: vi.fn(async () => ({ status: 'ok', message: '', version: 2 })),
  loadDocument: vi.fn(async () => ({ version: 1, blocks: [], name: 'Doc' })),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: vi.fn(async () => ({ documents: [], count: 0, status: 'ok', message: '' })),
}));

const { EditorProvider, useEditor } = await import('@/editor');
const { Editable } = await import('@/components/common/Editable');
const { FloatingToolbar } = await import('./FloatingToolbar');

const TEST_RECT = {
  x: 80,
  y: 100,
  top: 100,
  right: 140,
  bottom: 118,
  left: 80,
  width: 60,
  height: 18,
  toJSON: () => ({}),
} as DOMRect;

const originalGetBoundingClientRect = Range.prototype.getBoundingClientRect;

beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => TEST_RECT,
  });
});

afterAll(() => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: originalGetBoundingClientRect,
  });
});

const editorRef = createRef<ReturnType<typeof useEditor>>();
let committedDocs: Doc[] = [];

function Harness() {
  const editor = useEditor();
  useImperativeHandle(editorRef, () => editor, [editor]);

  // A layout effect observes every committed provider state, including any
  // transient state that a passive persistence effect could otherwise hide.
  useLayoutEffect(() => {
    committedDocs.push(JSON.parse(JSON.stringify(editor.doc)) as Doc);
  }, [editor.doc]);

  const block = editor.blocks.find((candidate) => candidate.id === 'p1');
  if (!block || (block.type !== 'paragraph' && block.type !== 'heading')) return null;
  return (
    <>
      <Editable id={block.id} html={block.html} />
      <FloatingToolbar />
    </>
  );
}

async function mountEditor(panels?: Partial<PanelsContextValue>, html = 'Evidence claim') {
  const doc: Doc = {
    version: 1,
    name: 'Floating toolbar test',
    blocks: [
      {
        id: 'p1',
        type: 'paragraph',
        html,
        children: [],
        columns: 1,
      },
    ],
  };
  localStorage.setItem('colwrite:doc:local', JSON.stringify({ documentId: null, doc }));

  const editor = (
    <EditorProvider>
      <Harness />
    </EditorProvider>
  );
  const result = render(
    panels ? (
      <PanelsContext.Provider value={panels as PanelsContextValue}>{editor}</PanelsContext.Provider>
    ) : (
      editor
    ),
  );
  await act(async () => {});

  const editable = result.container.querySelector<HTMLDivElement>('.editable');
  if (!editable) throw new Error('Paragraph editable did not mount');
  return { ...result, editable };
}

function selectText(editable: HTMLDivElement, start: number, end: number): void {
  const text = editable.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) {
    throw new Error('Expected a text node in the paragraph');
  }
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  const selection = document.getSelection();
  if (!selection) throw new Error('Selection is unavailable');
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

function paragraph(doc: Doc): ParagraphBlockType {
  const block = doc.blocks.find((candidate) => candidate.id === 'p1');
  if (!block || block.type !== 'paragraph') throw new Error('Paragraph is missing');
  return block;
}

beforeEach(() => {
  localStorage.clear();
  committedDocs = [];
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
});

describe('FloatingToolbar keyboard operation', () => {
  it('applies formatting from click, which is the event Enter and Space produce', async () => {
    const { editable } = await mountEditor();
    // jsdom does not implement execCommand at all, so it has to be installed
    // before it can be observed.
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });

    act(() => {
      editable.focus();
      selectText(editable, 0, 'Evidence'.length);
    });

    const bold = await screen.findByRole('button', { name: /^Bold/ });
    // Not `mouseDown`: the format buttons used to carry their action there, so
    // a keyboard user could select text and never apply a style to it.
    fireEvent.click(bold);

    // The third argument is the command value, which `bold` does not take.
    expect(exec).toHaveBeenCalledWith('bold', false, undefined);
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('keeps the toolbar open while focus is on one of its buttons', async () => {
    const { editable } = await mountEditor();

    act(() => {
      editable.focus();
      selectText(editable, 0, 'Evidence'.length);
    });

    const bold = await screen.findByRole('button', { name: /^Bold/ });
    act(() => {
      bold.focus();
      // Moving focus off the text greys the selection out, which used to
      // dismiss the toolbar the instant a keyboard user reached it.
      document.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });

    expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeTruthy();
  });

  it('Escape closes the toolbar and returns focus to the saved selection', async () => {
    const { editable } = await mountEditor();

    act(() => {
      editable.focus();
      selectText(editable, 0, 'Evidence'.length);
    });

    const bold = await screen.findByRole('button', { name: /^Bold/ });
    act(() => {
      bold.focus();
    });

    fireEvent.keyDown(screen.getByRole('toolbar', { name: 'Text formatting' }), { key: 'Escape' });

    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(document.activeElement).toBe(editable);
    expect(document.getSelection()?.toString()).toBe('Evidence');

    // Restoring the selection fired selectionchange; the toolbar must stay
    // hidden for that same selection rather than reopening in the same gesture.
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(screen.queryByRole('toolbar')).toBeNull();

    // A fresh selection is a new intent and gets the toolbar back.
    act(() => {
      document.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });
    act(() => {
      selectText(editable, 0, 'Evidence'.length);
    });
    expect(await screen.findByRole('toolbar', { name: 'Text formatting' })).toBeTruthy();
  });
});

describe('FloatingToolbar actions', () => {
  it('leads with Ask AI and hands the selection to the prompt', async () => {
    const { editable } = await mountEditor();
    const requests: AskAiRequest[] = [];
    const listen = (event: Event) => requests.push((event as CustomEvent<AskAiRequest>).detail);
    window.addEventListener(ASK_AI_EVENT, listen);

    act(() => {
      editable.focus();
      selectText(editable, 0, 'Evidence'.length);
    });
    const toolbar = await screen.findByRole('toolbar', { name: 'Text formatting' });
    const first = toolbar.querySelector('[data-toolbar-item]');
    expect(first?.getAttribute('aria-label')).toMatch(/^Ask AI/);

    fireEvent.click(first as HTMLElement);
    expect(requests).toEqual([{ blockId: 'p1', actionId: undefined }]);
    expect(screen.queryByRole('toolbar')).toBeNull();
    window.removeEventListener(ASK_AI_EVENT, listen);
  });

  it('runs a preset from the more-AI menu through the same prompt', async () => {
    const { editable } = await mountEditor();
    const requests: AskAiRequest[] = [];
    const listen = (event: Event) => requests.push((event as CustomEvent<AskAiRequest>).detail);
    window.addEventListener(ASK_AI_EVENT, listen);

    act(() => {
      editable.focus();
      selectText(editable, 0, 'Evidence claim'.length);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'More AI actions' }));
    const menu = screen.getByRole('menu', { name: 'More AI actions' });
    // Every item used to be a no-op: the Radix menu took focus into a portal,
    // the paragraph blurred and re-rendered, and the saved Range collapsed.
    // The menu lives inside the toolbar now, and hands off to Ask AI.
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Make shorter' }));

    expect(requests).toEqual([{ blockId: 'p1', actionId: 'shorter' }]);
    // Outside the workspace there is no sidebar to search in.
    expect(within(menu).queryByRole('menuitem', { name: 'Search papers for this' })).toBeNull();
    window.removeEventListener(ASK_AI_EVENT, listen);
  });

  it('searches papers for the selection in the Research tab', async () => {
    const openSidebar = vi.fn();
    const { editable } = await mountEditor({ openSidebar });

    act(() => {
      editable.focus();
      selectText(editable, 0, 'Evidence claim'.length);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'More AI actions' }));
    const menu = screen.getByRole('menu', { name: 'More AI actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Search papers for this' }));

    expect(openSidebar).toHaveBeenCalledWith('research', { tab: 'research', query: 'Evidence claim' });
    expect(screen.queryByRole('toolbar', { name: 'Text formatting' })).toBeNull();
  });

  it('opens a menu from the keyboard with focus on its first item, and Escape returns', async () => {
    const { editable } = await mountEditor();
    act(() => {
      editable.focus();
      selectText(editable, 0, 'Evidence'.length);
    });

    const trigger = await screen.findByRole('button', { name: /^Turn into/ });
    expect(trigger.textContent).toContain('Text');
    act(() => trigger.focus());
    // `detail: 0` is the click Enter and Space synthesize.
    fireEvent.click(trigger, { detail: 0 });

    const menu = screen.getByRole('menu', { name: 'Turn into' });
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('Heading 1');

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeTruthy();
  });

  it('Escape from the text closes a pointer-opened menu first, then the toolbar, never reaching the editor', async () => {
    const { editable } = await mountEditor();
    // What the editor does with an Escape that gets through: it turns the
    // text selection into a block selection.
    const editorEscape = vi.fn();
    editable.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') editorEscape();
    });
    act(() => {
      editable.focus();
      selectText(editable, 0, 'Evidence'.length);
    });

    // A pointer click (detail 1): focus stays in the paragraph.
    fireEvent.click(await screen.findByRole('button', { name: /^Turn into/ }), { detail: 1 });
    expect(screen.getByRole('menu', { name: 'Turn into' })).toBeTruthy();
    expect(document.activeElement).toBe(editable);

    fireEvent.keyDown(editable, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeTruthy();
    expect(document.getSelection()?.toString()).toBe('Evidence');
    expect(editorEscape).not.toHaveBeenCalled();

    fireEvent.keyDown(editable, { key: 'Escape' });
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(document.activeElement).toBe(editable);
    expect(document.getSelection()?.toString()).toBe('Evidence');
    expect(editorEscape).not.toHaveBeenCalled();

    // With the toolbar gone, Escape is the editor's again.
    fireEvent.keyDown(editable, { key: 'Escape' });
    expect(editorEscape).toHaveBeenCalledTimes(1);
  });

  it('turns the block into another kind, keeping its text', async () => {
    const { editable } = await mountEditor();
    act(() => {
      editable.focus();
      selectText(editable, 0, 'Evidence'.length);
    });

    fireEvent.click(await screen.findByRole('button', { name: /^Turn into/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Heading 2' }));

    await waitFor(() =>
      expect(editorRef.current?.doc.blocks[0]).toMatchObject({ id: 'p1', type: 'heading', level: 2 }),
    );
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('cites after the selection, committing the placeholder with its child', async () => {
    const { editable } = await mountEditor();
    act(() => {
      editable.focus();
      selectText(editable, 0, 'Evidence'.length);
    });

    fireEvent.click(await screen.findByRole('button', { name: /^Cite/ }));

    await waitFor(() => {
      const block = paragraph(editorRef.current?.doc ?? { version: 1, blocks: [] });
      expect(block.children).toHaveLength(1);
    });
    const finalBlock = paragraph(editorRef.current!.doc);
    expect(finalBlock.children?.[0]).toMatchObject({ type: 'citation', keys: [], style: 'numeric' });
    // Straight after the cited words, not at the start of the paragraph.
    expect(finalBlock.html).toMatch(/^Evidence<span data-child-id="[^"]+"/);

    // The transaction invariant: no committed state may expose placeholder
    // html without the child data required to render and persist it.
    for (const doc of committedDocs) {
      const block = paragraph(doc);
      const childIds = new Set((block.children ?? []).map((entry) => entry.id));
      const placeholderIds = Array.from(
        block.html.matchAll(/data-child-id="([^"]+)"/g),
        (match) => match[1],
      );
      for (const id of placeholderIds) expect(childIds.has(id)).toBe(true);
    }
  });
});

describe('Links', () => {
  const withExec = () => {
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    return exec;
  };

  it('adds https:// to a bare address before creating the link', async () => {
    const { editable } = await mountEditor();
    const exec = withExec();
    act(() => {
      editable.focus();
      selectText(editable, 0, 'Evidence'.length);
    });
    fireEvent.click(await screen.findByRole('button', { name: /^Add link/ }));
    const field = screen.getByRole('textbox', { name: 'Link address' });
    fireEvent.change(field, { target: { value: 'arxiv.org/abs/2101.03961' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(exec).toHaveBeenCalledWith('createLink', false, 'https://arxiv.org/abs/2101.03961');
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('refuses a javascript: link and says why', async () => {
    const { editable } = await mountEditor();
    const exec = withExec();
    act(() => {
      editable.focus();
      selectText(editable, 0, 'Evidence'.length);
    });
    fireEvent.click(await screen.findByRole('button', { name: /^Add link/ }));
    const field = screen.getByRole('textbox', { name: 'Link address' });
    fireEvent.change(field, { target: { value: 'javascript:alert(1)' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(exec).not.toHaveBeenCalledWith('createLink', expect.anything(), expect.anything());
    expect(screen.getByRole('alert').textContent).toMatch(/not allowed/);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('opens a link in a new tab on Ctrl+click, resolving a stored bare address', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { editable } = await mountEditor(undefined, 'See <a href="arxiv.org/abs/1">the paper</a>');
    const anchor = editable.querySelector('a');
    if (!anchor) throw new Error('Link did not render');

    fireEvent.click(anchor, { ctrlKey: true });

    expect(open).toHaveBeenCalledWith('https://arxiv.org/abs/1', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('shows where a clicked link goes, and removes it from its card', async () => {
    const { editable } = await mountEditor(undefined, 'See <a href="https://example.com/x">the paper</a>');
    const anchor = editable.querySelector('a');
    if (!anchor) throw new Error('Link did not render');

    fireEvent.click(anchor);

    const card = await screen.findByRole('group', { name: 'Link' });
    expect(within(card).getByText('example.com')).toBeTruthy();
    expect(within(card).getByRole('link', { name: /Open/ }).getAttribute('rel')).toContain('noopener');

    fireEvent.click(within(card).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(paragraph(editorRef.current!.doc).html).toBe('See the paper'));
    expect(screen.queryByRole('group', { name: 'Link' })).toBeNull();
  });
});
