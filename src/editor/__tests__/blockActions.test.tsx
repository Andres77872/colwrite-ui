import { itemAt, takeItems } from '@/lib/itemAt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { act, cleanup } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { createRef, useImperativeHandle } from 'react';
import type { Block, ParagraphBlock } from '../types';
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
const { useEditorProbe } = await import('./editorHarness');
const { replayFootprint } = await import('@/editor/docOps');

const editorRef = createRef<ReturnType<typeof useEditorProbe>>();

function Capture() {
  const editor = useEditorProbe();
  useImperativeHandle(editorRef, () => editor, [editor]);
  return null;
}

function editor() {
  if (!editorRef.current) throw new Error('not mounted');
  return editorRef.current;
}

function mount(blocks: Block[]) {
  localStorage.setItem(`colwrite:ws:${TEST_WORKSPACE_ID}:doc:local`, JSON.stringify({ documentId: null, doc: { version: 1, blocks } }));
  render(
    <EditorProvider>
      <Capture />
    </EditorProvider>,
  );
}

const para = (id: string, html = id, extra: Partial<ParagraphBlock> = {}): ParagraphBlock => ({
  id,
  type: 'paragraph',
  html,
  children: [],
  columns: 1,
  ...extra,
});

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('block actions', () => {
  it('replaces blocks in one undo step, in place', () => {
    mount([para('a'), para('b'), para('c')]);
    act(() => {
      editor().replaceBlocks(['b'], [para('x'), para('y')]);
    });
    expect(editor().blocks.map((b) => b.id)).toEqual(['a', 'x', 'y', 'c']);

    act(() => editor().undo());
    expect(editor().blocks.map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });

  it('never replaces a locked block', () => {
    mount([para('a'), para('b', 'b', { locked: true }), para('c')]);
    act(() => {
      editor().replaceBlocks(['a', 'b'], [para('x')]);
    });
    expect(editor().blocks.map((b) => b.id)).toEqual(['x', 'b', 'c']);
  });

  it('replaces the blank line it pastes into', () => {
    mount([para('a'), para('blank', ''), para('c')]);
    act(() => {
      editor().insertBlocksAfter('blank', [para('x'), para('y')], { replaceAnchor: true });
    });
    expect(editor().blocks.map((b) => b.id)).toEqual(['a', 'x', 'y', 'c']);
  });

  it('gives a duplicate fresh widget ids and drops equation labels', () => {
    mount([
      para('a', 'x <span data-child-id="e1" contenteditable="false"></span>', {
        children: [{ id: 'e1', type: 'equation', latex: 'x', display: true, labelId: 'eq:one' }],
      }),
    ]);
    let copyId: string | null = null;
    act(() => {
      copyId = editor().duplicateBlock('a');
    });
    const [original, copy] = takeItems(editor().blocks as ParagraphBlock[], 2);
    expect(copy.id).toBe(copyId);
    const copyChild = copy.children?.[0];
    expect(copyChild?.id).not.toBe('e1');
    expect(copy.html).toContain(`data-child-id="${copyChild?.id}"`);
    expect(copyChild).not.toHaveProperty('labelId');
    expect(original.children?.[0]).toMatchObject({ id: 'e1', labelId: 'eq:one' });
  });

  it('removes several blocks at once but keeps locked ones', () => {
    mount([para('a'), para('b', 'b', { locked: true }), para('c')]);
    act(() => editor().removeBlocks(['a', 'b', 'c']));
    expect(editor().blocks.map((b) => b.id)).toEqual(['b']);
  });

  it('turns a block into another kind, but not a locked one', () => {
    mount([para('a', 'Title'), para('b', 'Keep', { locked: true })]);
    act(() => {
      editor().setBlockKind('a', 'h1');
      editor().setBlockKind('b', 'h1');
    });
    expect(editor().blocks[0]).toEqual({ id: 'a', type: 'heading', level: 1, html: 'Title' });
    expect(editor().blocks[1]).toMatchObject({ type: 'paragraph', html: 'Keep' });
  });

  it('keeps block selection in document order and drops ids that left', () => {
    mount([para('a'), para('b'), para('c')]);
    act(() => editor().selectBlocks(['c', 'a']));
    expect(editor().selectedBlockIds).toEqual(['a', 'c']);
    act(() => editor().removeBlock('a'));
    expect(editor().selectedBlockIds).toEqual(['c']);
  });

  it('undoes an inserted widget in one step, leaving no entry without a placeholder', () => {
    mount([para('a', 'See here')]);
    const placed = 'See <span data-child-id="c1" contenteditable="false"></span> here';
    // The slash commands write the entry first and the html that places it second.
    act(() => {
      editor().addParagraphChild('a', { id: 'c1', type: 'equation', latex: 'x' });
      editor().updateHtml('a', placed);
    });
    expect(editor().blocks[0]).toMatchObject({ html: placed, children: [{ id: 'c1' }] });

    act(() => editor().undo());
    expect(editor().blocks[0]).toMatchObject({ html: 'See here', children: [] });
    expect(editor().canUndo).toBe(false);

    act(() => editor().redo());
    expect(editor().blocks[0]).toMatchObject({ html: placed, children: [{ id: 'c1' }] });
  });

  it('keeps typing after an inserted widget as a step of its own', () => {
    mount([para('a', 'See here')]);
    const placed = 'See <span data-child-id="c1" contenteditable="false"></span> here';
    act(() => {
      editor().addParagraphChild('a', { id: 'c1', type: 'equation', latex: 'x' });
      editor().updateHtml('a', placed);
    });
    act(() => editor().updateHtml('a', `${placed} and more`));

    act(() => editor().undo());
    expect(editor().blocks[0]).toMatchObject({ html: placed, children: [{ id: 'c1' }] });
    act(() => editor().undo());
    expect(editor().blocks[0]).toMatchObject({ html: 'See here', children: [] });
  });

  it('undoes a batch of edits in one step', () => {
    mount([para('a'), para('b'), para('c')]);
    act(() => {
      editor().batch(() => {
        editor().moveBlock('b', 1);
        editor().moveBlock('a', 1);
      });
    });
    expect(editor().blocks.map((b) => b.id)).toEqual(['c', 'a', 'b']);

    act(() => editor().undo());
    expect(editor().blocks.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(editor().canUndo).toBe(false);
  });

  it('records nothing for a batch that changed nothing', () => {
    mount([para('a')]);
    act(() => {
      editor().batch(() => undefined);
    });
    expect(editor().canUndo).toBe(false);
  });

  it('marks what an undo brought back so the author can see it', () => {
    mount([para('a'), para('b')]);
    act(() => editor().removeBlock('b'));
    act(() => editor().undo());
    expect(editor().recentlyChanged.has('b')).toBe(true);
  });

  it('edits code text as its own undo run', () => {
    mount([{ id: 'k', type: 'code', text: 'a' }]);
    act(() => editor().updateCodeText('k', 'ab'));
    act(() => editor().setCodeLanguage('k', 'python'));
    expect(editor().blocks[0]).toEqual({ id: 'k', type: 'code', text: 'ab', language: 'python' });
    act(() => editor().setCodeLanguage('k', null));
    expect(editor().blocks[0]).toEqual({ id: 'k', type: 'code', text: 'ab' });
  });
});

describe('replayFootprint', () => {
  const doc = (blocks: Block[]) => ({ version: 1, blocks });

  it('names the blocks that are new or different', () => {
    const a = para('a');
    const b = para('b');
    expect(replayFootprint(doc([a, b]), doc([a, { ...b, html: 'edited' }, para('c')]))).toEqual({
      changed: ['b', 'c'],
      near: null,
    });
  });

  it('points at the block before the first one that went away', () => {
    const [a, b, c] = [para('a'), para('b'), para('c')];
    expect(replayFootprint(doc([a, b, c]), doc([a, c]))).toEqual({ changed: [], near: 'a' });
  });

  it('points at the block after when the first block went away', () => {
    const [a, b] = [para('a'), para('b')];
    expect(replayFootprint(doc([a, b]), doc([b]))).toEqual({ changed: [], near: 'b' });
  });

  it('names the blocks that changed places', () => {
    const [a, b, c, d] = [para('a'), para('b'), para('c'), para('d')];
    expect(replayFootprint(doc([a, b, c, d]), doc([a, d, b, c]))).toEqual({ changed: ['d', 'b', 'c'], near: null });
  });

  it('names only the block that travelled when it passed many others', () => {
    const blocks = Array.from({ length: 12 }, (_, i) => para(`b${i}`));
    const moved = [...blocks.slice(1), itemAt(blocks, 0)];
    expect(replayFootprint(doc(blocks), doc(moved))).toEqual({ changed: ['b0'], near: null });
  });

  it('has nothing to show for a change outside the blocks', () => {
    const blocks = [para('a')];
    expect(replayFootprint({ blocks, name: 'One' }, { blocks, name: 'Two' })).toEqual({
      changed: [],
      near: null,
    });
  });
});
