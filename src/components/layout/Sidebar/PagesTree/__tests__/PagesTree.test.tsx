import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { HttpResponse, http, jsonOf, pathOf, recordRequests, server } from '@/__tests__/server';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { ToastProvider } from '@/components/ui/toast';
import { PanelsContext, type PanelsContextValue } from '@/components/panels/panelsContextState';
import { setLibraryDragPayload } from '@/components/panels/Library/collectionDnd';
import { documentKeys } from '@/data/documents';
import { workspaceKeys } from '@/data/workspaces';
import { FIXTURE_DOCUMENT_ID, TREE, TREE_PAGES, fixtures, moveElsewhere, workspaceDetail } from '@/dev/msw/fixtures';

const mocks = vi.hoisted(() => ({
  switchTo: vi.fn(),
  createAndSwitch: vi.fn(),
  flushPendingSave: vi.fn(async () => true),
  markPageTrashed: vi.fn(),
  markPageRestored: vi.fn(),
  newLocal: vi.fn(),
  confirm: vi.fn(),
  openSidebar: vi.fn(),
  editorState: {
    documentId: null as string | null,
    loadingDocumentId: null as string | null,
    doc: { name: '', blocks: [] } as { name?: string; blocks: never[] },
    lastSavedAt: null as number | null,
  },
}));

vi.mock('@/editor', () => {
  // One fake answers every slice the tree (and the page actions it uses) reads.
  const editor = () => ({
    switchTo: mocks.switchTo,
    createAndSwitch: mocks.createAndSwitch,
    flushPendingSave: mocks.flushPendingSave,
    markPageTrashed: mocks.markPageTrashed,
    markPageRestored: mocks.markPageRestored,
    newLocal: mocks.newLocal,
    documentId: mocks.editorState.documentId,
    loadingDocumentId: mocks.editorState.loadingDocumentId,
    creatingDocument: false,
    doc: mocks.editorState.doc,
    lastSavedAt: mocks.editorState.lastSavedAt,
  });
  return {
    DEFAULT_DOCUMENT_TITLE: 'Untitled page',
    focusPageTitle: () => true,
    useDocumentActions: editor,
    useDocumentSession: editor,
    useDocumentStatus: editor,
    useEditorDoc: editor,
  };
});

vi.mock('@/components/ui/confirmContext', () => ({
  useConfirm: () => mocks.confirm,
}));

const { PagesTree } = await import('../PagesTree');

const WS = TEST_WORKSPACE_ID;
const panels = { openSidebar: mocks.openSidebar } as unknown as PanelsContextValue;

function renderTree(props: { onPageOpened?: () => void } = {}) {
  return render(
    <ToastProvider>
      <PanelsContext.Provider value={panels}>
        <PagesTree {...props} />
      </PanelsContext.Provider>
    </ToastProvider>,
  );
}

/** The tree's rows as "level:name", names cut at their first extra word (a PDF count). */
function rowNames(): string[] {
  return screen.getAllByRole('treeitem').map((item) => {
    const name = item.querySelector('span.truncate, span.flex-1')?.textContent ?? item.textContent ?? '';
    return `${item.getAttribute('aria-level')}:${name.trim()}`;
  });
}

const row = (name: string) => screen.getAllByRole('treeitem').find((item) => {
  const label = item.querySelector('span.truncate')?.textContent ?? '';
  return label.trim() === name;
}) as HTMLElement;

async function findRow(name: string): Promise<HTMLElement> {
  await waitFor(() => expect(row(name)).toBeTruthy());
  return row(name);
}

async function expand(name: string) {
  fireEvent.click(within(await findRow(name)).getByRole('button', { name: `Expand ${name}` }));
}

/** Radix menus open on pointerdown, not click. */
function openMenu(name: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0, ctrlKey: false });
}

function fakeTransfer() {
  const values = new Map<string, string>();
  return {
    get types() { return [...values.keys()]; },
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? '',
    files: [] as unknown as FileList,
  } as unknown as DataTransfer;
}

