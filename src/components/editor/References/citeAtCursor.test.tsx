import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { act, cleanup } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { createRef, useImperativeHandle } from 'react';
import type { Block, CitationChild, CitationSource, ParagraphBlock } from '@/editor/types';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

vi.mock('@/data/documents', async () => ({
  ...(await vi.importActual<typeof import('@/data/documents')>('@/data/documents')),
  createDocument: vi.fn(async () => ({ id: 'created-doc', doc: { blocks: [], name: 'Doc' }, etag: 'cw:1', updatedAt: null, placement: { documentId: 'created-doc', collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null } })),
  saveDocument: vi.fn(async () => ({ etag: 'cw:2', updatedAt: null })),
  getDocument: vi.fn(async () => ({ doc: { blocks: [], name: 'Doc' }, etag: 'cw:1', updatedAt: null, placement: { documentId: 'doc', collectionId: null, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null } })),
  deleteDocument: vi.fn(async () => {}),
}));

// The first-run probe reads the server's page list: there is none yet.
beforeEach(() => {
  mockDocumentList();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const { EditorProvider } = await import('@/editor');
const { useEditorProbe } = await import('@/editor/__tests__/editorHarness');
const { Editable } = await import('@/components/common/Editable');
const { citeNotice, forgetCaret, useCiteAtCursor, useRememberCaret } = await import('./citeAtCursor');
type Placement = import('./citeAtCursor').CitePlacement;

type Cite = (sources: readonly CitationSource[]) => Placement | null;
const citeRef = createRef<Cite>();
const editorRef = createRef<ReturnType<typeof useEditorProbe>>();

/** Every text block as the canvas renders it, with the caret tracker mounted. */
function Harness() {
  useRememberCaret();
  const editor = useEditorProbe();
  const cite = useCiteAtCursor();
  useImperativeHandle(editorRef, () => editor, [editor]);
  useImperativeHandle(citeRef, () => cite, [cite]);
  return (
    <>
      {editor.blocks.map((block) =>
        'html' in block ? (
          <div key={block.id} data-block-id={block.id}>
            <Editable id={block.id} html={block.html} />
          </div>
        ) : null,
      )}
    </>
  );
}

const SOURCE: CitationSource = { key: 'vaswani2017', title: 'Attention is all you need' } as CitationSource;
const OTHER: CitationSource = { key: 'fedus2021', title: 'Switch Transformers' } as CitationSource;

const PARAGRAPH: Block = {
  id: 'p1',
  type: 'paragraph',
  html: 'Sparse routing <span data-child-id="c1" contenteditable="false"></span> scales well.',
  children: [{ id: 'c1', type: 'citation', keys: ['a'], sources: [], style: 'numeric' }],
  columns: 1,
};

function seed(blocks: Block[]) {
  localStorage.setItem(`colwrite:ws:${TEST_WORKSPACE_ID}:doc:local`, JSON.stringify({ documentId: null, doc: { version: 1, blocks } }));
}

/** Render the editor; returns a field outside the text for focus to move to. */
function renderEditor(): HTMLInputElement {
  const outside = document.createElement('input');
  document.body.appendChild(outside);
  render(
    <EditorProvider>
      <Harness />
    </EditorProvider>,
  );
  return outside;
}

function editable(id: string): HTMLDivElement {
  return document.querySelector<HTMLDivElement>(`[data-block-id="${id}"] .editable`)!;
}

function block(id: string): ParagraphBlock {
  return editorRef.current!.blocks.find((candidate) => candidate.id === id) as ParagraphBlock;
}

/** Placeholders as §, so assertions read as the text does. */
function marks(html: string): string {
  return html.replace(/<span data-child-id="[^"]+" contenteditable="false"><\/span>/g, '§');
}

/** The author clicks into the text and puts the caret at (node, offset). */
async function placeCaret(el: HTMLElement, node: Node, offset: number) {
  await act(async () => {
    el.focus();
    el.dispatchEvent(new FocusEvent('focus'));
  });
  await act(async () => {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

/** Then clicks "Cite" in a side panel: focus leaves the text. */
async function leaveText(outside: HTMLElement) {
  await act(async () => {
    outside.focus();
    await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    `colwrite:ws:${TEST_WORKSPACE_ID}:doc:local`,
    JSON.stringify({
      documentId: null,
      doc: {
        version: 1,
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            html: 'Sparse routing <span data-child-id="c1" contenteditable="false"></span> scales well.',
            children: [{ id: 'c1', type: 'citation', keys: ['a'], sources: [], style: 'numeric' }],
          },
        ],
      },
    }),
  );
});

afterEach(() => {
  cleanup();
  forgetCaret();
  document.querySelectorAll('body > input').forEach((input) => input.remove());
});

describe('Cite at cursor', () => {
  it('lands at the caret in a paragraph with a widget, after focus left the text', async () => {
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    render(
      <EditorProvider>
        <Harness />
      </EditorProvider>,
    );
    const el = document.querySelector<HTMLDivElement>('.editable')!;
    // What the citation widget renders into its placeholder.
    el.querySelector('[data-child-id="c1"]')!.textContent = '[1]';
    const after = el.lastChild as Text;
    expect(after.data).toBe(' scales well.');

    // The author clicks into the text and puts the caret after "scales".
    await act(async () => {
      el.focus();
      el.dispatchEvent(new FocusEvent('focus'));
    });
    await act(async () => {
      const range = document.createRange();
      range.setStart(after, ' scales'.length);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });

    // Then clicks "Cite" in a side panel: focus leaves the paragraph.
    await act(async () => {
      outside.focus();
      el.dispatchEvent(new FocusEvent('blur', { relatedTarget: outside }));
      await Promise.resolve();
    });
    // The paragraph's markup was not rewritten on the way out.
    expect(el.lastChild).toBe(after);
    // A late selection report (the browser collapsing a stale range) is not
    // the author moving the caret.
    await act(async () => {
      const range = document.createRange();
      range.setStart(el, 0);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });

    let target: Placement | null = null;
    await act(async () => {
      target = citeRef.current!([SOURCE]);
    });

    expect(target).toEqual({ where: 'caret', blockId: 'p1' });
    const html = (editorRef.current!.blocks[0] as Block & { html: string }).html;
    const plain = html.replace(/<span data-child-id="[^"]+" contenteditable="false"><\/span>/g, '§');
    expect(plain).toBe('Sparse routing § scales§ well.');
    outside.remove();
  });
  it('joins a second cite to the first instead of sending it to the end of the document', async () => {
    seed([PARAGRAPH, { id: 'p2', type: 'paragraph', html: 'A later paragraph.', children: [], columns: 1 }]);
    const outside = renderEditor();
    const el = editable('p1');
    el.querySelector('[data-child-id="c1"]')!.textContent = '[1]';
    await placeCaret(el, el.lastChild!, ' scales'.length);
    await leaveText(outside);

    let first: Placement | null = null;
    let second: Placement | null = null;
    let again: Placement | null = null;
    await act(async () => {
      first = citeRef.current!([SOURCE]);
    });
    await act(async () => {
      second = citeRef.current!([OTHER]);
    });
    await act(async () => {
      again = citeRef.current!([SOURCE]);
    });

    expect(first).toEqual({ where: 'caret', blockId: 'p1' });
    expect(second).toEqual({ where: 'merged', blockId: 'p1', added: 1 });
    expect(again).toEqual({ where: 'merged', blockId: 'p1', added: 0 });
    const p1 = block('p1');
    // One new widget, after "scales", carrying both works.
    expect(marks(p1.html)).toBe('Sparse routing § scales§ well.');
    const added = p1.children!.find((child) => child.id !== 'c1') as CitationChild;
    expect(added.keys).toEqual(['vaswani2017', 'fedus2021']);
    expect(added.sources?.map((source) => source.key)).toEqual(['vaswani2017', 'fedus2021']);
    expect(block('p2').html).toBe('A later paragraph.');
    expect(citeNotice(second!, [OTHER]).title).toBe('Added to the citation at the cursor');
    expect(citeNotice(again!, [SOURCE]).title).toBe('Already cited here');
  });

  it('joins the citation the caret sits right after', async () => {
    const outside = renderEditor();
    const el = editable('p1');
    el.querySelector('[data-child-id="c1"]')!.textContent = '[1]';
    // Directly after the widget: the start of the text node that follows it.
    await placeCaret(el, el.lastChild!, 0);
    await leaveText(outside);

    let placed: Placement | null = null;
    await act(async () => {
      placed = citeRef.current!([SOURCE]);
    });

    expect(placed).toEqual({ where: 'merged', blockId: 'p1', added: 1 });
    const p1 = block('p1');
    expect(marks(p1.html)).toBe('Sparse routing § scales well.');
    expect((p1.children![0] as CitationChild).keys).toEqual(['a', 'vaswani2017']);
  });

  it('cites a caret in a heading at the end of that section, scrolls to it and says where', async () => {
    seed([
      { id: 'h1', type: 'heading', level: 2, html: 'Introduction' },
      { id: 'intro', type: 'paragraph', html: 'Why it matters.', children: [], columns: 1 },
      { id: 'h2', type: 'heading', level: 2, html: 'Related work' },
      { id: 'rw1', type: 'paragraph', html: 'Earlier routing.', children: [], columns: 1 },
      { id: 'rw2', type: 'paragraph', html: 'Later routing.', children: [], columns: 1 },
      { id: 'h3', type: 'heading', level: 2, html: 'Method' },
      { id: 'm1', type: 'paragraph', html: 'Our method.', children: [], columns: 1 },
    ]);
    const scrolled: Element[] = [];
    const scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true });
    const outside = renderEditor();
    const heading = editable('h2');
    await placeCaret(heading, heading.firstChild!, 'Related'.length);
    await leaveText(outside);

    let placed: Placement | null = null;
    await act(async () => {
      placed = citeRef.current!([SOURCE]);
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    expect(placed).toEqual({
      where: 'fallback',
      blockId: 'rw2',
      section: 'Related work',
      last: false,
      caretBlock: 'heading',
    });
    expect(marks(block('rw2').html)).toMatch(/^Later routing\.§/);
    expect(block('m1').html).toBe('Our method.');
    expect(scrolled.map((node) => node.getAttribute('data-block-id'))).toContain('rw2');
    const notice = citeNotice(placed!, [SOURCE]);
    expect(notice.title).toBe('Cited at the end of “Related work”');
    expect(notice.description).toContain('Headings can’t hold citations.');

    // The next cite joins the one just placed rather than starting over.
    let next: Placement | null = null;
    await act(async () => {
      next = citeRef.current!([OTHER]);
    });
    expect(next).toEqual({ where: 'merged', blockId: 'rw2', added: 1 });
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  it('with no caret, cites at the end of the last paragraph and says how to choose a place', async () => {
    renderEditor();
    let placed: Placement | null = null;
    await act(async () => {
      placed = citeRef.current!([SOURCE]);
    });

    expect(placed).toEqual({ where: 'fallback', blockId: 'p1', section: null, last: true, caretBlock: null });
    const notice = citeNotice(placed!, [SOURCE]);
    expect(notice.title).toBe('Cited at the end of the page');
    expect(notice.description).toContain('Click into the text first');
  });
});
