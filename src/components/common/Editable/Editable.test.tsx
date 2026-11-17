import { itemAt } from '@/lib/itemAt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { createRef, Fragment, useImperativeHandle } from 'react';
import type { Block } from '@/editor/types';
import { TEST_WORKSPACE_ID, TestWorkspace } from '@/__tests__/workspace';
import type { ReactNode } from 'react';

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
const { Editable } = await import('./Editable');

const editorRef = createRef<ReturnType<typeof useEditorProbe>>();

function currentEditor() {
  if (!editorRef.current) throw new Error('Editor harness is not mounted');
  return editorRef.current;
}

function CaptureEditor() {
  const editor = useEditorProbe();
  useImperativeHandle(editorRef, () => editor, [editor]);
  return null;
}

/** Mirrors how Canvas renders an Editable: the html prop tracks editor state. */
function BlockEditable({ id }: { id: string }) {
  const { blocks } = useEditorProbe();
  const block = blocks.find((b): b is Block & { html: string } => b.id === id && 'html' in b);
  return <Editable id={id} html={block?.html ?? ''} />;
}

function seedLocal(blocks: Block[]) {
  localStorage.setItem(
    `colwrite:ws:${TEST_WORKSPACE_ID}:doc:local`,
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

  it('makes every block read-only for a viewer, and no key edits it (M6.UI-2)', () => {
    seedLocal([
      { id: 'p1', type: 'paragraph', html: 'A viewer reads this', children: [] },
      { id: 'p2', type: 'paragraph', html: 'And this', children: [] },
    ]);
    const asViewer = ({ children }: { children: ReactNode }) => (
      <TestWorkspace
        workspace={{ id: TEST_WORKSPACE_ID, name: 'Personal', kind: 'personal', role: 'viewer', icon: null, last_opened_at: null, member_count: 1 }}
        initialDocumentId={null}
      >
        {children}
      </TestWorkspace>
    );
    render(
      <EditorProvider>
        <CaptureEditor />
        <BlockEditable id="p1" />
      </EditorProvider>,
      { wrapper: asViewer },
    );
    const field = screen.getByRole('textbox', { name: 'Page text' });
    expect(field.getAttribute('contenteditable')).toBe('false');
    expect(field.getAttribute('aria-readonly')).toBe('true');
    expect(field.tabIndex).toBe(0);
    field.focus();
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.keyDown(field, { key: 'd', ctrlKey: true });
    fireEvent.keyDown(field, { key: 'Backspace' });
    expect(currentEditor().blocks.map((block) => block.id)).toEqual(['p1', 'p2']);
    expect(currentEditor().readOnly).toBe(true);
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
        [{ op: 'write_blocks', position: 'replace', blockId: 'p1', blocks: [{ id: 'p1', type: 'paragraph', html: 'Agent wrote this', children: [] }] }],
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
        [{ op: 'write_blocks', position: 'replace', blockId: 'p1', blocks: [{ id: 'p1', type: 'paragraph', html: 'Patched while inactive', children: [] }] }],
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
    const el = itemAt(els, 1);
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

describe('Editable block model (Notion-style keys)', () => {
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
    const el = document.querySelectorAll<HTMLDivElement>('.editable')[index];
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

  function block(id: string) {
    const found = currentEditor().blocks.find(b => b.id === id);
    if (!found) throw new Error(`Block ${id} missing`);
    return found;
  }

  it.each([
    ['##', { type: 'heading', level: 2, html: '' }],
    ['-', { type: 'paragraph', variant: 'bullet', html: '' }],
    ['1.', { type: 'paragraph', variant: 'numbered', html: '' }],
    ['[]', { type: 'paragraph', variant: 'todo', checked: false, html: '' }],
    ['>', { type: 'paragraph', variant: 'quote', html: '' }],
  ])('turns "%s " at the start of a line into its block', (prefix, expected) => {
    renderBlocks([{ id: 'p1', type: 'paragraph', html: prefix, children: [] }]);
    const el = editableFor(0);
    act(() => currentEditor().setActive('p1'));
    setCaret(el, prefix.length);

    let notPrevented: boolean | undefined;
    act(() => {
      notPrevented = fireEvent.keyDown(el, { key: ' ' });
    });

    expect(notPrevented).toBe(false);
    expect(block('p1')).toMatchObject(expected);
  });

  it('keeps the text after the caret when a shortcut converts the line', () => {
    renderBlocks([{ id: 'p1', type: 'paragraph', html: '-Item text', children: [] }]);
    const el = editableFor(0);
    act(() => currentEditor().setActive('p1'));
    setCaret(el, 1);
    act(() => {
      fireEvent.keyDown(el, { key: ' ' });
    });
    expect(block('p1')).toMatchObject({ variant: 'bullet', html: 'Item text' });
  });

  it('does not treat a space mid-sentence as a shortcut', () => {
    renderBlocks([{ id: 'p1', type: 'paragraph', html: 'Plan - done', children: [] }]);
    const el = editableFor(0);
    act(() => currentEditor().setActive('p1'));
    setCaret(el, 6);
    let notPrevented: boolean | undefined;
    act(() => {
      notPrevented = fireEvent.keyDown(el, { key: ' ' });
    });
    expect(notPrevented).toBe(true);
    expect(block('p1')).not.toHaveProperty('variant');
  });

  it('continues a list on Enter and leaves it on Enter in an empty item', () => {
    renderBlocks([{ id: 'p1', type: 'paragraph', html: 'Item', children: [], variant: 'bullet' } as Block]);
    const el = editableFor(0);
    act(() => currentEditor().setActive('p1'));
    setCaret(el, 4);
    act(() => {
      fireEvent.keyDown(el, { key: 'Enter' });
    });
    const [, next] = currentEditor().blocks;
    expect(next).toMatchObject({ type: 'paragraph', variant: 'bullet', html: '' });

    // Now Enter in that empty item turns it back into body text.
    cleanup();
    renderBlocks([{ id: 'e1', type: 'paragraph', html: '', children: [], variant: 'bullet' } as Block]);
    const empty = editableFor(0);
    act(() => currentEditor().setActive('e1'));
    setCaret(empty, 0);
    act(() => {
      fireEvent.keyDown(empty, { key: 'Enter' });
    });
    expect(block('e1')).not.toHaveProperty('variant');
  });

  it('outdents an empty nested item on Enter before leaving the list', () => {
    renderBlocks([
      { id: 'p1', type: 'paragraph', html: 'Parent', children: [], variant: 'bullet' } as Block,
      { id: 'p2', type: 'paragraph', html: '', children: [], variant: 'bullet', indent: 1 } as Block,
    ]);
    const el = editableFor(1);
    act(() => currentEditor().setActive('p2'));
    setCaret(el, 0);
    act(() => {
      fireEvent.keyDown(el, { key: 'Enter' });
    });
    expect(block('p2')).toMatchObject({ variant: 'bullet' });
    expect(block('p2')).not.toHaveProperty('indent');
  });

  it('nests with Tab under an item and never deeper than one level past it', () => {
    renderBlocks([
      { id: 'p1', type: 'paragraph', html: 'Parent', children: [], variant: 'bullet' } as Block,
      { id: 'p2', type: 'paragraph', html: 'Child', children: [], variant: 'bullet' } as Block,
    ]);
    const first = editableFor(0);
    act(() => currentEditor().setActive('p1'));
    setCaret(first, 0);
    let notPrevented: boolean | undefined;
    act(() => {
      notPrevented = fireEvent.keyDown(first, { key: 'Tab' });
    });
    // Consumed (focus stays in the document) but the first item cannot nest.
    expect(notPrevented).toBe(false);
    expect(block('p1')).not.toHaveProperty('indent');

    const second = editableFor(1);
    act(() => currentEditor().setActive('p2'));
    setCaret(second, 0);
    act(() => {
      fireEvent.keyDown(second, { key: 'Tab' });
    });
    act(() => {
      fireEvent.keyDown(second, { key: 'Tab' });
    });
    expect(block('p2')).toMatchObject({ indent: 1 });

    act(() => {
      fireEvent.keyDown(second, { key: 'Tab', shiftKey: true });
    });
    expect(block('p2')).not.toHaveProperty('indent');
  });

  it('turns a list item back into text on Backspace at its start', () => {
    renderBlocks([
      { id: 'p0', type: 'paragraph', html: 'Above', children: [] },
      { id: 'p1', type: 'paragraph', html: 'Item', children: [], variant: 'todo', checked: true } as Block,
    ]);
    const el = editableFor(1);
    act(() => currentEditor().setActive('p1'));
    setCaret(el, 0);
    act(() => {
      fireEvent.keyDown(el, { key: 'Backspace' });
    });
    expect(currentEditor().blocks).toHaveLength(2);
    expect(block('p1')).toMatchObject({ html: 'Item' });
    expect(block('p1')).not.toHaveProperty('variant');
    expect(block('p1')).not.toHaveProperty('checked');
  });

  it('opens a line above on Enter at the start of a heading, leaving the heading intact', () => {
    renderBlocks([{ id: 'h1', type: 'heading', level: 1, html: 'Title' }]);
    const el = editableFor(0);
    act(() => currentEditor().setActive('h1'));
    setCaret(el, 0);
    act(() => {
      fireEvent.keyDown(el, { key: 'Enter' });
    });
    const blocks = currentEditor().blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'paragraph', html: '' });
    expect(blocks[1]).toMatchObject({ id: 'h1', type: 'heading', html: 'Title' });
  });

  it('selects the block on Escape', () => {
    renderBlocks([{ id: 'p1', type: 'paragraph', html: 'Text', children: [] }]);
    const el = editableFor(0);
    act(() => {
      el.focus();
      currentEditor().setActive('p1');
    });
    act(() => {
      fireEvent.keyDown(el, { key: 'Escape' });
    });
    expect(currentEditor().selectedBlockIds).toEqual(['p1']);
  });

  it('does not merge into a locked block above', () => {
    renderBlocks([
      { id: 'p1', type: 'paragraph', html: 'Locked', children: [], locked: true },
      { id: 'p2', type: 'paragraph', html: 'Free', children: [] },
    ]);
    const el = editableFor(1);
    act(() => currentEditor().setActive('p2'));
    setCaret(el, 0);
    act(() => {
      fireEvent.keyDown(el, { key: 'Backspace' });
    });
    expect(currentEditor().blocks.map(b => b.id)).toEqual(['p1', 'p2']);
    expect(block('p1')).toMatchObject({ html: 'Locked' });
  });

  it('pulls the next block up on Delete at the end', () => {
    renderBlocks([
      { id: 'p1', type: 'paragraph', html: 'One', children: [] },
      { id: 'p2', type: 'paragraph', html: 'Two', children: [] },
    ]);
    const el = editableFor(0);
    act(() => currentEditor().setActive('p1'));
    setCaret(el, 3);
    act(() => {
      fireEvent.keyDown(el, { key: 'Delete' });
    });
    expect(currentEditor().blocks).toHaveLength(1);
    expect(block('p1')).toMatchObject({ html: 'OneTwo' });
  });
});

describe('Editable next to a block that a suggestion stands in place of', () => {
  type Kind = 'replace' | 'delete' | 'insert';

  /** Rows as the canvas lays them out: a pending change sits right under its block. */
  function renderPage(blocks: Block[], review: Record<string, Kind> = {}) {
    seedLocal(blocks);
    render(
      <EditorProvider>
        <CaptureEditor />
        <div className="blocks-container">
          {blocks.map(b => (
            <Fragment key={b.id}>
              <div className="block-row" data-block-id={b.id}>
                {'html' in b ? <BlockEditable id={b.id} /> : null}
              </div>
              {review[b.id] && (
                <div
                  className="review-change"
                  data-change-kind={review[b.id]}
                  data-testid={`review-${b.id}`}
                  tabIndex={-1}
                />
              )}
            </Fragment>
          ))}
        </div>
      </EditorProvider>,
    );
  }

  const paragraph = (id: string, html: string): Block => ({ id, type: 'paragraph', html, children: [] });
  const editableOf = (id: string) =>
    document.querySelector<HTMLDivElement>(`.block-row[data-block-id="${id}"] .editable`)!;
  const htmlOf = () => currentEditor().blocks.map(b => [b.id, 'html' in b ? b.html : '']);

  function setCaret(el: HTMLElement, offset: number) {
    const range = document.createRange();
    const text = el.firstChild;
    if (text) range.setStart(text, offset);
    else range.selectNodeContents(el);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function caretOffsetIn(el: HTMLElement): number | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(sel.anchorNode!, sel.anchorOffset);
    return pre.toString().length;
  }

  const nextFrame = () =>
    act(async () => {
      await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    });

  const page = [paragraph('p1', 'Above'), paragraph('p2', 'Being rewritten'), paragraph('p3', 'Below')];

  it.each<Kind>(['replace', 'delete'])(
    'Backspace under a pending %s keeps the text out of the hidden block and goes to the suggestion',
    (kind) => {
      renderPage(page, { p2: kind });
      const el = editableOf('p3');
      act(() => currentEditor().setActive('p3'));
      setCaret(el, 0);

      let notPrevented: boolean | undefined;
      act(() => {
        notPrevented = fireEvent.keyDown(el, { key: 'Backspace' });
      });

      expect(notPrevented).toBe(false);
      expect(htmlOf()).toEqual([['p1', 'Above'], ['p2', 'Being rewritten'], ['p3', 'Below']]);
      expect(document.activeElement).toBe(screen.getByTestId('review-p2'));
    },
  );

  it('Delete above a pending rewrite does not pull the hidden text up', () => {
    renderPage(page, { p2: 'replace' });
    const el = editableOf('p1');
    act(() => currentEditor().setActive('p1'));
    setCaret(el, 5);
    act(() => {
      fireEvent.keyDown(el, { key: 'Delete' });
    });
    expect(htmlOf()).toEqual([['p1', 'Above'], ['p2', 'Being rewritten'], ['p3', 'Below']]);
    expect(document.activeElement).toBe(screen.getByTestId('review-p2'));
  });

  it('arrow keys step over the hidden block in both directions', () => {
    renderPage(page, { p2: 'replace' });
    const first = editableOf('p1');
    const third = editableOf('p3');

    act(() => currentEditor().setActive('p1'));
    first.focus();
    setCaret(first, 5);
    act(() => {
      fireEvent.keyDown(first, { key: 'ArrowRight' });
    });
    expect(document.activeElement).toBe(third);

    setCaret(third, 0);
    act(() => {
      fireEvent.keyDown(third, { key: 'ArrowLeft' });
    });
    expect(document.activeElement).toBe(first);
  });

  it('a suggested insertion under a block hides nothing', () => {
    renderPage(page, { p2: 'insert' });
    const el = editableOf('p3');
    act(() => currentEditor().setActive('p3'));
    setCaret(el, 0);
    act(() => {
      fireEvent.keyDown(el, { key: 'Backspace' });
    });
    expect(htmlOf()).toEqual([['p1', 'Above'], ['p2', 'Being rewrittenBelow']]);
  });

  it('puts the caret where the two texts meet on the page, not in the html', async () => {
    // A trailing space is stored as an entity, and "&amp;" is one character.
    renderPage([paragraph('p1', 'R&amp;D&nbsp;'), paragraph('p2', 'costs')]);
    const el = editableOf('p2');
    act(() => currentEditor().setActive('p2'));
    setCaret(el, 0);
    act(() => {
      fireEvent.keyDown(el, { key: 'Backspace' });
    });
    await nextFrame();

    const merged = editableOf('p1');
    expect(merged.textContent).toBe('R&D\u00a0costs');
    expect(caretOffsetIn(merged)).toBe(4);
  });

  it('Delete at the end keeps the caret where it was', async () => {
    renderPage([paragraph('p1', 'One&nbsp;'), paragraph('p2', 'two')]);
    const el = editableOf('p1');
    act(() => currentEditor().setActive('p1'));
    el.focus();
    setCaret(el, 4);
    act(() => {
      fireEvent.keyDown(el, { key: 'Delete' });
    });
    await nextFrame();
    expect(editableOf('p1').textContent).toBe('One\u00a0two');
    expect(caretOffsetIn(editableOf('p1'))).toBe(4);
  });

  it('Delete before a divider removes the divider and nothing else', () => {
    renderPage([paragraph('p1', 'One'), { id: 'd1', type: 'divider' } as Block, paragraph('p2', 'Two')]);
    const el = editableOf('p1');
    act(() => currentEditor().setActive('p1'));
    setCaret(el, 3);
    act(() => {
      fireEvent.keyDown(el, { key: 'Delete' });
    });
    expect(htmlOf()).toEqual([['p1', 'One'], ['p2', 'Two']]);
  });

  it('Delete does not reach across a block that holds no text', () => {
    renderPage([
      paragraph('p1', 'One'),
      { id: 'c1', type: 'code', text: 'x = 1', language: 'python' } as Block,
      paragraph('p2', 'Two'),
    ]);
    const el = editableOf('p1');
    act(() => currentEditor().setActive('p1'));
    setCaret(el, 3);
    act(() => {
      fireEvent.keyDown(el, { key: 'Delete' });
    });
    expect(currentEditor().blocks.map(b => b.id)).toEqual(['p1', 'c1', 'p2']);
  });
});

describe('Editable at the edges of a block', () => {
  const paragraph = (id: string, html: string): Block => ({ id, type: 'paragraph', html, children: [] });

  // jsdom lays nothing out, so it has no scrollIntoView for the title to call.
  const scrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  function renderPage(blocks: Block[]) {
    seedLocal(blocks);
    render(
      <EditorProvider>
        <CaptureEditor />
        <span data-page-title="" contentEditable="plaintext-only" suppressContentEditableWarning>
          Title
        </span>
        <div className="blocks-container">
          {blocks.map(b => (
            <div key={b.id} className="block-row" data-block-id={b.id}>
              <BlockEditable id={b.id} />
            </div>
          ))}
        </div>
      </EditorProvider>,
    );
  }

  const editableOf = (id: string) =>
    document.querySelector<HTMLDivElement>(`.block-row[data-block-id="${id}"] .editable`)!;

  function select(el: HTMLElement, anchor: number, focus = anchor) {
    const text = el.firstChild!;
    el.focus();
    window.getSelection()?.setBaseAndExtent(text, anchor, text, focus);
  }

  it('goes up from the first block into the page title', () => {
    renderPage([paragraph('p1', 'First'), paragraph('p2', 'Second')]);
    const first = editableOf('p1');
    select(first, 0);
    fireEvent.keyDown(first, { key: 'ArrowLeft' });

    expect(document.activeElement).toBe(document.querySelector('[data-page-title]'));
  });

  it('does not jump to the title from a block further down', () => {
    renderPage([paragraph('p1', 'First'), paragraph('p2', 'Second')]);
    const second = editableOf('p2');
    select(second, 0);
    fireEvent.keyDown(second, { key: 'ArrowLeft' });

    expect(document.activeElement).toBe(editableOf('p1'));
  });

  it('turns Shift+Down at the end of the text into a block selection', () => {
    renderPage([paragraph('p1', 'First'), paragraph('p2', 'Second')]);
    const first = editableOf('p1');
    select(first, 2, 5);
    fireEvent.keyDown(first, { key: 'ArrowDown', shiftKey: true });

    expect(currentEditor().selectedBlockIds).toEqual(['p1']);
  });

  it('turns Shift+Up at the start of the text into a block selection', () => {
    renderPage([paragraph('p1', 'First'), paragraph('p2', 'Second')]);
    const second = editableOf('p2');
    select(second, 3, 0);
    fireEvent.keyDown(second, { key: 'ArrowUp', shiftKey: true });

    expect(currentEditor().selectedBlockIds).toEqual(['p2']);
  });

  it('leaves Shift+Arrow to the browser while there is text left to take', () => {
    renderPage([paragraph('p1', 'First'), paragraph('p2', 'Second')]);
    const first = editableOf('p1');
    select(first, 1, 3);
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true });
    act(() => {
      first.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(currentEditor().selectedBlockIds).toEqual([]);
  });
});

describe('Editable pasting as plain text', () => {
  function pasteInto(field: HTMLElement, data: { text?: string; html?: string }) {
    fireEvent.paste(field, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === 'text/plain' ? data.text ?? '' : type === 'text/html' ? data.html ?? '' : ''),
      },
    });
  }

  function mount() {
    seedLocal([{ id: 'p1', type: 'paragraph', html: 'Prose', children: [] }]);
    render(
      <EditorProvider>
        <CaptureEditor />
        <BlockEditable id="p1" />
      </EditorProvider>,
    );
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: typeof exec }).execCommand = exec;
    return { field: editableDiv('p1'), exec };
  }

  const copied = { html: '<p><b>Bold</b> <a href="https://example.org">words</a></p>', text: 'Bold words' };

  it('drops the formatting after Mod+Shift+V', () => {
    const { field, exec } = mount();
    fireEvent.keyDown(field, { key: 'V', ctrlKey: true, shiftKey: true });
    pasteInto(field, copied);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('insertText', false, 'Bold words');
    expect(currentEditor().blocks).toHaveLength(1);
  });

  it('pastes block markup inside a paragraph as the API stores it', () => {
    // The API's sanitizer output for the same html (`sanitize_inline_html`).
    const { field, exec } = mount();
    pasteInto(field, { html: '<div>Moved <b>here</b></div>', text: 'Moved here' });
    expect(exec).toHaveBeenLastCalledWith('insertHTML', false, '<span class="legacy-block">Moved <b>here</b></span>');
    pasteInto(field, { html: '<p dir="ltr" style="x">One <em>two</em></p>', text: 'One two' });
    expect(exec).toHaveBeenLastCalledWith('insertHTML', false, '<span class="legacy-block">One <em>two</em></span>');
  });

  it('goes back to a normal paste for the one after', () => {
    const { field, exec } = mount();
    fireEvent.keyDown(field, { key: 'V', ctrlKey: true, shiftKey: true });
    pasteInto(field, copied);
    exec.mockClear();
    pasteInto(field, { html: '<b>Bold</b>', text: 'Bold' });

    expect(exec).toHaveBeenCalledWith('insertHTML', false, expect.stringContaining('Bold'));
  });
});

