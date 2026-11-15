import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createTestQueryClient, renderWithQueryClient as render } from '@/__tests__/queryClient';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { setPagePlacement } from '@/data/documents';
import { TREE } from '@/dev/msw/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDocumentList } from '@/data/__tests__/documentFixtures';

const mocks = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  switchTo: vi.fn(),
  createAndSwitch: vi.fn(),
  setTool: vi.fn(),
  setAssistantOpen: vi.fn(),
  setView: vi.fn(),
  setPreference: vi.fn(),
  openTrash: vi.fn(),
}));


vi.mock('@/editor', () => ({
  DEFAULT_DOCUMENT_TITLE: 'Untitled page',
  focusPageTitle: () => true,
  htmlToText: (html: string) => html,
  useEditorDoc: () => ({
    doc: { name: 'Open now', blocks: [] },
    blocks: [{ id: 'h1', type: 'heading', level: 2, html: 'Related work' }],
  }),
  useDocumentId: () => 'current',
  useEditorActions: () => ({ markRecentlyChanged: vi.fn() }),
  useDocumentActions: () => ({
    switchTo: mocks.switchTo,
    createAndSwitch: mocks.createAndSwitch,
  }),
  useDocumentSession: () => ({ creatingDocument: false, loadingDocumentId: null, documentId: 'current' }),
}));
vi.mock('@/components/panels/panelsContextState', () => ({
  usePanels: () => ({
    setTool: mocks.setTool,
    toggle: vi.fn(),
    setAssistantOpen: mocks.setAssistantOpen,
    toggleLeftCollapsed: vi.fn(),
    setMobileNavOpen: vi.fn(),
  }),
}));
vi.mock('@/components/preferences', () => ({
  useAgentTools: () => ({ isSourceEnabled: () => false }),
}));
vi.mock('../viewContextState', () => ({
  useView: () => ({ view: 'editor', setView: mocks.setView }),
}));
vi.mock('../useShellLayout', () => ({
  useSidebarDocked: () => true,
  useSidebarToggle: () => ({ toggle: vi.fn() }),
}));
vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ preference: 'system', resolved: 'light', setPreference: mocks.setPreference }),
}));
vi.mock('@/components/ui/toastContext', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { CommandPalette } = await import('./CommandPalette');

function summary(id: string, name: string) {
  return { id, name, tags: [], createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z' };
}

function renderPalette() {
  return render(<CommandPalette open onOpenChange={vi.fn()} onShowShortcuts={vi.fn()} onOpenTrash={mocks.openTrash} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom does no layout; the palette keeps the active row in view.
  Element.prototype.scrollIntoView = vi.fn();
  mocks.listDocuments.mockResolvedValue({
    documents: [summary('current', 'Open now'), summary('a', 'Thesis draft'), summary('b', 'Reading list')],
    count: 3,
  });
  mocks.createAndSwitch.mockResolvedValue('new-doc');
  mocks.switchTo.mockResolvedValue(true);
  // The palette searches pages through the query layer: the server's page list.
  mockDocumentList((body) => mocks.listDocuments(body));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CommandPalette', () => {
  it('starts with recent documents and commands, not the outline of the open page', async () => {
    renderPalette();

    const recent = await screen.findByRole('group', { name: 'Recent' });
    expect(within(recent).getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('Thesis draft'),
      expect.stringContaining('Reading list'),
    ]);
    expect(screen.queryByRole('group', { name: 'On this page' })).toBeNull();
    // Commands carry their shortcut.
    const askAi = within(screen.getByRole('group', { name: 'Commands' })).getByRole('option', { name: /Ask AI/ });
    expect(askAi.textContent).toContain('J');
  });

  it('searches headings, documents and the panels once something is typed', async () => {
    renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'related' } });

    expect(await screen.findByRole('group', { name: 'On this page' })).toBeTruthy();
    await waitFor(() =>
      expect(mocks.listDocuments).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: 'related' }),
      ),
    );
  });

  it('keeps the open page in search results, marked as the current page', async () => {
    renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'open' } });

    const documents = await screen.findByRole('group', { name: 'Pages' });
    const current = within(documents).getByRole('option', { name: /Open now/ });
    expect(current.textContent).toContain('Current page');
  });

  it('tells two pages of one name apart by their paths', async () => {
    mocks.listDocuments.mockResolvedValue({
      documents: [
        { ...summary('n1', 'Notes'), collectionId: TREE.chapter1 },
        { ...summary('n2', 'Notes'), collectionId: TREE.drafts },
      ],
    });
    renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'notes' } });

    const pages = await screen.findByRole('group', { name: 'Pages' });
    await waitFor(() => {
      const hints = within(pages).getAllByRole('option').map((option) => option.textContent ?? '');
      expect(hints[0]).toContain('Thesis › Chapter 1');
      expect(hints[1]).toContain('Archive › 2025 › Spring term › Week 3 › Drafts');
    });
  });

  it('offers New collection and Move page to…, each in a dialog of its own', async () => {
    renderPalette();
    const commands = await screen.findByRole('group', { name: 'Commands' });
    fireEvent.click(within(commands).getByRole('option', { name: 'New collection' }));
    expect(await screen.findByRole('dialog', { name: 'New collection' })).toBeTruthy();
    expect(screen.getByText('Add a top-level collection.')).toBeTruthy();
    cleanup();

    // The open page's placement, as the editor's read left it.
    const queryClient = createTestQueryClient();
    setPagePlacement(queryClient, TEST_WORKSPACE_ID, {
      documentId: 'current', collectionId: TREE.thesis, sortKey: 'V', placementEtag: '"cwp:1"', treeVersion: null,
    });
    render(<CommandPalette open onOpenChange={vi.fn()} onShowShortcuts={vi.fn()} onOpenTrash={mocks.openTrash} />, { queryClient });
    fireEvent.click(within(await screen.findByRole('group', { name: 'Commands' })).getByRole('option', { name: 'Move page to…' }));
    const dialog = await screen.findByRole('dialog', { name: /^Move/ });
    expect(within(await within(dialog).findByRole('treeitem', { name: /Thesis/ })).getByText('Already here')).toBeTruthy();
  });

  it('creates a new page through the flushing create path', async () => {
    renderPalette();
    fireEvent.click(await screen.findByRole('option', { name: 'New page' }));

    await waitFor(() =>
      // "Here": the open page is at the top level in this test.
      expect(mocks.createAndSwitch).toHaveBeenCalledWith({ name: 'Untitled page', blocks: [] }, { collectionId: null }),
    );
  });

  it('offers the Library before anything is typed', async () => {
    renderPalette();
    const commands = await screen.findByRole('group', { name: 'Commands' });
    fireEvent.click(within(commands).getByRole('option', { name: 'Library' }));
    expect(mocks.setTool).toHaveBeenCalledWith('library');
  });

  it('opens the Trash', async () => {
    renderPalette();
    fireEvent.click(within(await screen.findByRole('group', { name: 'Commands' })).getByRole('option', { name: 'Trash' }));
    expect(mocks.openTrash).toHaveBeenCalledTimes(1);
  });

  it('lists the right-panel tools under Panels once something is typed', async () => {
    mocks.listDocuments.mockResolvedValue({ documents: [], count: 0 });
    renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'history' } });
    expect(await screen.findByRole('group', { name: 'Panels' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Sidebar' })).toBeNull();
  });

  it('keeps a page switch that fails from escaping as an unhandled rejection', async () => {
    const failure = new Error('Network down');
    mocks.switchTo.mockRejectedValueOnce(failure);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      renderPalette();
      await screen.findByRole('group', { name: 'Recent' });
      fireEvent.click(screen.getByRole('option', { name: /Thesis draft/ }));
      expect(mocks.switchTo).toHaveBeenCalledWith('a', { source: 'selection' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('opens a recent document with the keyboard', async () => {
    renderPalette();
    await screen.findByRole('group', { name: 'Recent' });

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(mocks.switchTo).toHaveBeenCalledWith('b', { source: 'selection' });
  });
});
