import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';
import type { Block, ParagraphBlock } from '../types';

vi.mock('@/services', () => ({
  createDocument: vi.fn(async () => ({ document_id: 'created-doc', version: 1 })),
  saveDocument: vi.fn(async () => ({ status: 'ok', message: '', version: 2 })),
  loadDocument: vi.fn(async () => ({ version: 1, blocks: [], name: 'Doc' })),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: vi.fn(async () => ({ documents: [], count: 0, status: 'ok', message: '' })),
}));

const { EditorProvider, useEditor } = await import('@/editor');

const editorRef = createRef<ReturnType<typeof useEditor>>();

function Capture() {
  const editor = useEditor();
  useImperativeHandle(editorRef, () => editor, [editor]);
  return null;
}

function editor() {
  if (!editorRef.current) throw new Error('not mounted');
  return editorRef.current;
}

function mount(blocks: Block[]) {
  localStorage.setItem('colwrite:doc:local', JSON.stringify({ documentId: null, doc: { version: 1, blocks } }));
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
    const [original, copy] = editor().blocks as ParagraphBlock[];
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

  it('edits code text as its own undo run', () => {
    mount([{ id: 'k', type: 'code', text: 'a' }]);
    act(() => editor().updateCodeText('k', 'ab'));
    act(() => editor().setCodeLanguage('k', 'python'));
    expect(editor().blocks[0]).toEqual({ id: 'k', type: 'code', text: 'ab', language: 'python' });
    act(() => editor().setCodeLanguage('k', null));
    expect(editor().blocks[0]).toEqual({ id: 'k', type: 'code', text: 'ab' });
  });
});