describe('Editable given a file it cannot place', () => {
  function pasteInto(field: HTMLElement, data: { files: File[]; text?: string; html?: string }) {
    fireEvent.paste(field, {
      clipboardData: {
        files: data.files,
        getData: (type: string) => (type === 'text/plain' ? data.text ?? '' : type === 'text/html' ? data.html ?? '' : ''),
      },
    });
  }

  async function mountWithToasts() {
    const { ToastContext } = await import('@/components/ui/toastContext');
    const toast = vi.fn(() => 'toast-1');
    seedLocal([{ id: 'p1', type: 'paragraph', html: 'Prose', children: [] }]);
    render(
      <ToastContext.Provider value={{ toast, dismiss: vi.fn() }}>
        <EditorProvider>
          <CaptureEditor />
          <BlockEditable id="p1" />
        </EditorProvider>
      </ToastContext.Provider>,
    );
    return { toast, field: editableDiv('p1') };
  }

  it('says where a pasted picture can go instead of doing nothing', async () => {
    const { toast, field } = await mountWithToasts();
    pasteInto(field, { files: [new File(['x'], 'shot.png', { type: 'image/png' })], html: '<img src="blob:x">' });

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Pictures cannot go in the page yet',
      variant: 'warning',
    }));
    expect(currentEditor().blocks[0]).toMatchObject({ html: 'Prose' });
  });

  it('pastes the text when a copy carries both text and a file', async () => {
    const { toast, field } = await mountWithToasts();
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: typeof exec }).execCommand = exec;
    pasteInto(field, { files: [new File(['x'], 'cell.png', { type: 'image/png' })], text: 'a cell' });

    expect(toast).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith('insertText', false, 'a cell');
  });

  it('does not need a toast provider to take a paste', () => {
    seedLocal([{ id: 'p1', type: 'paragraph', html: 'Prose', children: [] }]);
    render(
      <EditorProvider>
        <BlockEditable id="p1" />
      </EditorProvider>,
    );
    expect(() => pasteInto(editableDiv('p1'), { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] })).not.toThrow();
  });
});
