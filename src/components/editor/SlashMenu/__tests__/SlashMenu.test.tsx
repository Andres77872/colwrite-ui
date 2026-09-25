import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';
import type { Doc, ParagraphBlock as ParagraphBlockType, ParagraphChild } from '@/editor/types';
import type { SlashContext, SlashItem } from '../types';

vi.mock('@/services', () => ({
  createDocument: vi.fn(async () => ({ document_id: 'created-doc', version: 1 })),
  saveDocument: vi.fn(async () => ({ status: 'ok', message: '', version: 2 })),
  loadDocument: vi.fn(async () => ({ version: 1, blocks: [], name: 'Doc' })),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: vi.fn(async () => ({ documents: [], count: 0, status: 'ok', message: '' })),
}));

const { EditorProvider, useEditor } = await import('@/editor');
const { ParagraphBlock } = await import('../../blocks/ParagraphBlock');
const { SlashMenu } = await import('../SlashMenu');
const { aiBeatItem } = await import('../items/aiBeat');
const { tableItem } = await import('../items/table');
const { graphItem } = await import('../items/graph');
const { citationItem } = await import('../items/citation');
const { equationItem, displayEquationItem } = await import('../items/equation');

const TEST_RECT = {
  x: 80,
  y: 100,
  top: 100,
  right: 81,
  bottom: 118,
  left: 80,
  width: 1,
  height: 18,
  toJSON: () => ({}),
} as DOMRect;

const originalGetClientRects = Range.prototype.getClientRects;
const originalGetBoundingClientRect = Range.prototype.getBoundingClientRect;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [TEST_RECT],
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => TEST_RECT,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: originalGetClientRects,
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: originalGetBoundingClientRect,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: originalScrollIntoView,
  });
});

const captureRef = createRef<ReturnType<typeof useEditor>>();
const harness = {
  get editor() {
    if (!captureRef.current) throw new Error('Editor harness is not mounted');
    return captureRef.current;
  },
};

function Harness() {
  const editor = useEditor();
  useImperativeHandle(captureRef, () => editor, [editor]);
  const block = editor.blocks.find((candidate) => candidate.id === 'p1');
  if (!block || block.type !== 'paragraph') return null;

  return (
    <>
      <ParagraphBlock block={block} documentId={editor.documentId} />
      <SlashMenu />
      <button type="button">Outside target</button>
    </>
  );
}

async function mountEditor(html = 'alpha omega') {
  const doc: Doc = {
    version: 1,
    name: 'Slash test',
    blocks: [{ id: 'p1', type: 'paragraph', html, children: [], columns: 1 }],
  };
  localStorage.setItem('colwrite:doc:local', JSON.stringify({ documentId: null, doc }));

  const result = render(
    <EditorProvider>
      <Harness />
    </EditorProvider>,
  );
  await act(async () => {});

  const editable = result.container.querySelector<HTMLDivElement>('.editable');
  if (!editable) throw new Error('Paragraph editable did not mount');
  return { ...result, editable };
}

function putSelection(
  editable: HTMLDivElement,
  start: number,
  end: number = start,
): Range {
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
  return range;
}

/** Type text at the caret the way the browser would, then fire `input`. */
function typeAtCaret(editable: HTMLDivElement, text: string) {
  act(() => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) throw new Error('No caret');
    let node = selection.anchorNode;
    let offset = selection.anchorOffset;
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      const created = document.createTextNode('');
      editable.appendChild(created);
      node = created;
      offset = 0;
    }
    const textNode = node as Text;
    textNode.insertData(offset, text);
    const caret = document.createRange();
    caret.setStart(textNode, offset + text.length);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    fireEvent.input(editable);
  });
}

/** Press "/" at `offset` and let it land in the text, as a browser does. */
async function typeSlash(editable: HTMLDivElement, offset: number) {
  act(() => {
    editable.focus();
    if (editable.firstChild) putSelection(editable, offset);
  });
  const notPrevented = fireEvent.keyDown(editable, { key: '/' });
  expect(notPrevented).toBe(true);
  typeAtCaret(editable, '/');
  await act(async () => {});
}

