import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/__tests__/queryClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';
import { act } from 'react';
import { createTestQueryClient } from '@/__tests__/queryClient';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { setPagePlacement } from '@/data/documents';
import { TREE } from '@/dev/msw/fixtures';
import { http, pathOf, recordRequests, server } from '@/__tests__/server';
import { makeCollectionDetail } from '@/data/__tests__/resourceFixtures';
import type { DocumentStateResponse } from '@/api/schema';

/** A page's state as the trash and restore routes answer it. */
function pageState(documentId: string, overrides: Partial<DocumentStateResponse> = {}): DocumentStateResponse {
  return {
    document_id: documentId, workspace_id: TEST_WORKSPACE_ID, collection_id: null, sort_key: 'V', placement_etag: '"cwp:1"',
    head_seq: 3, revision_no: 3, revision_id: 'r3', current_revision_id: 'r3', created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z', deleted_at: null, purge_after: null,
    trash_root: overrides.deleted_at ? { kind: 'document', id: documentId } : null,
    duplicate: false, content: { schema_version: 1, name: 'Sparse routing', blocks: [] },
    ...overrides,
  };
}
import { useRevealRequests, type RevealRequest } from '@/components/layout/Sidebar/PagesTree/treeReveal';

/** Stands in for the sidebar tree: what it was asked to show. */
function RevealProbe({ onReveal }: { onReveal: (request: RevealRequest) => void }) {
  useRevealRequests(onReveal);
  return null;
}

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  toast: vi.fn(),
  focusPageTitle: vi.fn(),
  focusChange: vi.fn(),
  listDocuments: vi.fn(),
  createAndSwitch: vi.fn(),
  panels: {
    activePanel: 'assistant',
    isOpen: false,
    setPanel: vi.fn(),
    assistantOpen: false,
    toggleAssistant: vi.fn(),
    leftCollapsed: false,
    toggleLeftCollapsed: vi.fn(),
    setMobileNavOpen: vi.fn(),
    close: vi.fn(),
    isDesktop: false,
    panelsDocked: false,
  },
  sidebarDocked: true,
  proposals: { sets: [] as unknown[], pendingCount: 0 },
  editor: {
    doc: { name: 'Sparse routing', blocks: [] as unknown[] },
    blocks: [
      { id: 'p1', type: 'paragraph', html: 'Two words', children: [] },
      { id: 'p2', type: 'paragraph', html: 'and three more', children: [] },
    ],
    documentId: 'doc-1' as string | null,
    loadingDocumentId: null as string | null,
    lastSavedAt: null as number | null,
    isAutoSaving: false,
    saveError: null as string | null,
    saveConflict: false,
    unsavedDraftAt: null as number | null,
    inTrash: null as null | { trashRoot: { kind: 'document' | 'collection'; id: string }; purgeAfter: string | null },
    readOnly: false,
    editsKeptReadOnly: false,
    resolveSaveConflict: vi.fn(async (_keep: 'mine' | 'theirs') => undefined),
    restoreKeptDraft: vi.fn(() => true),
    discardKeptDraft: vi.fn(),
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
    save: vi.fn(),
    flushPendingSave: vi.fn(async () => true),
    switchTo: vi.fn(async (_id: string) => true),
    newLocal: vi.fn(),
    markPageTrashed: vi.fn(),
    markPageRestored: vi.fn(),
    setCitationStyle: vi.fn(),
    hasPendingEdits: vi.fn(),
  },
}));