/** Menus list their choices inline, as on a phone, rather than in a flyout. */
function phoneMenus() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('pointer: coarse'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

/** A drag event with a pointer position, which jsdom's own drag events do not carry. */
function dragAt(target: HTMLElement, type: 'dragover' | 'drop', dataTransfer: DataTransfer, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  act(() => {
    target.dispatchEvent(event);
  });
}

const moves = (sent: Request[]) => sent.filter((request) => request.method === 'POST' && /\/(move|reorder)$/.test(new URL(request.url).pathname));

beforeEach(() => {
  mocks.editorState.documentId = null;
  mocks.editorState.loadingDocumentId = null;
  mocks.editorState.doc = { name: '', blocks: [] };
  mocks.editorState.lastSavedAt = null;
  mocks.switchTo.mockReset().mockResolvedValue(true);
  mocks.createAndSwitch.mockReset().mockResolvedValue('new-page');
  mocks.flushPendingSave.mockClear();
  mocks.markPageTrashed.mockClear();
  mocks.markPageRestored.mockClear();
  mocks.newLocal.mockClear();
  mocks.confirm.mockReset().mockResolvedValue(false);
  mocks.openSidebar.mockReset();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PagesTree rows', () => {
  it('shows the top level as an APG tree: collections first, then pages, in the workspace’s order', async () => {
    phoneMenus();
    renderTree();
    await findRow('Scaling laws reading list');

    expect(rowNames()).toEqual([
      '1:Archive', '1:Lecture notes', '1:Reading notes', '1:Thesis',
      '1:Sparse Routing for Long-Context Pretraining', '1:Camera-ready edits (review in progress)',
      '1:Related work: conditional computation', '1:Rebuttal notes — ICLR', '1:Scaling laws reading list',
    ]);
    const items = screen.getAllByRole('treeitem');
    expect(items.map((item) => item.getAttribute('aria-posinset'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(new Set(items.map((item) => item.getAttribute('aria-setsize')))).toEqual(new Set(['9']));
    // Only collections can open; one row is the tab stop.
    expect(row('Thesis').getAttribute('aria-expanded')).toBe('false');
    expect(row('Rebuttal notes — ICLR').hasAttribute('aria-expanded')).toBe(false);
    expect(items.filter((item) => item.tabIndex === 0)).toHaveLength(1);

    openMenu('Page list options');
    const sorts = screen.getAllByRole('menuitemradio');
    expect(sorts.map((option) => option.textContent)).toEqual(['Name', 'Custom', 'Last edited']);
    expect(sorts[2]?.getAttribute('aria-checked')).toBe('true');
  });

  it('opens a collection to its collections, then its pages, one level deeper', async () => {
    renderTree();
    await expand('Thesis');

    await findRow('Outline');
    expect(rowNames()).toContain('2:Chapter 1');
    const thesisAt = rowNames().indexOf('1:Thesis');
    expect(rowNames().slice(thesisAt, thesisAt + 4)).toEqual(['1:Thesis', '2:Chapter 1', '2:Chapter 2', '2:Outline']);
    expect(row('Thesis').getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(row('Thesis'), { key: 'ArrowLeft' });
    await waitFor(() => expect(row('Outline')).toBeUndefined());
  });

  it('keeps each row to its title, with the update time in its tooltip', async () => {
    renderTree();
    const title = (await findRow('Rebuttal notes — ICLR')).querySelector('span.truncate');
    expect(title?.getAttribute('title')).toMatch(/Edited /);
    expect(screen.queryByText(/^Edited /)).toBeNull();
  });

  it('shows a page with no name of its own as a muted "Untitled"', async () => {
    const doc = fixtures.documents.get('66f0c0ffee0000000000d0c3');
    if (doc) doc.name = 'Untitled page';
    renderTree();

    const label = within(await findRow('Untitled')).getByText('Untitled');
    expect(label.className).toContain('text-muted-foreground');
    expect(screen.queryByText('Untitled page')).toBeNull();
  });

  it('moves to a row by typing the first letters of its name', async () => {
    renderTree();
    const archive = await findRow('Archive');
    archive.focus();

    fireEvent.keyDown(archive, { key: 'r' });
    await waitFor(() => expect(document.activeElement).toBe(row('Reading notes')));
    // Letters typed together are one name: "rel" goes on to "Related work".
    fireEvent.keyDown(row('Reading notes'), { key: 'e' });
    fireEvent.keyDown(row('Reading notes'), { key: 'l' });
    await waitFor(() => expect(document.activeElement).toBe(row('Related work: conditional computation')));
  });

  it('shows "Show more" as a row of the tree, which reads the rest of a long collection', async () => {
    renderTree();
    await expand('Lecture notes');
    await findRow('Lecture 50');

    const more = screen.getByRole('treeitem', { name: /Show more pages/ });
    expect(more.getAttribute('aria-selected')).toBe('false');
    expect(row('Lecture 51')).toBeUndefined();
    fireEvent.click(more);
    await findRow('Lecture 60');
    expect(screen.queryByRole('treeitem', { name: /Show more pages/ })).toBeNull();
  });

  it('says what an empty collection holds, and opens a collection’s PDFs in the Library', async () => {
    renderTree();
    await expand('Reading notes');

    expect(await screen.findByText('Nothing here yet. Drag pages here, or use Move to….')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show the 3 PDFs in Reading notes in the Library' }));
    expect(mocks.openSidebar).toHaveBeenCalledWith('library', { tab: 'library', collectionId: TREE.readingNotes });
  });

  it('reveals the open page deep in the tree and marks it as the current page', async () => {
    mocks.editorState.documentId = TREE_PAGES.methods;
    renderTree();

    const methods = await findRow('Methods');
    expect(methods.getAttribute('aria-level')).toBe('3');
    expect(methods.getAttribute('aria-current')).toBe('page');
    expect(methods.getAttribute('aria-selected')).toBe('true');
    expect(row('Chapter 2').getAttribute('aria-expanded')).toBe('true');
    // Not colour alone: the open row is also set in a heavier weight.
    expect(methods.className).toContain('font-medium');
  });

  it('remembers the open collections for the workspace, and keeps them when another page opens', async () => {
    const view = renderTree();
    await expand('Archive');
    await findRow('2025');
    expect(JSON.parse(localStorage.getItem(`colwrite:ws:${WS}:tree:expanded`) ?? '[]')).toEqual([TREE.archive]);

    // Opening another page reveals it; it does not fold the tree away (C-15).
    mocks.editorState.documentId = FIXTURE_DOCUMENT_ID;
    view.rerender(<ToastProvider><PanelsContext.Provider value={panels}><PagesTree /></PanelsContext.Provider></ToastProvider>);
    expect(row('2025')).toBeTruthy();

    cleanup();
    renderTree();
    await findRow('2025');
  });

  it('reads its open branches again when the tree moved elsewhere (tree_version)', async () => {
    const view = renderTree();
    await expand('Thesis');
    await findRow('Outline');
    await act(async () => view.queryClient.refetchQueries({ queryKey: workspaceKeys.detail(WS) }));

    moveElsewhere(TREE_PAGES.outline, TREE.archive);
    await act(async () => view.queryClient.refetchQueries({ queryKey: workspaceKeys.detail(WS) }));
    await waitFor(() => expect(row('Outline')).toBeUndefined());
  });
});

describe('PagesTree filter', () => {
  it('swaps the tree for workspace-wide results with their paths, and Escape brings it back', async () => {
    renderTree();
    const field = await screen.findByRole('searchbox', { name: 'Search pages' });
    fireEvent.change(field, { target: { value: 'Notes' } });

    const results = await screen.findByRole('list', { name: 'Matching pages' });
    expect(screen.queryByRole('tree')).toBeNull();
    await waitFor(() => {
      expect(within(results).getByText('Thesis › Chapter 1')).toBeTruthy();
      expect(within(results).getByText('Archive › 2025 › Spring term › Week 3 › Drafts')).toBeTruthy();
    });

    fireEvent.keyDown(field, { key: 'Escape' });
    expect(await screen.findByRole('tree', { name: 'Pages' })).toBeTruthy();
  });

  it('hides the filter in a small workspace until it is asked for, then focuses it', async () => {
    server.use(http.get('/workspaces/{workspace_id}', ({ response }) => {
      const workspace = fixtures.workspaces.get(WS);
      if (!workspace) throw new Error('no workspace');
      const detail = workspaceDetail(workspace);
      return response(200).json({ ...detail, counts: { ...detail.counts, pages: 3 } });
    }));
    renderTree();
    await findRow('Thesis');
    expect(screen.queryByRole('searchbox', { name: 'Search pages' })).toBeNull();

    openMenu('Page list options');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Filter pages' }));
    const field = await screen.findByRole('searchbox', { name: 'Search pages' });
    await waitFor(() => expect(document.activeElement).toBe(field));
  });
});

describe('PagesTree page actions', () => {
  it('patches the open page row after a save instead of listing again', async () => {
    mocks.editorState.documentId = '66f0c0ffee0000000000d0c3';
    const view = renderTree();
    await findRow('Rebuttal notes — ICLR');
    const sent = recordRequests();

    mocks.editorState.doc = { name: 'Rebuttal, revised', blocks: [] };
    mocks.editorState.lastSavedAt = Date.parse('2026-09-29T09:00:00Z');
    view.rerender(<ToastProvider><PanelsContext.Provider value={panels}><PagesTree /></PanelsContext.Provider></ToastProvider>);

    expect(await findRow('Rebuttal, revised')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.filter((request) => new URL(request.url).pathname.endsWith('/documents'))).toEqual([]);
  });

  it('keeps the rows when a refresh fails, says the server could not be reached, and retries', async () => {
    const view = renderTree();
    await findRow('Rebuttal notes — ICLR');
    server.use(http.get('/workspaces/{workspace_id}/documents', ({ response }) => response.untyped(HttpResponse.error()), { once: true }));

    await act(async () => view.queryClient.invalidateQueries({ queryKey: documentKeys.lists(WS) }));

    expect(await screen.findByText('The server could not be reached. Check your connection.')).toBeTruthy();
    expect(row('Rebuttal notes — ICLR')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Failed to fetch');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('The server could not be reached. Check your connection.')).toBeNull());
  });

  it('creates a page at the top level from the section’s "+", and in a collection from its row', async () => {
    renderTree();
    await findRow('Thesis');

    openMenu('Add a page or a collection');
    fireEvent.click(screen.getByRole('menuitem', { name: 'New page' }));
    await waitFor(() => expect(mocks.createAndSwitch).toHaveBeenCalledWith({ name: 'Untitled page', blocks: [] }, { collectionId: null }));

    fireEvent.click(within(row('Thesis')).getByRole('button', { name: 'New page in Thesis' }));
    await waitFor(() => expect(mocks.createAndSwitch).toHaveBeenLastCalledWith({ name: 'Untitled page', blocks: [] }, { collectionId: TREE.thesis }));
    // The row's own control does not open or fold the collection.
    expect(row('Thesis').getAttribute('aria-expanded')).toBe('false');
  });

  it('reports a failed create instead of failing silently', async () => {
    mocks.createAndSwitch.mockRejectedValueOnce(new Error('Quota reached'));
    renderTree();
    await findRow('Thesis');

    fireEvent.click(within(row('Thesis')).getByRole('button', { name: 'New page in Thesis' }));
    expect(await screen.findByText('Could not create the page')).toBeTruthy();
  });

  it('keeps current semantics on the committed row and marks only the pending row', async () => {
    mocks.editorState.documentId = '66f0c0ffee0000000000d0c2';
    mocks.editorState.loadingDocumentId = '66f0c0ffee0000000000d0c3';
    renderTree();

    const current = await findRow('Related work: conditional computation');
    const pending = row('Rebuttal notes — ICLR');
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(pending.getAttribute('aria-current')).toBeNull();
    expect(within(pending).getByText('Opening…')).toBeTruthy();

    openMenu('Actions for Related work: conditional computation');
    expect(screen.getByRole('menuitem', { name: /Move to Trash/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Open' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });

    fireEvent.click(pending);
    expect(mocks.switchTo).not.toHaveBeenCalled();
    fireEvent.click(row('Scaling laws reading list'));
    expect(mocks.switchTo).toHaveBeenCalledWith('66f0c0ffee0000000000d0c4');
  });

  it('moves a page to the Trash at once from its row menu, and Undo brings it back', async () => {
    renderTree();
    await findRow('Rebuttal notes — ICLR');

    openMenu('Actions for Rebuttal notes — ICLR');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Trash' }));

    // No confirmation: the Trash gives it back.
    expect(await screen.findByText('Moved Rebuttal notes — ICLR to Trash')).toBeTruthy();
    expect(mocks.confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(row('Rebuttal notes — ICLR')).toBeUndefined());
    expect(fixtures.documents.get('66f0c0ffee0000000000d0c3')?.deleted_at).toBeTruthy();
    // Not the open page: the editor stays where it is.
    expect(mocks.switchTo).not.toHaveBeenCalled();
    // Focus goes to the row that took its place.
    await waitFor(() => expect(document.activeElement?.textContent).toContain('Scaling laws reading list'));

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await findRow('Rebuttal notes — ICLR')).toBeTruthy();
    expect(fixtures.documents.get('66f0c0ffee0000000000d0c3')?.deleted_at).toBeNull();
  });

  it('shows what a collection takes with it before it goes to the Trash, from the menu or the Delete key', async () => {
    renderTree();
    const archive = await findRow('Archive');

    act(() => archive.focus());
    fireEvent.keyDown(archive, { key: 'Delete' });
    const dialog = await screen.findByRole('dialog', { name: 'Move Archive to Trash?' });
    expect(await within(dialog).findByText('Moves Archive, 4 collections and 1 page to Trash. You can restore them for 30 days.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to Trash' }));

    expect(await screen.findByText('Moved Archive to Trash')).toBeTruthy();
    await waitFor(() => expect(row('Archive')).toBeUndefined());
    expect(fixtures.collections.get(TREE.archive)?.trash_root_id).toBe(TREE.archive);
    expect(fixtures.documents.get(TREE_PAGES.draftsNotes)?.trash_root).toEqual({ kind: 'collection', id: String(TREE.archive) });

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await findRow('Archive')).toBeTruthy();
  });

  it('offers Move to Trash… in a collection’s menu', async () => {
    renderTree();
    await findRow('Thesis');
    openMenu('Actions for Thesis');
    fireEvent.click(screen.getByRole('menuitem', { name: /Move to Trash…/ }));
    expect(await screen.findByRole('dialog', { name: 'Move Thesis to Trash?' })).toBeTruthy();
  });

  it('dismisses a mobile drawer callback only after the requested page commits', async () => {
    const onPageOpened = vi.fn();
    renderTree({ onPageOpened });
    const rebuttal = await findRow('Rebuttal notes — ICLR');

    fireEvent.click(rebuttal);
    await waitFor(() => expect(onPageOpened).toHaveBeenCalledTimes(1));

    mocks.switchTo.mockRejectedValueOnce(new Error('No access'));
    fireEvent.click(row('Scaling laws reading list'));
    await waitFor(() => expect(mocks.switchTo).toHaveBeenCalledTimes(2));
    expect(onPageOpened).toHaveBeenCalledTimes(1);
  });
});

describe('PagesTree moves', () => {
  it('moves a page with Move to…, says so, puts focus back on it, and undoes with the new ETag', async () => {
    renderTree();
    await expand('Thesis');
    await findRow('Outline');
    const sent = recordRequests();

    openMenu('Actions for Outline');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move Outline' });
    // Its home is not a destination.
    const thesis = await within(dialog).findByRole('treeitem', { name: /Thesis/ });
    expect(thesis.getAttribute('aria-disabled')).toBe('true');
    expect(within(thesis).getByText('Already here')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('treeitem', { name: /Archive/ }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move here' }));
    });

    // The toast is a polite live region: it is the announcement.
    const toast = await screen.findByText('Moved Outline to Archive');
    expect(toast.closest('[aria-live="polite"]')).toBeTruthy();
    const [move] = moves(sent);
    expect(pathOf(move)).toBe(`/api/workspaces/${WS}/documents/${TREE_PAGES.outline}/move`);
    expect(move?.headers.get('If-Match')).toBe('"cwp:1"');
    expect(await jsonOf(move)).toEqual({ collection_id: TREE.archive });
    await waitFor(() => expect(document.activeElement).toBe(row('Outline')));
    expect(row('Outline').getAttribute('aria-level')).toBe('2');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(moves(sent)).toHaveLength(2));
    const undo = moves(sent)[1];
    expect(undo?.headers.get('If-Match')).toBe('"cwp:2"');
    expect(await jsonOf(undo)).toMatchObject({ collection_id: TREE.thesis });
    await waitFor(() => expect(fixtures.documents.get(TREE_PAGES.outline)?.collection_id).toBe(TREE.thesis));
  });

  it('reads the branches again and does not retry when someone moved the page first (412)', async () => {
    renderTree();
    await expand('Thesis');
    await findRow('Outline');
    moveElsewhere(TREE_PAGES.outline, TREE.chapter1);
    const sent = recordRequests();

    openMenu('Actions for Outline');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move Outline' });
    fireEvent.click(await within(dialog).findByRole('treeitem', { name: /Archive/ }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move here' }));
    });

    expect(await screen.findByText('This page was changed elsewhere. Try the move again.')).toBeTruthy();
    expect(moves(sent)).toHaveLength(1);
    await waitFor(() => expect(row('Outline')).toBeUndefined());
    expect(fixtures.documents.get(TREE_PAGES.outline)?.collection_id).toBe(TREE.chapter1);
  });

  it('moves a collection, never into itself or a collection inside it', async () => {
    renderTree();
    await findRow('Thesis');
    const sent = recordRequests();

    openMenu('Actions for Thesis');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move Thesis' });
    expect(within(dialog).getByRole('radio', { name: /Top level/ }).getAttribute('aria-disabled')).toBe('true');
    const self = await within(dialog).findByRole('treeitem', { name: /Thesis/ });
    expect(self.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(self).getByRole('button', { name: 'Expand Thesis' }));
    expect((await within(dialog).findByRole('treeitem', { name: /Chapter 1/ })).getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(within(dialog).getByRole('treeitem', { name: /Archive/ }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move here' }));
    });
    expect(await screen.findByText('Moved Thesis to Archive')).toBeTruthy();
    const [move] = moves(sent);
    expect(pathOf(move)).toBe(`/api/workspaces/${WS}/collections/${TREE.thesis}/move`);
    expect(move?.headers.get('If-Match')).toBe('"cwc:1"');
  });

  it('moves up and down in custom order, from the menu and from the keyboard', async () => {
    renderTree();
    await expand('Thesis');
    await findRow('Chapter 2');
    const sent = recordRequests();

    openMenu('Actions for Chapter 2');
    expect(screen.getByRole('menuitem', { name: /Move down/ }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: /Move up/ }));
    await waitFor(() => expect(moves(sent)).toHaveLength(1));
    expect(pathOf(moves(sent)[0])).toBe(`/api/workspaces/${WS}/collections/${TREE.chapter2}/reorder`);
    expect(await jsonOf(moves(sent)[0])).toEqual({ position: { before_id: TREE.chapter1 } });
    await waitFor(() => expect(rowNames().filter((name) => name.startsWith('2:Chapter'))).toEqual(['2:Chapter 2', '2:Chapter 1']));

    fireEvent.keyDown(row('Chapter 2'), { key: 'ArrowDown', altKey: true, shiftKey: true });
    await waitFor(() => expect(moves(sent)).toHaveLength(2));
    expect(await jsonOf(moves(sent)[1])).toEqual({ position: { after_id: TREE.chapter1 } });

    // The top level is ordered by its last edit here: nothing to move up or down.
    openMenu('Actions for Archive');
    expect(screen.queryByRole('menuitem', { name: /Move up/ })).toBeNull();
  });

  it('moves a dragged page onto a collection row, and to the top level on the heading', async () => {
    renderTree();
    await expand('Thesis');
    const outline = await findRow('Outline');
    const sent = recordRequests();

    const drag = fakeTransfer();
    fireEvent.dragStart(outline, { dataTransfer: drag });
    fireEvent.dragOver(row('Archive'), { dataTransfer: drag });
    expect(row('Archive').getAttribute('data-drop')).toBe('inside');
    fireEvent.drop(row('Archive'), { dataTransfer: drag });
    expect(await screen.findByText('Moved Outline to Archive')).toBeTruthy();
    expect(await jsonOf(moves(sent)[0])).toEqual({ collection_id: TREE.archive });

    const again = fakeTransfer();
    fireEvent.dragStart(await findRow('Outline'), { dataTransfer: again });
    const heading = screen.getByRole('heading', { name: 'Pages' }).parentElement as HTMLElement;
    fireEvent.dragOver(heading, { dataTransfer: again });
    fireEvent.drop(heading, { dataTransfer: again });
    expect(await screen.findByText('Moved Outline to the top level')).toBeTruthy();
    expect(await jsonOf(moves(sent)[1])).toEqual({ collection_id: null });
  });

  it('reorders by dropping in the gap between two rows of a home ordered by hand', async () => {
    renderTree();
    await expand('Thesis');
    await findRow('Chapter 2');
    const sent = recordRequests();
    const target = row('Chapter 1');
    target.getBoundingClientRect = () => ({ top: 0, height: 32, bottom: 32, left: 0, right: 200, width: 200, x: 0, y: 0, toJSON: () => ({}) });

    const drag = fakeTransfer();
    fireEvent.dragStart(row('Chapter 2'), { dataTransfer: drag });
    dragAt(target, 'dragover', drag, 2);
    expect(target.getAttribute('data-drop')).toBe('before');
    dragAt(target, 'drop', drag, 2);

    await waitFor(() => expect(moves(sent)).toHaveLength(1));
    expect(pathOf(moves(sent)[0])).toBe(`/api/workspaces/${WS}/collections/${TREE.chapter2}/reorder`);
    expect(await jsonOf(moves(sent)[0])).toEqual({ position: { before_id: TREE.chapter1 } });
  });

  it('moves a PDF dragged from the Library onto a collection row', async () => {
    renderTree();
    const thesis = await findRow('Thesis');
    const drag = fakeTransfer();
    setLibraryDragPayload(drag, { kind: 'resource', id: 41 });

    fireEvent.dragOver(thesis, { dataTransfer: drag });
    fireEvent.drop(thesis, { dataTransfer: drag });

    expect(await screen.findByText(/^Moved Switch Transformers.* to Thesis$/)).toBeTruthy();
    expect(fixtures.pdfs.find((pdf) => pdf.id === 41)?.collection_id).toBe(TREE.thesis);
  });
});

describe('PagesTree collection actions', () => {
  it('renames a collection in its row with F2, locked on its ETag', async () => {
    renderTree();
    const thesis = await findRow('Thesis');
    const sent = recordRequests();

    fireEvent.keyDown(thesis, { key: 'F2' });
    const field = await screen.findByRole('textbox', { name: 'Rename Thesis' });
    fireEvent.change(field, { target: { value: 'Dissertation' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await findRow('Dissertation');
    const patch = sent.find((request) => request.method === 'PATCH');
    expect(patch?.headers.get('If-Match')).toBe('"cwc:1"');
    expect(await jsonOf(patch)).toEqual({ name: 'Dissertation' });
  });

  it('switches on "Pages here can use these PDFs" and sorts a collection’s contents', async () => {
    // On a phone the sort choices are listed in the menu itself.
    phoneMenus();
    renderTree();
    await findRow('Thesis');

    openMenu('Actions for Thesis');
    const setting = screen.getByRole('menuitemcheckbox', { name: 'Pages here can use these PDFs' });
    expect(setting.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(setting);
    expect(await screen.findByText('Pages added to Thesis can now use its PDFs')).toBeTruthy();
    expect(fixtures.collections.get(TREE.thesis)?.grant_new_pages).toBe(true);

    openMenu('Actions for Thesis');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }));
    await waitFor(() => expect(fixtures.collections.get(TREE.thesis)?.sort_mode).toBe('name'));
  });

  it('creates a collection inside another, and shows it focused', async () => {
    renderTree();
    await findRow('Thesis');

    openMenu('Actions for Thesis');
    fireEvent.click(screen.getByRole('menuitem', { name: 'New collection inside' }));
    const dialog = await screen.findByRole('dialog', { name: 'New collection' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Appendix' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create collection' }));
    });

    const appendix = await findRow('Appendix');
    expect(appendix.getAttribute('aria-level')).toBe('2');
    await waitFor(() => expect(document.activeElement).toBe(row('Appendix')));
  });
});