async function openMenuAt(editable: HTMLDivElement, offset: number) {
  await typeSlash(editable, offset);
  return screen.findByRole('listbox', { name: 'Commands' });
}

function paragraph(): ParagraphBlockType {
  const block = harness.editor.blocks.find((candidate) => candidate.id === 'p1');
  if (!block || block.type !== 'paragraph') throw new Error('Paragraph is missing');
  return block;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-slash-test-host]').forEach((node) => node.remove());
  document.getSelection()?.removeAllRanges();
});

describe('SlashMenu inline commands', () => {
  it('opens on a typed slash without taking focus from the paragraph', async () => {
    const { editable } = await mountEditor();
    await openMenuAt(editable, 6);

    expect(document.activeElement).toBe(editable);
    expect(editable.textContent).toBe('alpha /omega');
    expect(editable.getAttribute('aria-controls')).toBeTruthy();
    expect(editable.getAttribute('aria-activedescendant')).toBeTruthy();
  });

  it('groups commands, leads with Ask AI and shows markdown shortcuts as hints', async () => {
    const { editable } = await mountEditor();
    const listbox = await openMenuAt(editable, 6);

    const groups = within(listbox).getAllByRole('group').map((group) => group.getAttribute('aria-label'));
    expect(groups).toEqual(['AI', 'Basic blocks', 'Insert']);
    expect(within(listbox).getAllByRole('option')[0].textContent).toMatch(/^Ask AI/);
    // The shortcut sits at the end of the row, no longer folded into the
    // description where a long one was truncated away.
    const heading = within(listbox).getByRole('option', { name: /^Heading 2/ });
    expect(heading.textContent).toMatch(/Section heading##$/);
  });

  it('inserts a table where the slash was and removes the slash', async () => {
    const { editable } = await mountEditor();
    await openMenuAt(editable, 6);

    fireEvent.mouseDown(screen.getByRole('option', { name: /^Table/ }));

    await waitFor(() => expect(screen.getByRole('group', { name: 'Table' })).toBeTruthy());
    const block = paragraph();
    const child = block.children?.[0];
    expect(child).toMatchObject({ type: 'table', rows: 3, cols: 3, header: true });
    const placeholder = editable.querySelector<HTMLElement>(`[data-child-id="${child?.id}"]`);
    expect(placeholder?.previousSibling?.textContent).toBe('alpha ');
    expect(editable.textContent).not.toContain('/');
    expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull();
  });

  it('filters on the text typed after the slash and runs the top match on Enter', async () => {
    const { editable } = await mountEditor();
    await openMenuAt(editable, 6);
    typeAtCaret(editable, 'disp');

    await waitFor(() => {
      const options = screen.getAllByRole('option');
      expect(options[0].textContent).toMatch(/Display equation/);
    });
    fireEvent.keyDown(editable, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Display equation' })).toBeTruthy(),
    );
    const block = paragraph();
    expect(block.children?.[0]).toMatchObject({ type: 'equation', display: true });
    expect(block.html).not.toContain('/disp');
    expect(editable.textContent).toContain('alpha ');
    expect(editable.textContent).toContain('omega');
  });

  it('opens the equation editor at once and drops the equation if it closes empty', async () => {
    const { editable } = await mountEditor();
    await openMenuAt(editable, 6);
    typeAtCaret(editable, 'equation');
    await waitFor(() => expect(screen.getAllByRole('option')[0].textContent).toMatch(/^Equation/));
    fireEvent.keyDown(editable, { key: 'Enter' });

    const latex = await waitFor(() => {
      const field = screen.getByLabelText('LaTeX');
      expect(document.activeElement).toBe(field);
      return field;
    });
    expect(paragraph().children).toHaveLength(1);

    fireEvent.keyDown(latex, { key: 'Enter' });

    await waitFor(() => expect(paragraph().children ?? []).toHaveLength(0));
    expect(editable.querySelector('[data-child-id]')).toBeNull();
    expect(paragraph().html).not.toContain('data-child-id');
  });

  it('keeps an equation that was given LaTeX', async () => {
    const { editable } = await mountEditor();
    await openMenuAt(editable, 6);
    typeAtCaret(editable, 'equation');
    await waitFor(() => expect(screen.getAllByRole('option')[0].textContent).toMatch(/^Equation/));
    fireEvent.keyDown(editable, { key: 'Enter' });

    const latex = await waitFor(() => {
      const field = screen.getByLabelText('LaTeX');
      expect(document.activeElement).toBe(field);
      return field;
    });
    fireEvent.change(latex, { target: { value: 'x^2' } });
    fireEvent.keyDown(latex, { key: 'Enter' });

    await waitFor(() => expect(screen.queryByLabelText('LaTeX')).toBeNull());
    expect(paragraph().children?.[0]).toMatchObject({ type: 'equation', latex: 'x^2' });
  });

  it('turns an empty line into the chosen block kind', async () => {
    const { editable } = await mountEditor('');
    await openMenuAt(editable, 0);
    typeAtCaret(editable, 'h2');
    await waitFor(() => expect(screen.getAllByRole('option')[0].textContent).toMatch(/Heading 2/));

    fireEvent.keyDown(editable, { key: 'Enter' });

    await waitFor(() => {
      const [block] = harness.editor.blocks;
      expect(block).toMatchObject({ id: 'p1', type: 'heading', level: 2, html: '' });
    });
  });

  it('adds the block below when the line already holds text', async () => {
    // After a space: a slash straight after a word is literal text.
    const { editable } = await mountEditor('alpha omega ');
    await openMenuAt(editable, 12);
    typeAtCaret(editable, 'todo');
    await waitFor(() => expect(screen.getAllByRole('option')[0].textContent).toMatch(/To-do/));

    fireEvent.keyDown(editable, { key: 'Enter' });

    await waitFor(() => expect(harness.editor.blocks).toHaveLength(2));
    expect(harness.editor.blocks[0]).toMatchObject({ id: 'p1', type: 'paragraph', html: 'alpha omega ' });
    expect(harness.editor.blocks[1]).toMatchObject({ type: 'paragraph', variant: 'todo', checked: false });
  });

  it('types a literal slash mid-word instead of opening the menu', async () => {
    // DOIs, URLs and "and/or" all carry a slash inside a word.
    const { editable } = await mountEditor();
    act(() => {
      editable.focus();
      putSelection(editable, 3);
    });
    const notPrevented = fireEvent.keyDown(editable, { key: '/' });
    typeAtCaret(editable, '/');
    await act(async () => {});

    expect(notPrevented).toBe(true);
    expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull();
    expect(paragraph().html).toBe('alp/ha omega');
  });

  it('closes on Escape and leaves what was typed', async () => {
    const { editable } = await mountEditor();
    await openMenuAt(editable, 6);
    typeAtCaret(editable, 'x');

    fireEvent.keyDown(editable, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull());
    expect(editable.textContent).toBe('alpha /xomega');
    expect(paragraph().children).toEqual([]);
    expect(editable.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('closes when a space follows the slash straight away', async () => {
    const { editable } = await mountEditor();
    await openMenuAt(editable, 6);
    typeAtCaret(editable, ' ');

    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull());
  });

  it('closes on an outside click without touching the text', async () => {
    const { editable } = await mountEditor();
    await openMenuAt(editable, 6);
    const outside = screen.getByRole('button', { name: 'Outside target' });

    fireEvent.mouseDown(outside);

    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull());
    expect(editable.textContent).toBe('alpha /omega');
    expect(paragraph().children).toEqual([]);
  });
});

type CommandCase = {
  item: SlashItem;
  expected: Partial<ParagraphChild>;
};

const commandCases: CommandCase[] = [
  {
    item: aiBeatItem,
    expected: { type: 'aiBeat', message: '', prompt: '', output: '' },
  },
  {
    item: tableItem,
    expected: { type: 'table', rows: 3, cols: 3, header: true },
  },
  {
    item: graphItem,
    expected: {
      type: 'graph',
      kind: 'bar',
      data: { values: [3, 5, 2], labels: ['A', 'B', 'C'] },
    },
  },
  {
    item: citationItem,
    expected: { type: 'citation', keys: [], style: 'numeric' },
  },
  {
    item: equationItem,
    expected: { type: 'equation', latex: '' },
  },
  {
    item: displayEquationItem,
    expected: { type: 'equation', latex: '', display: true, numbered: true },
  },
];

function commandContext(
  text = 'abcd',
  start = 2,
  end = start,
): {
  context: SlashContext;
  editable: HTMLDivElement;
  addParagraphChild: ReturnType<typeof vi.fn>;
  updateHtml: ReturnType<typeof vi.fn>;
} {
  const editable = document.createElement('div');
  editable.dataset.slashTestHost = '';
  editable.setAttribute('contenteditable', 'true');
  editable.tabIndex = -1;
  editable.textContent = text;
  document.body.appendChild(editable);

  const textNode = editable.firstChild;
  if (!textNode) throw new Error('Command host has no text node');
  const insertionRange = document.createRange();
  insertionRange.setStart(textNode, start);
  insertionRange.setEnd(textNode, end);

  const addParagraphChild = vi.fn((_blockId: string, child: ParagraphChild) => child.id);
  const updateHtml = vi.fn();
  const context: SlashContext = {
    blockId: 'p1',
    insertionRange,
    refs: { current: { p1: editable } },
    updateHtml,
    addParagraphChild,
    // These two serve the "Basic blocks" commands, which operate on the block
    // list rather than on the caret's range; the payload tests here cover the
    // inline-widget commands.
    applyKind: vi.fn(() => 'p1'),
    focusBlock: vi.fn(),
    documentId: null,
    createRemote: vi.fn(async () => 'created-doc'),
  };
  return { context, editable, addParagraphChild, updateHtml };
}

describe('slash command payloads and range safety', () => {
  it.each(commandCases)('inserts the $item.label payload with a matching placeholder', async ({
    item,
    expected,
  }) => {
    const { context, editable, addParagraphChild, updateHtml } = commandContext();

    await item.onSelect(context);

    expect(addParagraphChild).toHaveBeenCalledTimes(1);
    const child = addParagraphChild.mock.calls[0][1] as ParagraphChild;
    expect(child).toMatchObject(expected);

    const placeholder = editable.querySelector(`[data-child-id="${child.id}"]`);
    expect(placeholder).toBeTruthy();
    expect(updateHtml).toHaveBeenCalledWith(
      'p1',
      expect.stringContaining(`data-child-id="${child.id}"`),
    );
    expect(document.activeElement).toBe(editable);
  });

  it.each([
    { label: 'start', offset: 0, prefix: '<span' },
    { label: 'middle', offset: 2, prefix: 'ab<span' },
    { label: 'end', offset: 4, prefix: 'abcd<span' },
  ])('inserts at the $label of the paragraph', async ({ offset, prefix }) => {
    const { context, editable } = commandContext('abcd', offset);

    await citationItem.onSelect(context);

    expect(editable.innerHTML.startsWith(prefix)).toBe(true);
  });

  it('rejects a range from another paragraph without creating an orphan child', async () => {
    const { context, editable, addParagraphChild, updateHtml } = commandContext();
    const other = document.createElement('div');
    other.dataset.slashTestHost = '';
    other.textContent = 'other';
    document.body.appendChild(other);
    const range = document.createRange();
    range.setStart(other.firstChild!, 2);
    range.collapse(true);
    context.insertionRange = range;

    await tableItem.onSelect(context);

    expect(editable.innerHTML).toBe('abcd');
    expect(addParagraphChild).not.toHaveBeenCalled();
    expect(updateHtml).not.toHaveBeenCalled();
  });

  it('rejects a bookmark whose original editable was replaced', async () => {
    const { context, editable, addParagraphChild, updateHtml } = commandContext();
    const replacement = document.createElement('div');
    replacement.dataset.slashTestHost = '';
    replacement.setAttribute('contenteditable', 'true');
    replacement.tabIndex = -1;
    replacement.textContent = 'new';
    editable.replaceWith(replacement);
    context.refs.current.p1 = replacement;

    await tableItem.onSelect(context);

    expect(replacement.innerHTML).toBe('new');
    expect(addParagraphChild).not.toHaveBeenCalled();
    expect(updateHtml).not.toHaveBeenCalled();
  });
});