vi.mock('@/editor', async (importOriginal) => {
  // One fake answers every slice the top bar and its menus read; the rest
  // (the citation styles the page menu lists) is the editor's own.
  const editor = () => ({ ...mocks.editor, createAndSwitch: mocks.createAndSwitch });
  return {
    ...(await importOriginal<typeof import('@/editor')>()),
    DEFAULT_DOCUMENT_TITLE: 'Untitled page',
    focusPageTitle: () => true,
    useDocumentActions: editor,
    useDocumentId: () => mocks.editor.documentId,
    useDocumentSession: editor,
    useDocumentStatus: editor,
    useEditorActions: editor,
    useEditorDoc: editor,
    useEditorView: editor,
    usePageReadOnly: () => mocks.editor.readOnly,
    useDocumentTitle: () => ({
      title: mocks.editor.doc.name || 'Untitled page',
      isUntitled: !mocks.editor.doc.name,
      focusPageTitle: mocks.focusPageTitle,
    }),
  };
});
vi.mock('@/editor/proposalsContextState', () => ({
  useProposals: () => ({ ...mocks.proposals, focusChange: mocks.focusChange }),
}));
vi.mock('@/editor/proposals', () => ({
  pendingInDocumentOrder: () => [
    { id: 'change-1', kind: 'replace', op: { newInformation: false } },
    { id: 'change-2', kind: 'insert', op: { newInformation: false } },
  ],
  describeChange: (change: { id: string }) => `Describe ${change.id}`,
  groupChanges: () => [],
  wordingChanges: () => [],
}));
vi.mock('@/components/panels/panelsContextState', () => ({
  usePanels: () => mocks.panels,
}));
vi.mock('@/components/layout/useShellLayout', () => ({
  useSidebarToggle: () => ({
    docked: mocks.sidebarDocked,
    visible: !mocks.sidebarDocked || mocks.panels.leftCollapsed,
    open: mocks.sidebarDocked ? mocks.panels.toggleLeftCollapsed : () => mocks.panels.setMobileNavOpen(true),
  }),
}));
vi.mock('@/components/ui/confirmContext', () => ({
  useConfirm: () => mocks.confirm,
}));
vi.mock('@/components/ui/toastContext', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('./DocumentExportDialog', () => ({
  DocumentExportDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Export page" /> : null),
}));

const { PageTopbar } = await import('./PageTopbar');

function renderTopbar() {
  return render(
    <TooltipProvider>
      <PageTopbar />
    </TooltipProvider>,
  );
}

/** Radix menus open on pointerdown, not click. */
function openPageMenu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Page options' }), { button: 0, ctrlKey: false });
}

