import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      <ParagraphBlock block={block} />
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

async function openMenuAt(editable: HTMLDivElement, start: number, end: number = start) {
  act(() => {
    editable.focus();
    putSelection(editable, start, end);
  });
  fireEvent.keyDown(editable, { key: '/' });

  const search = await screen.findByRole('combobox', { name: 'Search commands' });
  await waitFor(() => expect(document.activeElement).toBe(search));
  return search as HTMLInputElement;
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

describe('SlashMenu insertion', () => {
  it('inserts a table at the bookmarked caret after search takes focus', async () => {
    const { editable } = await mountEditor();
    const search = await openMenuAt(editable, 5);

    expect(editable.contains(document.getSelection()?.anchorNode ?? null)).toBe(false);
    expect(document.activeElement).toBe(search);

    fireEvent.mouseDown(screen.getByRole('option', { name: /Table/ }));

    await waitFor(() => expect(screen.getByRole('group', { name: 'Table' })).toBeTruthy());

    const block = paragraph();
    const child = block.children?.[0];
    expect(child).toMatchObject({
      type: 'table',
      rows: 3,
      cols: 3,
      header: true,
      align: ['left', 'left', 'left'],
    });

    const placeholder = editable.querySelector<HTMLElement>(`[data-child-id="${child?.id}"]`);
    expect(placeholder).toBeTruthy();
    expect(block.html).toContain(`data-child-id="${child?.id}"`);
    expect(block.html).not.toContain('<table');
    expect(placeholder?.previousSibling?.textContent).toBe('alpha');

    expect(document.activeElement).toBe(editable);
    const selection = document.getSelection();
    expect(selection?.anchorNode?.previousSibling).toBe(placeholder);
    expect(selection?.anchorNode?.textContent).toBe('\u00a0');
    expect(selection?.anchorOffset).toBe(1);
  });

  it('filters with the keyboard, replaces selected text, and inserts the active command', async () => {
    const { editable } = await mountEditor();
    const search = await openMenuAt(editable, 6, 11);

    fireEvent.change(search, { target: { value: 'display equation' } });
    fireEvent.keyDown(search, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Display equation' })).toBeTruthy(),
    );

    const block = paragraph();
    expect(block.children).toHaveLength(1);
    expect(block.children?.[0]).toMatchObject({
      type: 'equation',
      latex: '',
      display: true,
      numbered: true,
    });
    expect(block.html).not.toContain('omega');
    expect(document.activeElement).toBe(editable);
  });

  it('restores the exact caret on Escape', async () => {
    const { editable } = await mountEditor();
    const search = await openMenuAt(editable, 3);

    fireEvent.keyDown(search, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('combobox', { name: 'Search commands' })).toBeNull();
      expect(document.activeElement).toBe(editable);
      expect(document.getSelection()?.anchorNode).toBe(editable.firstChild);
      expect(document.getSelection()?.anchorOffset).toBe(3);
    });
    expect(paragraph().children).toEqual([]);
  });

  it('does not restore the paragraph caret after an outside dismissal', async () => {
    const { editable } = await mountEditor();
    await openMenuAt(editable, 3);
    const outside = screen.getByRole('button', { name: 'Outside target' });

    fireEvent.mouseDown(outside);
    act(() => outside.focus());

    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Search commands' })).toBeNull(),
    );
    expect(document.activeElement).toBe(outside);
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
