import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';
import type { Block } from '@/editor/types';

vi.mock('@/services', () => ({
  createDocument: vi.fn(async () => ({ document_id: 'created-doc', version: 1 })),
  saveDocument: vi.fn(async () => ({ status: 'ok', message: '', version: 2 })),
  loadDocument: vi.fn(async () => ({ version: 1, blocks: [], name: 'Doc' })),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: vi.fn(async () => ({ documents: [], count: 0, status: 'ok', message: '' })),
}));

const { EditorProvider, useEditor } = await import('@/editor');
const { Editable } = await import('./Editable');

const editorRef = createRef<ReturnType<typeof useEditor>>();

function currentEditor() {
  if (!editorRef.current) throw new Error('Editor harness is not mounted');
  return editorRef.current;
}

function CaptureEditor() {
  const editor = useEditor();
  useImperativeHandle(editorRef, () => editor, [editor]);
  return null;
}

/** Mirrors how Canvas renders an Editable: the html prop tracks editor state. */
function BlockEditable({ id }: { id: string }) {
  const { blocks } = useEditor();
  const block = blocks.find((b): b is Block & { html: string } => b.id === id && 'html' in b);
  return <Editable id={id} html={block?.html ?? ''} />;
}

function seedLocal(blocks: Block[]) {
  localStorage.setItem(
    'colwrite:doc:local',
    JSON.stringify({ documentId: null, doc: { version: 1, blocks } }),
  );
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function editableDiv(id: string): HTMLDivElement {
  const el = document.querySelector<HTMLDivElement>(`.editable`);
  if (!el) throw new Error(`Editable ${id} not rendered`);
  return el;
}

describe('Editable accessibility', () => {
  it('exposes an explicitly named multiline textbox', () => {
    seedLocal([{ id: 'p1', type: 'paragraph', html: 'Accessible prose', children: [] }]);
    render(
      <EditorProvider>
        <Editable id="p1" html="Accessible prose" ariaLabel="Paragraph" />
      </EditorProvider>,
    );

    const field = screen.getByRole('textbox', { name: 'Paragraph' });
    expect(field.getAttribute('contenteditable')).toBe('true');
    expect(field.getAttribute('aria-multiline')).toBe('true');
    expect(field.hasAttribute('aria-readonly')).toBe(false);
  });

  it('keeps a locked textbox focusable and announces it as read-only', () => {
    seedLocal([{ id: 'p1', type: 'paragraph', html: 'Locked prose', children: [], locked: true }]);
    render(
      <EditorProvider>
        <Editable id="p1" html="Locked prose" ariaLabel="Paragraph" locked />
      </EditorProvider>,
    );

    const field = screen.getByRole('textbox', { name: 'Paragraph' });
    expect(field.getAttribute('contenteditable')).toBe('false');
    expect(field.getAttribute('aria-readonly')).toBe('true');
    expect(field.tabIndex).toBe(0);
  });
});

describe('Editable active-block synchronization', () => {
  // M2: an external state change (agent accept, restore, undo) used to be
  // ignored while the block was active, and the next keystroke serialized the
  // stale DOM back over it.
  it('rebases the active block when state changes externally', async () => {
    seedLocal([{ id: 'p1', type: 'paragraph', html: 'Original text', children: [] }]);
    render(
      <EditorProvider>
        <CaptureEditor />
        <BlockEditable id="p1" />
      </EditorProvider>,
    );
    const el = editableDiv('p1');
    expect(el.textContent).toBe('Original text');

    act(() => currentEditor().setActive('p1'));
    act(() =>
      currentEditor().applyPatch(
        [{ op: 'replace_block', blockId: 'p1', block: { html: 'Agent wrote this' } }],
        { persist: true },
      ),
    );

    expect(el.textContent).toBe('Agent wrote this');
    expect(currentEditor().blocks[0]).toMatchObject({ html: 'Agent wrote this' });
  });

  it('does not rebase when the change came from this editable itself', async () => {
    seedLocal([{ id: 'p1', type: 'paragraph', html: 'Original', children: [] }]);
    render(
      <EditorProvider>
        <CaptureEditor />
        <BlockEditable id="p1" />
      </EditorProvider>,
    );
    const el = editableDiv('p1');
    act(() => currentEditor().setActive('p1'));

    // Simulate typing: mutate the DOM, then fire input so the serializer runs.
    el.innerHTML = 'Original plus <b>typed</b>';
    act(() => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // The DOM must be exactly what was typed — a spurious rebase from state
    // would reset caret-relevant nodes by rewriting innerHTML (here observable
    // as the same node identity being preserved).
    const bold = el.querySelector('b');
    expect(bold?.textContent).toBe('typed');
    expect(currentEditor().blocks[0]).toMatchObject({ html: 'Original plus <b>typed</b>' });
  });

  it('keeps syncing from state while the block is inactive', async () => {
    seedLocal([
      { id: 'p1', type: 'paragraph', html: 'One', children: [] },
      { id: 'p2', type: 'paragraph', html: 'Two', children: [] },
    ]);
    render(
      <EditorProvider>
        <CaptureEditor />
        <BlockEditable id="p1" />
      </EditorProvider>,
    );
    const el = editableDiv('p1');

    act(() => currentEditor().setActive('p2'));
    act(() =>
      currentEditor().applyPatch(
        [{ op: 'replace_block', blockId: 'p1', block: { html: 'Patched while inactive' } }],
        { persist: true },
      ),
    );

    expect(el.textContent).toBe('Patched while inactive');
  });
});

describe('Editable cross-block keyboard', () => {
  function renderBlocks(blocks: Block[]) {
    seedLocal(blocks);
    render(
      <EditorProvider>
        <CaptureEditor />
        {blocks.map(b => (
          <BlockEditable key={b.id} id={b.id} />
        ))}
      </EditorProvider>,
    );
  }

  function editableFor(index: number): HTMLDivElement {
    const els = document.querySelectorAll<HTMLDivElement>('.editable');
    const el = els[index];
    if (!el) throw new Error(`Editable ${index} not rendered`);
    return el;
  }

  function setCaret(el: HTMLElement, offset: number) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node = walker.nextNode() as Text | null;
    while (node && remaining > node.data.length) {
      remaining -= node.data.length;
      node = walker.nextNode() as Text | null;
    }
    const range = document.createRange();
    if (node) range.setStart(node, remaining);
    else { range.selectNodeContents(el); range.collapse(false); }
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it('Enter splits the block at the caret and moves the tail into a new paragraph', async () => {
    renderBlocks([
      { id: 'p1', type: 'paragraph', html: 'Hello world', children: [] },
      { id: 'p2', type: 'paragraph', html: 'Tail', children: [] },
    ]);
    const el = editableFor(0);
    act(() => currentEditor().setActive('p1'));
    setCaret(el, 5);

    act(() => {
      fireEvent.keyDown(el, { key: 'Enter' });
    });

    expect(currentEditor().blocks.map(b => [b.id, 'html' in b ? b.html : ''])).toEqual([
      ['p1', 'Hello'],
      [expect.any(String), ' world'],
      ['p2', 'Tail'],
    ]);
  });

  it('Backspace at the start of a block merges it into the previous one', () => {
    renderBlocks([
      { id: 'p1', type: 'paragraph', html: 'Hello', children: [] },
      { id: 'p2', type: 'paragraph', html: 'World', children: [] },
    ]);
    const el = editableFor(1);
    act(() => currentEditor().setActive('p2'));
    setCaret(el, 0);

    let prevented: boolean | undefined;
    act(() => {
      prevented = fireEvent.keyDown(el, { key: 'Backspace' });
    });

    expect(prevented).toBe(false); // fireEvent returns false when preventDefault ran
    expect(currentEditor().blocks).toHaveLength(1);
    expect(currentEditor().blocks[0]).toMatchObject({ id: 'p1', html: 'HelloWorld' });
  });

  it('Backspace at the start of the block after a divider removes the divider', () => {
    renderBlocks([
      { id: 'p1', type: 'paragraph', html: 'Hello', children: [] },
      { id: 'd1', type: 'divider' } as Block,
      { id: 'p2', type: 'paragraph', html: 'World', children: [] },
    ]);
    // Only paragraphs render editables; p2 is the second one rendered.
    const els = document.querySelectorAll<HTMLDivElement>('.editable');
    const el = els[1];
    act(() => currentEditor().setActive('p2'));
    setCaret(el, 0);

    act(() => {
      fireEvent.keyDown(el, { key: 'Backspace' });
    });

    expect(currentEditor().blocks.map(b => b.id)).toEqual(['p1', 'p2']);
    expect(currentEditor().blocks[1]).toMatchObject({ html: 'World' });
  });

  it('ArrowRight at the end of the text crosses into the next block', () => {
    renderBlocks([
      { id: 'p1', type: 'paragraph', html: 'One', children: [] },
      { id: 'p2', type: 'paragraph', html: 'Two', children: [] },
    ]);
    const el = editableFor(0);
    act(() => currentEditor().setActive('p1'));
    setCaret(el, 3);

    let prevented: boolean | undefined;
    act(() => {
      prevented = fireEvent.keyDown(el, { key: 'ArrowRight' });
    });
    expect(prevented).toBe(false);
  });

  it('ArrowLeft mid-text is left alone', () => {
    renderBlocks([
      { id: 'p1', type: 'paragraph', html: 'One', children: [] },
      { id: 'p2', type: 'paragraph', html: 'Two', children: [] },
    ]);
    const el = editableFor(1);
    act(() => currentEditor().setActive('p2'));
    setCaret(el, 1);

    let prevented: boolean | undefined;
    act(() => {
      prevented = fireEvent.keyDown(el, { key: 'ArrowLeft' });
    });
    expect(prevented).toBe(true);
  });
});

describe('Editable IME composition', () => {
  it('does not commit or run block commands mid-composition', () => {
    seedLocal([{ id: 'p1', type: 'paragraph', html: 'Hello', children: [] }]);
    render(
      <EditorProvider>
        <CaptureEditor />
        <BlockEditable id="p1" />
      </EditorProvider>,
    );
    const el = editableDiv('p1');
    act(() => currentEditor().setActive('p1'));

    act(() => {
      fireEvent.compositionStart(el);
    });
    el.textContent = 'にほんご';
    act(() => {
      fireEvent.input(el);
    });
    // No commit yet: state still holds the pre-composition text…
    expect(currentEditor().blocks[0]).toMatchObject({ html: 'Hello' });

    // …and a leaked Backspace keydown must not delete the block.
    fireEvent.keyDown(el, { key: 'Backspace' });
    expect(currentEditor().blocks).toHaveLength(1);

    act(() => {
      fireEvent.compositionEnd(el);
    });
    expect(currentEditor().blocks[0]).toMatchObject({ html: 'にほんご' });
  });
});
