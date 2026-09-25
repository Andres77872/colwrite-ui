import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  toast: vi.fn(),
  focusPageTitle: vi.fn(),
  focusChange: vi.fn(),
  createAndSwitch: vi.fn(),
  panels: {
    activeTool: 'assistant',
    isOpen: false,
    setTool: vi.fn(),
    assistantOpen: false,
    toggleAssistant: vi.fn(),
    leftCollapsed: false,
    toggleLeftCollapsed: vi.fn(),
    setMobileNavOpen: vi.fn(),
    close: vi.fn(),
    isDesktop: false,
  },
  sidebarDocked: true,
  proposals: { sets: [] as unknown[], pendingCount: 0 },
  editor: {
    doc: { version: 1, name: 'Sparse routing', blocks: [] as unknown[] },
    blocks: [
      { id: 'p1', type: 'paragraph', html: 'Two words', children: [] },
      { id: 'p2', type: 'paragraph', html: 'and three more', children: [] },
    ],
    documentId: 'doc-1' as string | null,
    loadingDocumentId: null as string | null,
    lastSavedAt: null as number | null,
    isAutoSaving: false,
    saveError: null as string | null,
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
    save: vi.fn(),
    deleteRemote: vi.fn(),
    listRemote: vi.fn(async () => ({
      documents: [{ id: 'doc-1', name: 'Sparse routing', updatedAt: '2026-01-15T10:00:00Z' }],
      count: 1,
    })),
    setCitationStyle: vi.fn(),
    hasPendingEdits: vi.fn(),
  },
}));

vi.mock('@/editor', () => ({
  DEFAULT_DOCUMENT_TITLE: 'Untitled document',
  focusPageTitle: () => true,
  useEditor: () => ({ ...mocks.editor, createAndSwitch: mocks.createAndSwitch }),
  useDocumentTitle: () => ({
    title: mocks.editor.doc.name || 'Untitled document',
    isUntitled: !mocks.editor.doc.name,
    focusPageTitle: mocks.focusPageTitle,
  }),
}));
vi.mock('@/editor/proposalsContextState', () => ({
  useProposals: () => ({ ...mocks.proposals, focusChange: mocks.focusChange }),
}));
vi.mock('@/editor/proposals', () => ({
  pendingInDocumentOrder: () => [
    { id: 'change-1', kind: 'replace' },
    { id: 'change-2', kind: 'insert' },
  ],
  describeChange: (change: { id: string }) => `Describe ${change.id}`,
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
  DocumentExportDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Export document" /> : null),
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
  mocks.confirm.mockReset().mockResolvedValue(false);
  mocks.toast.mockReset();
  mocks.focusPageTitle.mockReset().mockReturnValue(true);
  mocks.focusChange.mockReset();
  mocks.createAndSwitch.mockReset().mockResolvedValue('new-doc');
  Object.assign(mocks.panels, {
    activeTool: 'assistant',
    isOpen: false,
    assistantOpen: false,
    leftCollapsed: false,
    isDesktop: false,
  });
  mocks.panels.setTool.mockReset();
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
    canUndo: false,
    canRedo: false,
  });
  mocks.editor.doc = { version: 1, name: 'Sparse routing', blocks: [] };
  mocks.editor.undo.mockReset();
  mocks.editor.save.mockReset();
  mocks.editor.deleteRemote.mockReset().mockResolvedValue(undefined);
  mocks.editor.setCitationStyle.mockReset();
  mocks.editor.hasPendingEdits.mockReset().mockReturnValue(false);
});

afterEach(cleanup);

describe('PageTopbar', () => {
  it('has no Save, New or Delete buttons of its own — autosave and the page menu cover them', () => {
    renderTopbar();

    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /new document/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('moves the caret into the in-page title from the breadcrumb', () => {
    renderTopbar();

    const breadcrumb = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    fireEvent.click(breadcrumb.getByRole('button', { name: /Sparse routing/ }));
    expect(mocks.focusPageTitle).toHaveBeenCalledTimes(1);
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

  it('makes a failed save loud, retryable and announced once', () => {
    mocks.editor.saveError = 'Server unavailable';
    renderTopbar();

    expect(screen.getByText('Not saved')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.editor.save).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Autosave failed',
      description: 'Server unavailable',
      variant: 'error',
    });
  });

  it('opens the right sidebar tabs and shows which one is showing', () => {
    mocks.panels.isOpen = true;
    mocks.panels.activeTool = 'sources';
    renderTopbar();

    expect(screen.getByRole('button', { name: 'Sources' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Research' }));
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(mocks.panels.setTool.mock.calls).toEqual([['research'], ['history']]);

    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    expect(mocks.panels.toggleAssistant).toHaveBeenCalledTimes(1);
  });

  it('closes the right sidebar when its own tab button is pressed again, like Ask AI', () => {
    mocks.panels.isOpen = true;
    mocks.panels.activeTool = 'history';
    renderTopbar();

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(mocks.panels.close).toHaveBeenCalledTimes(1);
    expect(mocks.panels.setTool).not.toHaveBeenCalled();
  });

  it('leaves the tab buttons to the docked sidebar’s own tab strip while it is open', () => {
    mocks.panels.isOpen = true;
    mocks.panels.isDesktop = true;
    mocks.panels.activeTool = 'sources';
    renderTopbar();

    expect(screen.queryByRole('button', { name: 'Sources' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Research' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ask AI' })).toBeTruthy();
  });

  it('calls a page with no name of its own "Untitled", muted, as the page title does', () => {
    mocks.editor.doc = { version: 1, name: '', blocks: [] };
    renderTopbar();

    const breadcrumb = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    const label = breadcrumb.getByText('Untitled');
    expect(label.className).toContain('text-muted-foreground');
    expect(breadcrumb.queryByText('Untitled document')).toBeNull();
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
  it('holds the page actions, with word and character counts as its footer', () => {
    renderTopbar();
    openPageMenu();

    for (const name of ['Copy link', 'Export…', 'Version history', 'Document JSON', 'Undo', 'Redo', 'New page']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(`^${name}`) })).toBeTruthy();
    }
    expect(screen.getByRole('menuitemcheckbox', { name: 'Full width' })).toBeTruthy();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Small text' })).toBeTruthy();
    expect(screen.getByText('5 words · 23 characters')).toBeTruthy();
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
    expect(screen.getByRole('dialog', { name: 'Export document' })).toBeTruthy();

    openPageMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Version history' }));
    openPageMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Document JSON/ }));
    expect(mocks.panels.setTool.mock.calls).toEqual([['history'], ['json']]);
  });

  it('creates the next document through the flushing create path', async () => {
    renderTopbar();
    openPageMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'New page' }));

    await waitFor(() =>
      expect(mocks.createAndSwitch).toHaveBeenCalledWith({ version: 1, name: 'Untitled document', blocks: [] }),
    );
  });

  it('deletes the document only after a destructive confirmation', async () => {
    mocks.confirm.mockResolvedValueOnce(true);
    renderTopbar();
    openPageMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete document' }));

    await waitFor(() => expect(mocks.editor.deleteRemote).toHaveBeenCalledWith('doc-1'));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Delete “Sparse routing”?', destructive: true }),
    );
  });

  it('cannot delete a draft that was never saved to the server', () => {
    mocks.editor.documentId = null;
    renderTopbar();
    openPageMenu();

    expect(screen.getByRole('menuitem', { name: 'Delete document' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Page menu footer', () => {
  it('says when the page was last edited before anything is saved in this session', async () => {
    renderTopbar();
    openPageMenu();

    expect(await screen.findByText(/^Edited Jan 15/)).toBeTruthy();
  });
});
