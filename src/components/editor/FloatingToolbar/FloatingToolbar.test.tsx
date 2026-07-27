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
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef, useImperativeHandle, useLayoutEffect } from 'react';
import type { Doc, ParagraphBlock as ParagraphBlockType } from '@/editor/types';
import type { DispatchActionParams } from '@/services/actionDispatcher';

const actionMocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
}));

vi.mock('@/services', () => ({
  createDocument: vi.fn(async () => ({ document_id: 'created-doc', version: 1 })),
  saveDocument: vi.fn(async () => ({ status: 'ok', message: '', version: 2 })),
  loadDocument: vi.fn(async () => ({ version: 1, blocks: [], name: 'Doc' })),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: vi.fn(async () => ({ documents: [], count: 0, status: 'ok', message: '' })),
}));

vi.mock('@/services/actionDispatcher', () => ({
  dispatchAction: actionMocks.dispatch,
}));

// The menu's Radix keyboard/focus behavior is covered independently. This
// integration test keeps the real toolbar accept path and replaces only the
// action picker needed to invoke it.
vi.mock('./AIActionMenu/AIActionMenu', () => ({
  AIActionMenu: ({
    onAction,
  }: {
    onAction: (action: 'search-for-references') => void;
  }) => (
    <button type="button" onClick={() => onAction('search-for-references')}>
      Search references
    </button>
  ),
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
  if (!block || block.type !== 'paragraph') return null;
  return (
    <>
      <Editable id={block.id} html={block.html} />
      <FloatingToolbar />
    </>
  );
}

async function mountEditor() {
  const doc: Doc = {
    version: 1,
    name: 'Floating toolbar test',
    blocks: [
      {
        id: 'p1',
        type: 'paragraph',
        html: 'Evidence claim',
        children: [],
        columns: 1,
      },
    ],
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
  actionMocks.dispatch.mockImplementation(async (params: DispatchActionParams) => {
    params.onToken?.(
      [
        'Supported ',
        '<citation title="A Study" authors="A. Author" doi="10.1000/TEST" />',
        ' and ',
        '<citation title="Another Study" paper_id="CorpusId:42" ',
        'url="https://www.semanticscholar.org/paper/example/CorpusId:42" />.',
      ].join(''),
    );
  });
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

    expect(exec).toHaveBeenCalledWith('bold', false);
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
});

describe('FloatingToolbar structured citation acceptance', () => {
  it('commits every citation placeholder together with its corresponding child', async () => {
    const { editable } = await mountEditor();

    act(() => {
      editable.focus();
      selectText(editable, 0, 'Evidence claim'.length);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Search references' }));

    const accept = await screen.findByRole('button', { name: 'Accept suggestion' });
    // `click`, not `mouseDown` — the control has to answer the event that Enter
    // and Space produce, or the suggestion cannot be accepted without a mouse.
    fireEvent.click(accept);

    await waitFor(() => {
      const block = paragraph(editorRef.current?.doc ?? { version: 1, blocks: [] });
      expect(block.children).toHaveLength(2);
      expect(block.html).toContain('data-child-id=');
    });

    const finalBlock = paragraph(editorRef.current!.doc);
    expect(finalBlock.children?.[0]).toMatchObject({
      type: 'citation',
      keys: ['10.1000/test'],
      sources: [{ provider: 'manual', doi: '10.1000/test' }],
    });
    expect(finalBlock.children?.[1]).toMatchObject({
      type: 'citation',
      keys: ['S2:CorpusId:42'],
      sources: [{ provider: 'semantic_scholar', providerId: 'CorpusId:42' }],
    });
    expect(finalBlock.html).not.toContain('<citation');

    // This is the transaction invariant: no state committed by the real
    // provider may expose placeholder HTML without the child data required to
    // render and persist it.
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
