import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef, useImperativeHandle } from 'react';
import type { Doc } from '@/editor/types';

vi.mock('@/services', () => ({
  createDocument: vi.fn(async () => ({ document_id: 'created-doc', version: 1 })),
  saveDocument: vi.fn(async () => ({ status: 'ok', message: '', version: 2 })),
  loadDocument: vi.fn(async () => ({ version: 1, blocks: [], name: 'Doc' })),
  deleteDocument: vi.fn(async () => ({ status: 'ok', message: '' })),
  listDocuments: vi.fn(async () => ({ documents: [], count: 0, status: 'ok', message: '' })),
}));

const { EditorProvider, useEditor } = await import('@/editor');
const { PanelsContext } = await import('../panelsContextState');
const { ToastContext } = await import('@/components/ui/toastContext');
const { SourcesPanel } = await import('./SourcesPanel');

const editorRef = createRef<ReturnType<typeof useEditor>>();

function Probe() {
  const editor = useEditor();
  useImperativeHandle(editorRef, () => editor, [editor]);
  return null;
}

const DOC: Doc = {
  version: 1,
  name: 'Findings',
  sources: [
    { key: '10.1/cited', title: 'A cited paper', provider: 'crossref' },
    { key: '10.1/saved', title: 'A saved paper', provider: 'crossref' },
  ],
  blocks: [
    {
      id: 'p1',
      type: 'paragraph',
      html: 'Claim <span data-child-id="c1" contenteditable="false"></span> and again <span data-child-id="c2" contenteditable="false"></span>.',
      children: [
        { id: 'c1', type: 'citation', keys: ['10.1/cited'], style: 'numeric' },
        { id: 'c2', type: 'citation', keys: ['10.1/cited'], style: 'numeric' },
      ],
      columns: 1,
    },
  ],
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('colwrite:doc:local', JSON.stringify({ documentId: null, doc: DOC }));
});

afterEach(cleanup);

function renderPanel() {
  render(
    <EditorProvider>
      <PanelsContext.Provider value={{ intent: null } as never}>
        <ToastContext.Provider value={{ toast: vi.fn(() => 'toast'), dismiss: () => {} }}>
          <Probe />
          <SourcesPanel />
        </ToastContext.Provider>
      </PanelsContext.Provider>
    </EditorProvider>,
  );
}

function chooseRemove(title: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name: `Actions for ${title}` }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from sources' }));
}

describe('SourcesPanel', () => {
  it('says why a source that is still cited stays, instead of seeming to do nothing', async () => {
    renderPanel();
    chooseRemove('A cited paper');

    expect(await screen.findByText('Still cited 2 times: remove the citations first.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show where' })).toBeTruthy();
    expect(editorRef.current!.doc.sources?.map((source) => source.key)).toContain('10.1/cited');
  });

  it('removes a source that nothing cites', async () => {
    renderPanel();
    chooseRemove('A saved paper');

    await waitFor(() => expect(screen.queryByText('A saved paper')).toBeNull());
    expect(editorRef.current!.doc.sources?.map((source) => source.key)).toEqual(['10.1/cited']);
  });
});
