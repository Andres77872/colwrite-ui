import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { createRef, useImperativeHandle } from 'react';
import type { Doc } from '@/editor/types';
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
const { PanelsContext } = await import('../panelsContextState');
const { ToastContext } = await import('@/components/ui/toastContext');
const { SourcesPanel } = await import('./SourcesPanel');

const editorRef = createRef<ReturnType<typeof useEditorProbe>>();

function Probe() {
  const editor = useEditorProbe();
  useImperativeHandle(editorRef, () => editor, [editor]);
  return null;
}

const DOC: Doc = {
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
  localStorage.setItem(`colwrite:ws:${TEST_WORKSPACE_ID}:doc:local`, JSON.stringify({ documentId: null, doc: DOC }));
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
