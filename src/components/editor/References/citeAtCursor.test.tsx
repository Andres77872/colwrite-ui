import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';
import type { Block, CitationSource } from '@/editor/types';

vi.mock('@/services', () => ({
  createDocument: vi.fn(async () => ({ document_id: 'created-doc', version: 1 })),
  saveDocument: vi.fn(async () => ({ status: 'ok', message: '', version: 2 })),
  loadDocument: vi.fn(async () => ({ version: 1, blocks: [], name: 'Doc' })),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: vi.fn(async () => ({ documents: [], count: 0, status: 'ok', message: '' })),
}));

const { EditorProvider, useEditor } = await import('@/editor');
const { Editable } = await import('@/components/common/Editable');
const { forgetCaret, useCiteAtCursor, useRememberCaret } = await import('./citeAtCursor');

type Cite = (sources: readonly CitationSource[]) => string | null;
const citeRef = createRef<Cite>();
const editorRef = createRef<ReturnType<typeof useEditor>>();

/** The paragraph as the canvas renders it, with the caret tracker mounted. */
function Harness() {
  useRememberCaret();
  const editor = useEditor();
  const cite = useCiteAtCursor();
  useImperativeHandle(editorRef, () => editor, [editor]);
  useImperativeHandle(citeRef, () => cite, [cite]);
  const block = editor.blocks.find((b): b is Block & { html: string } => b.id === 'p1' && 'html' in b);
  return (
    <div data-block-id="p1">
      <Editable id="p1" html={block?.html ?? ''} />
    </div>
  );
}

const SOURCE: CitationSource = { key: 'vaswani2017', title: 'Attention is all you need' } as CitationSource;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    'colwrite:doc:local',
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

    let target: string | null = null;
    await act(async () => {
      target = citeRef.current!([SOURCE]);
    });

    expect(target).toBe('p1');
    const html = (editorRef.current!.blocks[0] as Block & { html: string }).html;
    const plain = html.replace(/<span data-child-id="[^"]+" contenteditable="false"><\/span>/g, '§');
    expect(plain).toBe('Sparse routing § scales§ well.');
    outside.remove();
  });
});