beforeEach(() => {
  // The page list's request: the page menu must not need it.
  mocks.listDocuments.mockReset().mockResolvedValue({});
  mockDocumentList((body) => mocks.listDocuments(body));
  mocks.confirm.mockReset().mockResolvedValue(false);
  mocks.toast.mockReset();
  mocks.focusPageTitle.mockReset().mockReturnValue(true);
  mocks.focusChange.mockReset();
  mocks.createAndSwitch.mockReset().mockResolvedValue('new-doc');
  Object.assign(mocks.panels, {
    activePanel: 'assistant',
    isOpen: false,
    assistantOpen: false,
    leftCollapsed: false,
    isDesktop: false,
    panelsDocked: false,
  });
  mocks.panels.setPanel.mockReset();
  mocks.panels.close.mockReset();
  mocks.panels.toggleAssistant.mockReset();
  mocks.panels.toggleLeftCollapsed.mockReset();
  mocks.panels.setMobileNavOpen.mockReset();
  mocks.sidebarDocked = true;
  mocks.proposals.pendingCount = 0;
  Object.assign(mocks.editor, {
    documentId: 'doc-1',
    lastSavedAt: null,
    isAutoSaving: false,
    saveError: null,
    saveConflict: false,
    unsavedDraftAt: null,
    inTrash: null,
    readOnly: false,
    editsKeptReadOnly: false,
    canUndo: false,
    canRedo: false,
  });
  mocks.editor.resolveSaveConflict.mockReset().mockResolvedValue(undefined);
  mocks.editor.restoreKeptDraft.mockReset().mockReturnValue(true);
  mocks.editor.discardKeptDraft.mockReset();
  mocks.editor.doc = { name: 'Sparse routing', blocks: [] };
  mocks.editor.undo.mockReset();
  mocks.editor.save.mockReset();
  for (const action of [mocks.editor.flushPendingSave, mocks.editor.switchTo, mocks.editor.newLocal, mocks.editor.markPageTrashed, mocks.editor.markPageRestored]) {
    action.mockClear();
  }
  mocks.editor.setCitationStyle.mockReset();
  mocks.editor.hasPendingEdits.mockReset().mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PageTopbar', () => {
  it('has no Save, New or Delete buttons of its own — autosave and the page menu cover them', () => {
    renderTopbar();

    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /new document/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('moves the caret into the in-page title from the breadcrumb, which says nothing about renaming', () => {
    renderTopbar();

    const breadcrumb = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    const title = breadcrumb.getByRole('button', { name: /Sparse routing/ });
    expect(title.getAttribute('aria-current')).toBe('page');
    expect(title.getAttribute('title')).toBeNull();
    fireEvent.click(title);
    expect(mocks.focusPageTitle).toHaveBeenCalledTimes(1);
  });

  it('shows where the page lives: the workspace, its collections, then the page', async () => {
    const queryClient = createTestQueryClient();
    setPagePlacement(queryClient, TEST_WORKSPACE_ID, {
      documentId: 'doc-1', collectionId: TREE.chapter2, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null,
    });
    render(<TooltipProvider><PageTopbar /></TooltipProvider>, { queryClient });

    const breadcrumb = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(await breadcrumb.findByRole('button', { name: 'Chapter 2' })).toBeTruthy();
    expect(breadcrumb.getByRole('button', { name: 'Thesis' })).toBeTruthy();
    expect(breadcrumb.getByText('Personal')).toBeTruthy();

    // A move this tab made is in the cache at once: the path follows it.
    act(() => setPagePlacement(queryClient, TEST_WORKSPACE_ID, {
      documentId: 'doc-1', collectionId: null, sortKey: 'W', placementEtag: '"cwp:2"', treeVersion: 3,
    }));
    await waitFor(() => expect(breadcrumb.queryByRole('button', { name: 'Chapter 2' })).toBeNull());
    expect(breadcrumb.getByText('Personal')).toBeTruthy();
  });

  it('shows a collection crumb in the sidebar tree, opening a collapsed sidebar first', async () => {
    mocks.panels.leftCollapsed = true;
    const queryClient = createTestQueryClient();
    setPagePlacement(queryClient, TEST_WORKSPACE_ID, {
      documentId: 'doc-1', collectionId: TREE.chapter2, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null,
    });
    const requests: unknown[] = [];
    const { unmount } = render(<TooltipProvider><PageTopbar /><RevealProbe onReveal={(request) => requests.push(request)} /></TooltipProvider>, { queryClient });

    fireEvent.click(await screen.findByRole('button', { name: 'Thesis' }));
    expect(mocks.panels.toggleLeftCollapsed).toHaveBeenCalled();
    expect(requests).toEqual([{ kind: 'collection', id: TREE.thesis, expand: true, focus: true }]);
    unmount();
  });

  it('says when edits are waiting for autosave, and when they are being saved', () => {
    mocks.editor.hasPendingEdits.mockReturnValue(true);
    const { rerender } = renderTopbar();
    expect(screen.getByText('Unsaved')).toBeTruthy();

    mocks.editor.isAutoSaving = true;
    rerender(
      <TooltipProvider>
        <PageTopbar />
      </TooltipProvider>,
    );
    expect(screen.getByText('Saving…')).toBeTruthy();
  });

  it('makes a failed save loud and retryable, and says so in the bar rather than a toast', () => {
    mocks.editor.saveError = 'Server unavailable';
    renderTopbar();

    expect(screen.getByText('Not saved')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.editor.save).toHaveBeenCalledTimes(1);
    // A toast leaves; this has to stay until it is fixed.
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Not saved. Server unavailable');
  });

  it('announces a failure and the recovery, not every autosave', () => {
    mocks.editor.hasPendingEdits.mockReturnValue(true);
    const view = () => (
      <TooltipProvider>
        <PageTopbar />
      </TooltipProvider>
    );
    const { rerender } = render(view());
    const announcer = () => screen.getByRole('status');
    expect(announcer().textContent).toBe('');

    mocks.editor.isAutoSaving = true;
    rerender(view());
    mocks.editor.isAutoSaving = false;
    mocks.editor.hasPendingEdits.mockReturnValue(false);
    rerender(view());
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(announcer().textContent).toBe('');

    mocks.editor.saveError = 'Server unavailable';
    rerender(view());
    expect(announcer().textContent).toBe('Not saved. Server unavailable');

    mocks.editor.saveError = null;
    rerender(view());
    expect(announcer().textContent).toBe('Saving is working again.');
  });

  it('does not announce a recovery when another document opens', () => {
    mocks.editor.saveError = 'Server unavailable';
    const view = () => (
      <TooltipProvider>
        <PageTopbar />
      </TooltipProvider>
    );
    const { rerender } = render(view());
    mocks.editor.saveError = null;
    mocks.editor.documentId = 'doc-2';
    rerender(view());
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('keeps the save state on phones as an icon with the same words', () => {
    renderTopbar();
    const label = screen.getByText('Saved');
    // Read out everywhere, drawn as an icon below the `sm` breakpoint.
    expect(label.className).toContain('max-sm:sr-only');
    expect(label.parentElement?.querySelector('svg')).toBeTruthy();
    expect(label.parentElement?.className).not.toContain('max-sm:hidden');
  });

  it('asks which version to keep when the server holds a newer one', async () => {
    mocks.editor.saveError = 'This page was changed somewhere else, so your latest edits are not saved yet.';
    mocks.editor.saveConflict = true;
    renderTopbar();

    const bar = screen.getByRole('alert');
    expect(bar.textContent).toMatch(/changed somewhere else/i);
    // Retrying the same save cannot work, so it is not offered.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    fireEvent.click(within(bar).getByRole('button', { name: 'Keep my version' }));
    expect(mocks.editor.resolveSaveConflict).toHaveBeenCalledWith('mine');
    await waitFor(() => expect(within(bar).getByRole('button', { name: 'Keep my version' })).toBeTruthy());

    fireEvent.click(within(bar).getByRole('button', { name: 'Open the newer version' }));
    expect(mocks.editor.resolveSaveConflict).toHaveBeenLastCalledWith('theirs');
  });

  it('offers edits that never reached the server, and lets them go', () => {
    mocks.editor.unsavedDraftAt = new Date(2026, 10, 3, 14, 32).getTime();
    renderTopbar();

    const bar = screen.getByText(/were never saved/i).closest('div') as HTMLElement;
    expect(bar.textContent).toMatch(/Edits from .*3.*:32/);
    fireEvent.click(within(bar).getByRole('button', { name: 'Bring them back' }));
    expect(mocks.editor.restoreKeptDraft).toHaveBeenCalledTimes(1);
    fireEvent.click(within(bar).getByRole('button', { name: 'Discard' }));
    expect(mocks.editor.discardKeptDraft).toHaveBeenCalledTimes(1);
  });

  it('opens the right sidebar tabs and shows which one is showing', () => {
    mocks.panels.isOpen = true;
    mocks.panels.activePanel = 'sources';
    renderTopbar();

    expect(screen.getByRole('button', { name: 'Sources' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Research' }));
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(mocks.panels.setPanel.mock.calls).toEqual([['research'], ['history']]);

    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    expect(mocks.panels.toggleAssistant).toHaveBeenCalledTimes(1);
  });

  it('closes the right sidebar when its own tab button is pressed again, like Ask AI', () => {
    mocks.panels.isOpen = true;
    mocks.panels.activePanel = 'history';
    renderTopbar();

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(mocks.panels.close).toHaveBeenCalledTimes(1);
    expect(mocks.panels.setPanel).not.toHaveBeenCalled();
  });

  it('leaves the tab buttons to the docked sidebar’s own tab strip while it is open', () => {
    mocks.panels.isOpen = true;
    mocks.panels.isDesktop = true;
    mocks.panels.panelsDocked = true;
    mocks.panels.activePanel = 'sources';
    renderTopbar();

    expect(screen.queryByRole('button', { name: 'Sources' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Research' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ask AI' })).toBeTruthy();
  });

  it('calls a page with no name of its own "Untitled", muted, as the page title does', () => {
    mocks.editor.doc = { name: '', blocks: [] };
    renderTopbar();

    const breadcrumb = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    const label = breadcrumb.getByText('Untitled');
    expect(label.className).toContain('text-muted-foreground');
    expect(breadcrumb.queryByText('Untitled page')).toBeNull();
  });

  it('offers a way back to a collapsed sidebar, and a drawer on narrow screens', () => {
    const { rerender } = renderTopbar();
    expect(screen.queryByRole('button', { name: 'Open sidebar' })).toBeNull();

    mocks.panels.leftCollapsed = true;
    rerender(
      <TooltipProvider>
        <PageTopbar />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));
    expect(mocks.panels.toggleLeftCollapsed).toHaveBeenCalledTimes(1);

    mocks.sidebarDocked = false;
    mocks.panels.leftCollapsed = false;
    rerender(
      <TooltipProvider>
        <PageTopbar />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));
    expect(mocks.panels.setMobileNavOpen).toHaveBeenCalledWith(true);
  });

  it('shows pending AI suggestions and reviews them from its menu', () => {
    mocks.proposals.pendingCount = 2;
    renderTopbar();

    // The pill is the page's one review indicator; its menu holds the stepper,
    // the list and the batch actions that used to float over the text.
    fireEvent.click(screen.getByRole('button', { name: /2 suggestions/ }));
    const menu = screen.getByRole('dialog', { name: 'Suggested changes' });
    expect(within(menu).getByText('– of 2')).toBeTruthy();
    expect(within(menu).getByRole('button', { name: 'Accept all' })).toBeTruthy();
    expect(within(menu).getByRole('button', { name: 'Reject all' })).toBeTruthy();

    fireEvent.click(within(menu).getByRole('button', { name: 'Next change' }));
    expect(mocks.focusChange).toHaveBeenCalledWith('change-1');
    fireEvent.click(within(menu).getByRole('button', { name: 'Describe change-2' }));
    expect(mocks.focusChange).toHaveBeenLastCalledWith('change-2');
  });
});

describe('Page menu', () => {
  it('lists the page actions in order, with the word count as its footer', () => {
    renderTopbar();
    openPageMenu();

    const names = screen
      .getAllByRole('menuitem')
      .filter((item) => !item.classList.contains('sm:hidden'))
      .map((item) => item.textContent?.replace(/(Developer|⌘.*|Ctrl.*)$/, '').trim());
    expect(names).toEqual([
      'Copy link',
      'Move to…',
      'Copy to workspace…',
      'Export…',
      'Version history',
      'AI use…',
      'Assistant instructions…',
      'Document JSON',
      'Citation style',
      'Style',
      'Undo',
      'Redo',
      'Move to Trash',
    ]);
    expect(screen.getByText('5 words')).toBeTruthy();
  });

  it('offers a viewer only what reads: no move, copy out, citation style, undo or Trash (M6.UI-2)', () => {
    Object.assign(mocks.editor, { readOnly: true });
    renderTopbar();
    // No save state for a page that is never saved: "View only" in its place.
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByLabelText(/^View only\. You’re a viewer in Personal/)).toBeTruthy();
    openPageMenu();
    const names = screen
      .getAllByRole('menuitem')
      .filter((item) => !item.classList.contains('sm:hidden'))
      .map((item) => item.textContent?.replace(/(Developer|⌘.*|Ctrl.*)$/, '').trim());
    expect(names).toEqual(['Copy link', 'Export…', 'Version history', 'AI use…', 'Document JSON', 'Style']);
  });

  it('says when the role changed under unsaved edits, which stay on this device', () => {
    Object.assign(mocks.editor, { readOnly: true, editsKeptReadOnly: true, saveConflict: true });
    renderTopbar();
    expect(screen.getByRole('status').textContent).toMatch(/You can only view this page now\..*kept on this device/);
    // The conflict question is not a viewer's to answer.
    expect(screen.queryByRole('button', { name: /keep my version/i })).toBeNull();
  });

  it('keeps the page style switches inside Style', async () => {
    renderTopbar();
    openPageMenu();
    const style = screen.getByRole('menuitem', { name: 'Style' });
    fireEvent.keyDown(style, { key: 'ArrowRight' });
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Full width' })).toBeTruthy();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Small text' })).toBeTruthy();
  });

  it('copies a clean link to the page, without the view or a block anchor', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    window.history.replaceState(null, '', '/?doc=doc-1&view=settings#block-7');
    try {
      renderTopbar();
      openPageMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?doc=doc-1`));
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('keeps undo and redo disabled until there is something to undo', () => {
    renderTopbar();
    openPageMenu();
    expect(screen.getByRole('menuitem', { name: /^Undo/ }).getAttribute('aria-disabled')).toBe('true');
    cleanup();

    mocks.editor.canUndo = true;
    renderTopbar();
    openPageMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Undo/ }));
    expect(mocks.editor.undo).toHaveBeenCalledTimes(1);
  });

  it('opens the export dialog and the history and JSON tabs', () => {
    renderTopbar();
    openPageMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export…' }));
    expect(screen.getByRole('dialog', { name: 'Export page' })).toBeTruthy();

    openPageMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Version history' }));
    openPageMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Document JSON/ }));
    expect(mocks.panels.setPanel.mock.calls).toEqual([['history'], ['json']]);
  });

  it('leaves creating a page to the sidebar and the palette', () => {
    renderTopbar();
    openPageMenu();
    expect(screen.queryByRole('menuitem', { name: 'New page' })).toBeNull();
  });

  it('moves the page to the Trash at once, saving it first, then opens the next page, with Undo', async () => {
    const sent = recordRequests();
    server.use(
      http.post('/workspaces/{workspace_id}/documents/{document_id}/trash', ({ params, response }) =>
        response(200).json(pageState(params.document_id, { deleted_at: '2026-11-15T10:00:00Z', purge_after: '2026-12-15T10:00:00Z' }))),
      http.post('/workspaces/{workspace_id}/documents/{document_id}/restore', ({ params, response }) =>
        response(200).json(pageState(params.document_id))),
    );
    mocks.listDocuments.mockResolvedValue({ documents: [{ id: 'doc-1' }, { id: 'doc-2', name: 'Next page' }] });
    renderTopbar();
    openPageMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Trash' }));

    await waitFor(() => expect(mocks.editor.switchTo).toHaveBeenCalledWith('doc-2'));
    // No confirmation: the Trash gives it back.
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.editor.flushPendingSave).toHaveBeenCalled();
    const trash = sent.find((request) => request.method === 'POST' && pathOf(request).endsWith('/documents/doc-1/trash'));
    expect(trash?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(mocks.editor.markPageTrashed).toHaveBeenCalledWith('doc-1', {
      trashRoot: { kind: 'document', id: 'doc-1' },
      purgeAfter: '2026-12-15T10:00:00Z',
    });
    const toast = mocks.toast.mock.calls.at(-1)?.[0] as { title: string; action?: { label: string; onSelect: () => void } };
    expect(toast).toMatchObject({ title: 'Moved Sparse routing to Trash', action: { label: 'Undo' } });

    // Undo restores it and opens it again.
    act(() => toast.action?.onSelect());
    await waitFor(() => expect(mocks.editor.switchTo).toHaveBeenLastCalledWith('doc-1'));
    expect(sent.some((request) => request.method === 'POST' && pathOf(request).endsWith('/documents/doc-1/restore'))).toBe(true);
    expect(mocks.editor.markPageRestored).toHaveBeenCalledWith('doc-1');
  });

  it('cannot move a draft that was never saved to the server, or a page already there, to the Trash', () => {
    mocks.editor.documentId = null;
    renderTopbar();
    openPageMenu();
    expect(screen.getByRole('menuitem', { name: 'Move to Trash' }).getAttribute('aria-disabled')).toBe('true');
    cleanup();

    mocks.editor.documentId = 'doc-1';
    mocks.editor.inTrash = { trashRoot: { kind: 'document', id: 'doc-1' }, purgeAfter: null };
    renderTopbar();
    openPageMenu();
    expect(screen.getByRole('menuitem', { name: 'Move to Trash' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('a page in the Trash', () => {
  it('says so in a bar with Restore, which brings it back, and the save readout says it is not saving', async () => {
    const sent = recordRequests();
    server.use(http.post('/workspaces/{workspace_id}/documents/{document_id}/restore', ({ params, response }) =>
      response(200).json(pageState(params.document_id))));
    mocks.editor.inTrash = { trashRoot: { kind: 'document', id: 'doc-1' }, purgeAfter: new Date(Date.now() + 3 * 86_400_000).toISOString() };
    renderTopbar();

    const bar = screen.getByRole('alert');
    expect(within(bar).getByText('This page is in the Trash.')).toBeTruthy();
    expect(bar.textContent).toContain('Changes are not saved until it is restored. Deleted forever in 3 days.');
    expect(screen.getByText('In the Trash')).toBeTruthy();
    // The save-conflict bar waits behind it.
    expect(screen.queryByText('This page was changed somewhere else.')).toBeNull();

    fireEvent.click(within(bar).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(mocks.editor.markPageRestored).toHaveBeenCalledWith('doc-1'));
    expect(sent.some((request) => pathOf(request).endsWith('/documents/doc-1/restore'))).toBe(true);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Restored Sparse routing' }));
  });

  it('restores the collection that took it there', async () => {
    const sent = recordRequests();
    server.use(http.post('/workspaces/{workspace_id}/collections/{collection_id}/restore', ({ response }) =>
      response(200).json({ collection: makeCollectionDetail({ id: TREE.chapter2, name: 'Chapter 2' }), moved_to_root: false, tree_version: 3, job: null })));
    mocks.editor.inTrash = { trashRoot: { kind: 'collection', id: String(TREE.chapter2) }, purgeAfter: null };
    renderTopbar();

    const bar = screen.getByRole('alert');
    expect(bar.textContent).toContain('It went there with its collection.');
    fireEvent.click(within(bar).getByRole('button', { name: 'Restore the collection' }));
    await waitFor(() => expect(sent.some((request) => pathOf(request).endsWith(`/collections/${TREE.chapter2}/restore`))).toBe(true));
  });
});

describe('Page menu footer', () => {
  it('says when the page was last saved, from the editor and with no list request', () => {
    mocks.editor.lastSavedAt = Date.parse('2026-01-15T10:00:00Z');
    renderTopbar();
    openPageMenu();

    expect(screen.getByText(/^Edited Jan 15(, 2026)? · 5 words$/)).toBeTruthy();
    expect(mocks.listDocuments).not.toHaveBeenCalled();
  });
});
